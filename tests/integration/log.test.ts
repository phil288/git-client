import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WORKTREE } from '@shared/types'
import { buildLogArgs, LogSessions } from '../../src/main/git/log'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { changedFiles, commitDetails, containingRefs, fileContent, listRefs } from '../../src/main/git/repoData'
import { GitRunner } from '../../src/main/git/runner'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
let logs: LogSessions
const root = tempDir()
let repo: string

beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
  logs = new LogSessions(runner)

  // main: initial -> a -> merge(feature) ; feature: f1 ; side branch "other" not merged
  repo = initRepo(join(root, 'repo'))
  commitFile(repo, 'a.txt', 'a\n', 'add a')
  git(repo, 'checkout', '-q', '-b', 'feature')
  commitFile(repo, 'f.txt', 'f\n', 'feature work')
  git(repo, 'checkout', '-q', 'main')
  commitFile(repo, 'b.txt', 'b\n', 'add b')
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
  git(repo, 'checkout', '-q', '-b', 'other', 'HEAD~1')
  commitFile(repo, 'o.txt', 'o\n', 'other work')
  git(repo, 'checkout', '-q', 'main')
  git(repo, 'tag', '-a', 'v1', '-m', 'release 1', 'HEAD')
  git(repo, 'tag', 'light', 'HEAD~1')
})

async function readAll(root: string, query: Parameters<LogSessions['open']>[1], page = 2) {
  const id = await logs.open(root, query)
  const all = []
  for (;;) {
    const p = await logs.next(id, page)
    all.push(...p.commits)
    if (p.done) break
  }
  return all
}

describe('log sessions', () => {
  it('streams all branches in pages with parents and current-branch flags', async () => {
    const commits = await readAll(repo, { revs: [] })
    const subjects = commits.map((c) => c.subject)
    expect(subjects).toContain('other work')
    expect(subjects).toContain('Merge feature')
    expect(commits).toHaveLength(6)
    const merge = commits.find((c) => c.subject === 'Merge feature')!
    expect(merge.parents).toHaveLength(2)
    expect(merge.onCurrentBranch).toBe(true)
    expect(commits.find((c) => c.subject === 'other work')!.onCurrentBranch).toBe(false)
    expect(commits.find((c) => c.subject === 'feature work')!.onCurrentBranch).toBe(true)
    // children before parents
    const idx = new Map(commits.map((c, i) => [c.hash, i]))
    for (const c of commits) for (const p of c.parents) expect(idx.get(p)!).toBeGreaterThan(idx.get(c.hash)!)
  })

  it('filters by branch, text (fixed/regex, case), author and path', async () => {
    expect((await readAll(repo, { revs: ['feature'] })).map((c) => c.subject)).toEqual(['feature work', 'add a', 'initial'])
    expect((await readAll(repo, { revs: [], text: 'WORK' })).map((c) => c.subject).sort()).toEqual(['feature work', 'other work'])
    expect(await readAll(repo, { revs: [], text: 'WORK', matchCase: true })).toHaveLength(0)
    expect((await readAll(repo, { revs: [], text: '^add [ab]$', regex: true })).map((c) => c.subject).sort()).toEqual(['add a', 'add b'])
    expect(await readAll(repo, { revs: [], authors: ['nobody@nowhere'] })).toHaveLength(0)
    expect((await readAll(repo, { revs: [], authors: ['test@example.com'] })).length).toBe(6)
    // Text search also matches author and hash prefix.
    expect((await readAll(repo, { revs: [], text: 'test user' })).length).toBe(6)
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    expect((await readAll(repo, { revs: [], text: head.slice(0, 7) })).map((c) => c.hash)).toEqual([head])
    await expect(logs.open(repo, { revs: [], text: '(', regex: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect((await readAll(repo, { revs: [], paths: ['f.txt'] })).map((c) => c.subject)).toEqual(['feature work'])
  })

  it('treats option-looking revisions as revisions, not options', () => {
    const args = buildLogArgs({ revs: ['--output=/tmp/x'] }, true)
    expect(args.indexOf('--end-of-options')).toBeLessThan(args.indexOf('--output=/tmp/x'))
  })

  it('returns an empty history for a fresh repository', async () => {
    const fresh = join(root, 'fresh')
    git(root, 'init', '-q', fresh)
    expect(await readAll(fresh, { revs: [] })).toEqual([])
  })

  it('can be closed while git is still streaming', async () => {
    const id = await logs.open(repo, { revs: [] })
    logs.close(id)
    await expect(logs.next(id, 10)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('refs and commit data', () => {
  it('lists branches, tags (peeled) and marks HEAD', async () => {
    const refs = await listRefs(runner, repo)
    const main = refs.find((r) => r.short === 'main')!
    expect(main.isHead).toBe(true)
    const v1 = refs.find((r) => r.short === 'v1')!
    expect(v1.kind).toBe('tag')
    expect(v1.annotated).toBe(true)
    expect(v1.hash).toBe(main.hash) // peeled to the commit
    expect(refs.find((r) => r.short === 'light')!.annotated).toBe(false)
  })

  it('commit details: full message and files vs first parent (with numstat)', async () => {
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    const d = await commitDetails(runner, repo, head)
    expect(d.message).toBe('Merge feature')
    expect(d.files).toEqual([{ path: 'f.txt', status: 'A', additions: 1, deletions: 0 }])
    const root = git(repo, 'rev-list', '--max-parents=0', 'HEAD').trim()
    const rd = await commitDetails(runner, repo, root)
    expect(rd.files.map((f) => f.path)).toEqual(['README.md'])
  })

  it('detects renames and binary files', async () => {
    const r = initRepo(join(root, 'renames'))
    commitFile(r, 'old name.txt', 'line\n'.repeat(20), 'add')
    git(r, 'mv', 'old name.txt', 'new name.txt')
    writeFileSync(join(r, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0]))
    git(r, 'add', '.')
    git(r, 'commit', '-q', '-m', 'rename + binary')
    const files = await changedFiles(runner, r, 'HEAD~1', 'HEAD')
    expect(files).toContainEqual({ path: 'new name.txt', oldPath: 'old name.txt', status: 'R', additions: 0, deletions: 0 })
    expect(files).toContainEqual({ path: 'bin.dat', status: 'A', additions: null, deletions: null })
  })

  it('finds containing branches and tags', async () => {
    const a = git(repo, 'log', '--format=%H', '--grep=add a').trim()
    const c = await containingRefs(runner, repo, a)
    expect(c.branches.sort()).toEqual(['feature', 'main', 'other'])
    expect(c.tags.sort()).toEqual(['light', 'v1'])
  })

  it('reads file contents at revisions, index and worktree, preserving encodings', async () => {
    const r = initRepo(join(root, 'content'))
    writeFileSync(join(r, 'crlf.txt'), 'x\r\ny\r\n')
    writeFileSync(join(r, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo')]))
    writeFileSync(join(r, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9])) // "café" in latin1
    git(r, '-c', 'core.autocrlf=false', 'add', '.')
    git(r, 'commit', '-q', '-m', 'enc')
    expect(await fileContent(runner, r, 'HEAD', 'crlf.txt')).toMatchObject({ exists: true, text: 'x\r\ny\r\n', encoding: 'utf8' })
    expect(await fileContent(runner, r, 'HEAD', 'bom.txt')).toMatchObject({ text: 'héllo', encoding: 'utf8bom' })
    expect(await fileContent(runner, r, 'HEAD', 'latin.txt')).toMatchObject({ text: 'café', encoding: 'latin1' })
    expect(await fileContent(runner, r, 'HEAD', 'missing.txt')).toMatchObject({ exists: false })
    write(r, 'crlf.txt', 'changed\n')
    expect((await fileContent(runner, r, WORKTREE, 'crlf.txt')).text).toBe('changed\n')
    expect((await fileContent(runner, r, ':index', 'crlf.txt')).text).toBe('x\r\ny\r\n')
  })
})
