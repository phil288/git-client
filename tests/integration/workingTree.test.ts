import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import * as wt from '../../src/main/git/workingTree'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir()
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'

describe('status', () => {
  it('lists modified, staged, renamed, untracked, deleted and paths with spaces', async () => {
    const r = initRepo(join(root, 'status'))
    commitFile(r, 'a.txt', 'a\n', 'a')
    commitFile(r, 'old name.txt', lines(20), 'old')
    commitFile(r, 'gone.txt', 'g\n', 'g')
    write(r, 'a.txt', 'a2\n')
    git(r, 'mv', 'old name.txt', 'new name.txt')
    git(r, 'rm', '-q', 'gone.txt')
    write(r, 'dir with space/untracked file.txt', 'u')
    const st = await wt.workingStatus(runner, r)
    const by = Object.fromEntries(st.entries.map((e) => [e.path, e]))
    expect(st.branch).toBe('main')
    expect(by['a.txt']).toMatchObject({ index: '.', worktree: 'M' })
    expect(by['new name.txt']).toMatchObject({ index: 'R', origPath: 'old name.txt' })
    expect(by['gone.txt']).toMatchObject({ index: 'D' })
    expect(by['dir with space/untracked file.txt']).toMatchObject({ untracked: true })
  })
})

describe('staging', () => {
  it('stages and unstages whole files, including deletions and in an unborn repo', async () => {
    const r = initRepo(join(root, 'files'))
    write(r, 'x.txt', 'x')
    await wt.stageFiles(runner, r, ['x.txt'])
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('x.txt')
    await wt.unstageFiles(runner, r, ['x.txt'])
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('')
    git(r, 'rm', '-q', '--cached', 'README.md') // index deletion
    await wt.unstageFiles(runner, r, ['README.md'])
    expect(git(r, 'status', '--porcelain').trim()).toBe('?? x.txt')

    // Already-staged deletion mixed with a stageable file: no "pathspec did not match".
    git(r, 'rm', '-q', 'README.md')
    await wt.stageFiles(runner, r, ['README.md', 'x.txt'])
    expect(git(r, 'diff', '--cached', '--name-status').trim().split('\n').sort()).toEqual(['A\tx.txt', 'D\tREADME.md'])
    await wt.unstageFiles(runner, r, ['README.md', 'x.txt'])
    git(r, 'checkout', '--', 'README.md')

    const fresh = join(root, 'unborn')
    git(root, 'init', '-q', fresh)
    write(fresh, 'n.txt', 'n')
    await wt.stageFiles(runner, fresh, ['n.txt'])
    await wt.unstageFiles(runner, fresh, ['n.txt'])
    expect(git(fresh, 'status', '--porcelain').trim()).toBe('?? n.txt')
  })

  it('stages, unstages and discards individual hunks', async () => {
    const r = initRepo(join(root, 'hunks'))
    commitFile(r, 'f.txt', lines(40), 'base')
    // Two distant edits -> two hunks.
    write(r, 'f.txt', lines(40, (i) => (i === 3 ? 'CHANGED 3' : i === 35 ? 'CHANGED 35' : `line ${i}`)))
    let fh = await wt.fileHunks(runner, r, 'f.txt')
    expect(fh.unstaged).toHaveLength(2)
    expect(fh.staged).toHaveLength(0)

    await wt.stageHunks(runner, r, 'f.txt', [fh.unstaged[1]!.id])
    fh = await wt.fileHunks(runner, r, 'f.txt')
    expect(fh.staged).toHaveLength(1)
    expect(fh.staged[0]!.lines.some((l) => l.text === 'CHANGED 35')).toBe(true)
    expect(fh.unstaged).toHaveLength(1)
    expect(fh.unstaged[0]!.lines.some((l) => l.text === 'CHANGED 3')).toBe(true)

    await wt.unstageHunks(runner, r, 'f.txt', [fh.staged[0]!.id])
    fh = await wt.fileHunks(runner, r, 'f.txt')
    expect(fh.staged).toHaveLength(0)
    expect(fh.unstaged).toHaveLength(2)

    await wt.discardHunks(runner, r, 'f.txt', [fh.unstaged[0]!.id])
    const content = readFileSync(join(r, 'f.txt'), 'utf8')
    expect(content).toContain('line 3\n')
    expect(content).toContain('CHANGED 35')
  })

  it('hunk staging preserves CRLF line endings and files without a final newline', async () => {
    const r = initRepo(join(root, 'crlf-hunks'))
    git(r, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(r, 'w.txt'), 'a\r\nb\r\nc\r\n')
    writeFileSync(join(r, 'nonl.txt'), 'x\ny')
    git(r, 'add', '.')
    git(r, 'commit', '-q', '-m', 'crlf')
    writeFileSync(join(r, 'w.txt'), 'a\r\nB\r\nc\r\n')
    writeFileSync(join(r, 'nonl.txt'), 'x\nY')
    for (const f of ['w.txt', 'nonl.txt']) {
      const fh = await wt.fileHunks(runner, r, f)
      await wt.stageHunks(runner, r, f, fh.unstaged.map((h) => h.id))
    }
    expect(git(r, 'show', ':w.txt')).toBe('a\r\nB\r\nc\r\n')
    expect(git(r, 'show', ':nonl.txt')).toBe('x\nY')
  })
})

describe('discard and commit', () => {
  it('discards modified, added, renamed and untracked files', async () => {
    const r = initRepo(join(root, 'discard'))
    commitFile(r, 'm.txt', 'm\n', 'm')
    commitFile(r, 'r.txt', lines(10), 'r')
    write(r, 'm.txt', 'changed\n')
    write(r, 'added.txt', 'a')
    git(r, 'add', 'added.txt')
    git(r, 'mv', 'r.txt', 'r2.txt')
    write(r, 'u.txt', 'u')
    await wt.discardFiles(runner, r, ['m.txt', 'added.txt', 'r2.txt', 'u.txt'])
    expect(git(r, 'status', '--porcelain').trim()).toBe('')
    expect(readFileSync(join(r, 'm.txt'), 'utf8')).toBe('m\n')
    expect(existsSync(join(r, 'added.txt'))).toBe(false)
    expect(existsSync(join(r, 'r.txt'))).toBe(true)
  })

  it('commits staged changes, refuses empty, amends and signs off', async () => {
    const r = initRepo(join(root, 'commit'))
    await expect(wt.commit(runner, r, 'nothing', { amend: false, signOff: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    write(r, 'c.txt', 'c')
    await wt.stageFiles(runner, r, ['c.txt'])
    await wt.commit(runner, r, 'Add c\n\nBody line', { amend: false, signOff: true })
    const msg = await wt.lastCommitMessage(runner, r)
    expect(msg).toContain('Add c\n\nBody line')
    expect(msg).toContain('Signed-off-by: Test User <test@example.com>')
    await wt.commit(runner, r, 'Add c (amended)', { amend: true, signOff: false })
    expect(git(r, 'log', '--format=%s').trim().split('\n')).toEqual(['Add c (amended)', 'initial'])
  })
})
