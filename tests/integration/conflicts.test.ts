import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as cf from '../../src/main/git/conflicts'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { continueOperation, operationState } from '../../src/main/git/sequencer'
import { stashPop, stashPush } from '../../src/main/git/stash'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
let version: [number, number, number]
const root = tempDir()
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
  version = s.git.versionParts
})

const tryGit = (r: string, ...a: string[]) => {
  try {
    git(r, ...a)
    return true
  } catch {
    return false
  }
}

/** main and feature/x both change line 2 of app.txt. */
function diverged(name: string, opts: { crlf?: boolean } = {}) {
  const r = initRepo(join(root, name))
  const eol = opts.crlf ? '\r\n' : '\n'
  git(r, 'config', 'core.autocrlf', 'false')
  const text = (l2: string) => ['line 1', l2, 'line 3', 'line 4', 'line 5', ''].join(eol)
  writeFileSync(join(r, 'app.txt'), text('line 2'))
  git(r, 'add', '.')
  git(r, 'commit', '-q', '-m', 'base')
  git(r, 'checkout', '-q', '-b', 'feature/x')
  writeFileSync(join(r, 'app.txt'), text('line 2 from feature'))
  git(r, 'commit', '-q', '-am', 'Fix login')
  git(r, 'checkout', '-q', 'main')
  writeFileSync(join(r, 'app.txt'), text('line 2 from main'))
  git(r, 'commit', '-q', '-am', 'Main change')
  return r
}

describe('conflict state and labels', () => {
  it('merge: content conflict, Yours = current branch, Theirs = merged branch; accept Yours resolves', async () => {
    const r = diverged('merge')
    expect(tryGit(r, 'merge', 'feature/x')).toBe(false)
    const st = await cf.conflictState(runner, r)
    expect(st.operation).toBe('merge')
    expect(st.yours).toEqual({ role: 'Yours', name: 'main', detail: 'current branch' })
    expect(st.theirs.name).toBe('feature/x')
    expect(st.theirs.detail).toContain('being merged')
    expect(st.needsMessage).toBe(true)
    expect(st.defaultMessage).toMatch(/^Merge branch 'feature\/x'/)
    expect(st.files).toEqual([expect.objectContaining({ path: 'app.txt', type: 'content', yours: 'modified', theirs: 'modified', markersResolved: false })])
    await cf.acceptSide(runner, r, ['app.txt'], 'yours')
    expect((await cf.conflictState(runner, r)).files).toEqual([])
    expect(readFileSync(join(r, 'app.txt'), 'utf8')).toContain('line 2 from main')
  })

  it('rebase: the same conflict shows Yours = upstream, Theirs = your commit (ours/theirs inverted)', async () => {
    const r = diverged('rebase')
    git(r, 'checkout', '-q', 'feature/x')
    expect(tryGit(r, 'rebase', 'main')).toBe(false)
    const st = await cf.conflictState(runner, r)
    expect(st.operation).toBe('rebase')
    expect(st.yours).toEqual({ role: 'Yours', name: 'main', detail: 'upstream' })
    expect(st.theirs).toEqual({ role: 'Theirs', name: 'feature/x', detail: "your commit 'Fix login'" })
    expect(st.title).toBe('Rebasing feature/x onto main')
    expect(st.step).toBe(1)
    expect(st.totalSteps).toBe(1)
    // Stage 2 really is main's version during a rebase.
    const v = await cf.conflictVersions(runner, r, 'app.txt')
    expect(v.yours.text).toContain('from main')
    expect(v.theirs.text).toContain('from feature')
    expect(v.base.text).toContain('line 2\n')
  })

  it('full flow: resolve with an edited result → continue → rebase finishes', async () => {
    const r = diverged('flow')
    git(r, 'checkout', '-q', 'feature/x')
    expect(tryGit(r, 'rebase', 'main')).toBe(false)
    const v = await cf.conflictVersions(runner, r, 'app.txt')
    const merged = v.yours.text.replace('line 2 from main', 'line 2 from main and feature')
    await cf.saveResolution(runner, r, 'app.txt', merged, v.yours.encoding)
    expect((await cf.conflictState(runner, r)).files).toHaveLength(0)
    expect((await continueOperation(runner, r)).status).toBe('ok')
    expect((await operationState(runner, r)).operation).toBeNull()
    expect(git(r, 'log', '--format=%s', '-3').trim().split('\n')).toEqual(['Fix login', 'Main change', 'base'])
    expect(readFileSync(join(r, 'app.txt'), 'utf8')).toContain('line 2 from main and feature')
  })

  it('modify/delete: keep the modified file, or delete it', async () => {
    const make = (name: string) => {
      const r = initRepo(join(root, name))
      commitFile(r, 'doc.txt', 'v1\n', 'add doc')
      git(r, 'checkout', '-q', '-b', 'del')
      git(r, 'rm', '-q', 'doc.txt')
      git(r, 'commit', '-q', '-m', 'delete doc')
      git(r, 'checkout', '-q', 'main')
      commitFile(r, 'doc.txt', 'v2\n', 'edit doc')
      expect(tryGit(r, 'merge', 'del')).toBe(false)
      return r
    }
    const r = make('moddel')
    const st = await cf.conflictState(runner, r)
    expect(st.files[0]).toMatchObject({ path: 'doc.txt', type: 'modify-delete', yours: 'modified', theirs: 'deleted' })
    await cf.acceptSide(runner, r, ['doc.txt'], 'yours')
    expect(readFileSync(join(r, 'doc.txt'), 'utf8')).toBe('v2\n')
    expect((await cf.conflictState(runner, r)).files).toHaveLength(0)

    const r2 = make('moddel2')
    await cf.resolveDelete(runner, r2, ['doc.txt'])
    expect((await cf.conflictState(runner, r2)).files).toHaveLength(0)
    expect(git(r2, 'status', '--porcelain').trim()).toBe('D  doc.txt') // deletion staged for the merge commit
  })

  it('add/add: empty base, both added', async () => {
    const r = initRepo(join(root, 'addadd'))
    git(r, 'checkout', '-q', '-b', 'other')
    commitFile(r, 'new.txt', 'from other\n', 'add on other')
    git(r, 'checkout', '-q', 'main')
    commitFile(r, 'new.txt', 'from main\n', 'add on main')
    expect(tryGit(r, 'merge', 'other')).toBe(false)
    const st = await cf.conflictState(runner, r)
    expect(st.files[0]).toMatchObject({ type: 'add-add', yours: 'added', theirs: 'added' })
    const v = await cf.conflictVersions(runner, r, 'new.txt')
    expect(v.base.exists).toBe(false)
    expect(v.yours.text).toBe('from main\n')
  })

  it('binary conflict: detected, resolved by choosing Theirs byte-for-byte', async () => {
    const r = initRepo(join(root, 'binary'))
    writeFileSync(join(r, 'img.bin'), Buffer.from([0, 1, 2, 3]))
    git(r, 'add', '.')
    git(r, 'commit', '-q', '-m', 'bin')
    git(r, 'checkout', '-q', '-b', 'other')
    writeFileSync(join(r, 'img.bin'), Buffer.from([0, 9, 9, 9]))
    git(r, 'commit', '-q', '-am', 'bin other')
    git(r, 'checkout', '-q', 'main')
    writeFileSync(join(r, 'img.bin'), Buffer.from([0, 7, 7, 7]))
    git(r, 'commit', '-q', '-am', 'bin main')
    expect(tryGit(r, 'merge', 'other')).toBe(false)
    const st = await cf.conflictState(runner, r)
    expect(st.files[0]).toMatchObject({ type: 'binary', binary: true })
    await cf.acceptSide(runner, r, ['img.bin'], 'theirs')
    expect([...readFileSync(join(r, 'img.bin'))]).toEqual([0, 9, 9, 9])
  })

  it('CRLF: versions report CRLF; saved and auto-resolved results keep CRLF', async () => {
    const r = diverged('crlf', { crlf: true })
    expect(tryGit(r, 'merge', 'feature/x')).toBe(false)
    const v = await cf.conflictVersions(runner, r, 'app.txt')
    expect(v.eol).toBe('\r\n')
    expect(v.finalNewline).toBe(true)
    await cf.saveResolution(runner, r, 'app.txt', v.yours.text, v.yours.encoding)
    expect(readFileSync(join(r, 'app.txt'), 'utf8')).toBe('line 1\r\nline 2 from main\r\nline 3\r\nline 4\r\nline 5\r\n')
  })

  it('auto-resolves adjacent edits (git conflicts on them) and leaves true conflicts', async () => {
    const r = initRepo(join(root, 'auto'))
    git(r, 'config', 'core.autocrlf', 'false')
    const lines = (f: (i: number) => string) => Array.from({ length: 6 }, (_, i) => f(i + 1)).join('\r\n') + '\r\n'
    writeFileSync(join(r, 'adj.txt'), lines((i) => `l${i}`))
    commitFile(r, 'real.txt', 'x\n', 'real')
    git(r, 'add', '.')
    git(r, 'commit', '-q', '-m', 'base')
    git(r, 'checkout', '-q', '-b', 'other')
    writeFileSync(join(r, 'adj.txt'), lines((i) => (i === 4 ? 'L4 other' : `l${i}`)))
    write(r, 'real.txt', 'other\n')
    git(r, 'commit', '-q', '-am', 'other')
    git(r, 'checkout', '-q', 'main')
    writeFileSync(join(r, 'adj.txt'), lines((i) => (i === 3 ? 'L3 main' : `l${i}`)))
    write(r, 'real.txt', 'main\n')
    git(r, 'commit', '-q', '-am', 'main')
    expect(tryGit(r, 'merge', 'other')).toBe(false)
    const before = await cf.conflictState(runner, r)
    expect(before.files.map((f) => f.path).sort()).toEqual(['adj.txt', 'real.txt'])
    const out = await cf.autoResolve(runner, r)
    expect(out.resolved).toEqual(['adj.txt'])
    expect(out.remaining).toEqual([{ path: 'real.txt', conflicts: 1 }])
    expect(readFileSync(join(r, 'adj.txt'), 'utf8')).toBe('l1\r\nl2\r\nL3 main\r\nL4 other\r\nl5\r\nl6\r\n')
  })

  it('stash pop conflict is labelled as the stash', async () => {
    const r = initRepo(join(root, 'stashc'))
    write(r, 'README.md', 'stashed\n')
    await stashPush(runner, r, 's', false, false)
    commitFile(r, 'README.md', 'committed\n', 'c')
    await stashPop(runner, r, 0, false)
    const st = await cf.conflictState(runner, r)
    expect(st.operation).toBe('stash')
    expect(st.theirs).toMatchObject({ name: 'stash', detail: 'your stashed changes' })
  })

  it('submodule conflict: both commits shown, resolved by picking one', async () => {
    const lib = initRepo(join(root, 'sm-lib'))
    commitFile(lib, 'a.txt', 'b\n', 'lib b')
    commitFile(lib, 'a.txt', 'c\n', 'lib c')
    const [c, b] = git(lib, 'log', '--format=%H', '-2').trim().split('\n')
    const p = initRepo(join(root, 'sm-parent'))
    git(p, 'submodule', 'add', '-q', lib, 'lib')
    git(p, 'commit', '-q', '-m', 'add lib')
    git(p, 'checkout', '-q', '-b', 'other')
    git(join(p, 'lib'), 'checkout', '-q', b!)
    git(p, 'commit', '-q', '-am', 'lib at b')
    git(p, 'checkout', '-q', 'main')
    git(p, 'submodule', 'update', '-q')
    git(join(p, 'lib'), 'checkout', '-q', `${b}~1`)
    git(p, 'commit', '-q', '-am', 'lib at b~1')
    expect(tryGit(p, 'merge', 'other')).toBe(false)
    const st = await cf.conflictState(runner, p)
    expect(st.files[0]).toMatchObject({ path: 'lib', type: 'submodule', submodule: true })
    const v = await cf.conflictVersions(runner, p, 'lib')
    expect(v.theirs.gitlink).toBe(b)
    await cf.resolveSubmodule(runner, p, 'lib', c!)
    expect((await cf.conflictState(runner, p)).files).toHaveLength(0)
  })

  it('previews conflicts with merge-tree without touching the working tree', async () => {
    const r = diverged('preview')
    const before = git(r, 'status', '--porcelain')
    const p = await cf.previewMerge(runner, r, 'feature/x', version)
    if (!p.supported) return
    expect(p).toEqual({ supported: true, clean: false, conflicts: ['app.txt'] })
    expect(git(r, 'status', '--porcelain')).toBe(before)
    commitFile(r, 'x.txt', 'x', 'unrelated')
    git(r, 'branch', 'clean-branch', 'HEAD~1')
    expect((await cf.previewMerge(runner, r, 'clean-branch', version)).clean).toBe(true)
  })

  it('toggles rerere per repository', async () => {
    const r = initRepo(join(root, 'rerere'))
    expect(await cf.getRerere(runner, r)).toBe(false)
    await cf.setRerere(runner, r, true)
    expect(await cf.getRerere(runner, r)).toBe(true)
  })
})
