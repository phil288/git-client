import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { previewMerge } from '../../src/main/git/conflicts'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import * as wt from '../../src/main/git/worktrees'
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

const backups = (r: string) => git(r, 'for-each-ref', '--format=%(refname)', 'refs/gitclient-backup').split('\n').filter(Boolean)

/** main (checked out) + feat with one commit of its own. */
function repo(name: string): string {
  const r = initRepo(join(root, name))
  git(r, 'branch', 'feat')
  git(r, 'checkout', '-q', 'feat')
  commitFile(r, 'f.txt', 'feature\n', 'feature work')
  git(r, 'checkout', '-q', 'main')
  return r
}

describe('shortRef', () => {
  it('strips the namespace of branches, remote branches and tags only', () => {
    expect(wt.shortRef('refs/heads/feat/x')).toBe('feat/x')
    expect(wt.shortRef('refs/remotes/origin/x')).toBe('origin/x')
    expect(wt.shortRef('refs/tags/v1')).toBe('v1')
    expect(wt.shortRef('abc123')).toBe('abc123')
  })
})

describe('mergeRefInto', () => {
  it('merges a branch into the current branch, here', async () => {
    const r = repo('current')
    commitFile(r, 'm.txt', 'main\n', 'main work')
    const plan = await wt.mergePlan(runner, r, 'refs/heads/feat', 'main')
    expect(plan).toMatchObject({ ahead: 1, host: r, isCurrent: true, canFastForward: false })
    const res = await wt.mergeRefInto(runner, r, 'refs/heads/feat', 'main', 'no-ff')
    expect(res).toMatchObject({ mergedIn: r, merged: 1, outcome: { status: 'ok', message: 'Merged 1 commit of feat into main' } })
    expect(git(r, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
    expect(backups(r).length).toBeGreaterThan(0)
  })

  it('merges a remote branch, a tag and a commit hash', async () => {
    const r = repo('sources')
    const featSha = git(r, 'rev-parse', 'feat').trim()
    git(r, 'update-ref', 'refs/remotes/origin/feat', featSha)
    expect(await wt.commitsToMergeRev(runner, r, 'refs/remotes/origin/feat', 'main')).toBe(1)
    git(r, 'tag', 'v1', featSha)
    expect(await wt.commitsToMergeRev(runner, r, 'refs/tags/v1', 'main')).toBe(1)

    const res = await wt.mergeRefInto(runner, r, 'refs/remotes/origin/feat', 'main', 'default')
    expect(res.outcome.message).toBe('Merged 1 commit of origin/feat into main')
    expect(git(r, 'rev-parse', 'main').trim()).toBe(featSha)

    git(r, 'checkout', '-q', 'feat')
    commitFile(r, 'g.txt', 'g\n', 'more')
    const sha = git(r, 'rev-parse', 'HEAD').trim()
    git(r, 'checkout', '-q', 'main')
    const byHash = await wt.mergeRefInto(runner, r, sha, 'main', 'default')
    expect(byHash).toMatchObject({ merged: 1, mergedIn: r })
    expect(git(r, 'rev-parse', 'main').trim()).toBe(sha)
    // Already in main now.
    const again = await wt.mergeRefInto(runner, r, 'refs/tags/v1', 'main', 'default')
    expect(again).toMatchObject({ merged: 0, mergedIn: null })
    expect(again.outcome.message).toMatch(/^Nothing to merge: every commit of v1/)
  })

  it('merges into a branch checked out in another worktree, there', async () => {
    const r = repo('other-wt')
    const p = await wt.addWorktree(runner, r, join(root, 'other-wt-feat'), 'feat', null)
    commitFile(r, 'm.txt', 'main\n', 'main work')
    const plan = await wt.mergePlan(runner, r, 'refs/heads/main', 'feat')
    expect(plan).toMatchObject({ host: p, isCurrent: false })
    const res = await wt.mergeRefInto(runner, r, 'refs/heads/main', 'feat', 'default')
    expect(res).toMatchObject({ mergedIn: p, merged: 1 })
    expect(readFileSync(join(p, 'm.txt'), 'utf8')).toBe('main\n')
  })

  it('fast-forwards a target checked out nowhere (with a backup), else needs a checkout', async () => {
    const r = repo('nowhere')
    await expect(wt.mergePlan(runner, r, 'refs/heads/feat', 'release')).rejects.toThrow() // no release branch yet
    git(r, 'branch', 'release', 'main')
    expect(await wt.mergePlan(runner, r, 'refs/heads/feat', 'release')).toMatchObject({ host: null, canFastForward: true, ahead: 1 })
    await expect(wt.mergeRefInto(runner, r, 'refs/heads/feat', 'release', 'no-ff')).rejects.toMatchObject({ code: 'NEEDS_CHECKOUT' })
    await expect(wt.mergeRefInto(runner, r, 'refs/heads/feat', 'release', 'squash')).rejects.toMatchObject({ code: 'NEEDS_CHECKOUT' })
    const before = backups(r).length
    const res = await wt.mergeRefInto(runner, r, 'refs/heads/feat', 'release', 'default')
    expect(res).toMatchObject({ mergedIn: null, merged: 1 })
    expect(res.outcome.message).toMatch(/^Fast-forwarded release to feat/)
    expect(git(r, 'rev-parse', 'release')).toBe(git(r, 'rev-parse', 'feat'))
    expect(backups(r).length).toBe(before + 1)

    commitFile(r, 'm.txt', 'main\n', 'main work')
    expect(await wt.mergePlan(runner, r, 'refs/heads/main', 'release')).toMatchObject({ canFastForward: false })
    await expect(wt.mergeRefInto(runner, r, 'refs/heads/main', 'release', 'default')).rejects.toMatchObject({ code: 'NEEDS_CHECKOUT' })
  })

  it('refuses to merge on top of an unfinished operation, and the same branch', async () => {
    const r = repo('busy')
    commitFile(r, 'f.txt', 'main\n', 'main conflicting')
    expect((await wt.mergeRefInto(runner, r, 'refs/heads/feat', 'main', 'default')).outcome.status).toBe('conflicts')
    await expect(wt.mergeRefInto(runner, r, 'refs/heads/feat', 'main', 'default')).rejects.toMatchObject({ code: 'DIRTY' })
    git(r, 'merge', '--abort')
    await expect(wt.mergeRefInto(runner, r, 'refs/heads/main', 'main', 'default')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('squash-merges into the current branch, leaving the result staged', async () => {
    const r = repo('squash')
    commitFile(r, 'm.txt', 'main\n', 'main work')
    const res = await wt.mergeRefInto(runner, r, 'refs/heads/feat', 'main', 'squash')
    expect(res.outcome.message).toMatch(/^Squashed 1 commit of feat into main/)
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('f.txt')
  })

  it('previews a merge into a branch other than HEAD', async () => {
    const r = repo('preview')
    if (version[0] < 2 || (version[0] === 2 && version[1] < 38)) return
    git(r, 'branch', 'release', 'main')
    git(r, 'checkout', '-q', 'release')
    commitFile(r, 'f.txt', 'release\n', 'release conflicting')
    git(r, 'checkout', '-q', 'main')
    write(r, 'untracked.txt', 'x\n')
    expect(await previewMerge(runner, r, 'refs/heads/feat', version)).toMatchObject({ clean: true })
    expect(await previewMerge(runner, r, 'refs/heads/feat', version, 'release')).toMatchObject({ clean: false, conflicts: ['f.txt'] })
  })
})
