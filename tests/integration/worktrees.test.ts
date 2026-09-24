import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import * as wt from '../../src/main/git/worktrees'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir()
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

describe('parseWorktreeList', () => {
  it('parses branch, detached, locked and prunable records', () => {
    const out = [
      'worktree /r',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /r-feat',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feat/x',
      'locked busy on it',
      '',
      'worktree /r-det',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
    const l = wt.parseWorktreeList(out)
    expect(l.map((w) => [w.isMain, w.branch, w.detached, w.locked, w.lockReason, w.prunable])).toEqual([
      [true, 'main', false, false, null, false],
      [false, 'feat/x', false, true, 'busy on it', false],
      [false, null, true, false, null, true]
    ])
  })
})

describe('worktrees', () => {
  it('adds, lists, locks, removes with -f and -f -f, and prunes', async () => {
    const r = initRepo(join(root, 'repo'))
    const p = await wt.suggestWorktreePath(runner, r, 'feat/one')
    expect(p).toBe(join(root, 'repo-one'))
    const added = await wt.addWorktree(runner, r, p, 'main', 'feat/one')
    expect(existsSync(join(added, 'README.md'))).toBe(true)
    let list = await wt.listWorktrees(runner, r)
    expect(list.map((w) => w.branch)).toEqual(['main', 'feat/one'])
    expect(list[0]!.isMain).toBe(true)

    // Main worktree is protected.
    await expect(wt.removeWorktree(runner, r, r, 2)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    // Dirty: plain remove refuses, -f succeeds.
    write(added, 'scratch.txt', 'x')
    await expect(wt.removeWorktree(runner, r, added, 0)).rejects.toMatchObject({ code: 'DIRTY' })
    await wt.removeWorktree(runner, r, added, 1)
    expect(existsSync(added)).toBe(false)

    // Locked: -f refuses, -f -f succeeds.
    const p2 = await wt.addWorktree(runner, r, join(root, 'repo-two'), 'main', 'feat/two')
    await wt.lockWorktree(runner, r, p2, 'keep')
    list = await wt.listWorktrees(runner, r)
    expect(list.find((w) => w.branch === 'feat/two')).toMatchObject({ locked: true, lockReason: 'keep' })
    await expect(wt.removeWorktree(runner, r, p2, 1)).rejects.toMatchObject({ code: 'LOCKED' })
    await wt.removeWorktree(runner, r, p2, 2)
    expect(existsSync(p2)).toBe(false)

    // Removing from inside the worktree being removed still works (runs from another worktree).
    const p3 = await wt.addWorktree(runner, r, join(root, 'repo-three'), 'main', 'feat/three')
    await wt.removeWorktree(runner, p3, p3, 0)
    expect(existsSync(p3)).toBe(false)

    // Deleted folder shows as prunable, prune drops it.
    // A branch checked out elsewhere is refused with git's real reason.
    await expect(wt.addWorktree(runner, r, join(root, 'repo-x'), 'main', null)).rejects.toThrow(/already/)
    const p4 = await wt.addWorktree(runner, r, join(root, 'repo-four'), 'HEAD', null)
    rmSync(p4, { recursive: true, force: true })
    expect((await wt.listWorktrees(runner, r)).find((w) => w.path === p4)?.prunable).toBe(true)
    await wt.pruneWorktrees(runner, r)
    expect((await wt.listWorktrees(runner, r)).map((w) => w.path)).toEqual([r])
  })

  it('merges a worktree branch into main where main is checked out', async () => {
    const r = initRepo(join(root, 'merge'))
    expect(await wt.defaultBranch(runner, r)).toBe('main')
    const p = await wt.addWorktree(runner, r, join(root, 'merge-feat'), 'main', 'feat')
    commitFile(p, 'f.txt', 'feature\n', 'feature work')
    commitFile(r, 'm.txt', 'main\n', 'main work')
    const res = await wt.mergeInto(runner, p, 'feat', 'main', 'default')
    expect(res.outcome.status).toBe('ok')
    expect(res.mergedIn).toBe(r)
    expect(readFileSync(join(r, 'f.txt'), 'utf8')).toBe('feature\n')
    expect(git(r, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
  })

  it('fast-forwards a target that is not checked out anywhere, refuses a real merge', async () => {
    const r = initRepo(join(root, 'ff'))
    git(r, 'branch', 'release')
    commitFile(r, 'a.txt', 'a\n', 'a')
    const res = await wt.mergeInto(runner, r, 'main', 'release', 'default')
    expect(res).toMatchObject({ mergedIn: null, outcome: { status: 'ok' } })
    expect(git(r, 'rev-parse', 'release')).toBe(git(r, 'rev-parse', 'main'))

    git(r, 'branch', 'side', 'HEAD~1')
    const p = await wt.addWorktree(runner, r, join(root, 'ff-side'), 'side', null)
    commitFile(p, 's.txt', 's\n', 's')
    await wt.removeWorktree(runner, r, p, 0)
    await expect(wt.mergeInto(runner, r, 'side', 'release', 'default')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('a conflicted merge protects the source branch until it is committed or aborted', async () => {
    const r = initRepo(join(root, 'conflict'))
    const p = await wt.addWorktree(runner, r, join(root, 'conflict-feat'), 'main', 'feat')
    for (const n of [1, 2, 3]) commitFile(p, 'README.md', `feature ${n}\n`, `feature ${n}`)
    commitFile(r, 'README.md', 'main change\n', 'main change')
    const tip = git(r, 'rev-parse', 'feat').trim()

    const res = await wt.mergeInto(runner, p, 'feat', 'main', 'default')
    expect(res).toMatchObject({ mergedIn: r, outcome: { status: 'conflicts' } })
    expect(await wt.pendingMerges(runner, p)).toEqual([{ path: r, into: 'main', mergeHead: tip, branches: ['feat'] }])

    // Deleting the branch (even forced) is refused while the merge needs it.
    await expect(wt.assertNotBeingMerged(runner, p, 'feat')).rejects.toThrow(/not finished/)
    await expect(wt.assertNotBeingMerged(runner, p, 'main')).resolves.toBeUndefined()
    // A second merge is refused instead of being reported as fresh conflicts.
    await expect(wt.mergeInto(runner, p, 'feat', 'main', 'default')).rejects.toMatchObject({ code: 'DIRTY' })

    // Committed: the merge now contains the commits, the branch is free again.
    write(r, 'README.md', 'resolved\n')
    git(r, 'add', 'README.md')
    git(r, 'commit', '-q', '--no-edit')
    expect(await wt.pendingMerges(runner, p)).toEqual([])
    await expect(wt.assertNotBeingMerged(runner, p, 'feat')).resolves.toBeUndefined()
    expect(git(r, 'merge-base', '--is-ancestor', tip, 'main')).toBe('')
  })

  it('an aborted merge also releases the branch', async () => {
    const r = initRepo(join(root, 'abort'))
    const p = await wt.addWorktree(runner, r, join(root, 'abort-feat'), 'main', 'feat')
    commitFile(p, 'README.md', 'feature\n', 'feature')
    commitFile(r, 'README.md', 'main\n', 'main')
    expect((await wt.mergeInto(runner, p, 'feat', 'main', 'default')).outcome.status).toBe('conflicts')
    git(r, 'merge', '--abort')
    expect(await wt.pendingMerges(runner, p)).toEqual([])
  })
})
