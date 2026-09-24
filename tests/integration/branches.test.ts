import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { listBackups } from '../../src/main/git/backup'
import * as br from '../../src/main/git/branches'
import { initEditors } from '../../src/main/git/editors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir()

beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
  initEditors(join(root, 'helpers'), process.execPath)
})

const head = (r: string) => git(r, 'rev-parse', '--abbrev-ref', 'HEAD').trim()

describe('checkout', () => {
  it('checks out branches; local changes raise LOCAL_CHANGES; force and smart checkout work', async () => {
    const r = initRepo(join(root, 'co'))
    git(r, 'checkout', '-q', '-b', 'other')
    commitFile(r, 'README.md', 'other\n', 'other readme')
    git(r, 'checkout', '-q', 'main')

    await br.checkout(runner, r, 'other')
    expect(head(r)).toBe('other')
    await br.checkout(runner, r, 'main')

    write(r, 'README.md', 'local edit\n')
    await expect(br.checkout(runner, r, 'other')).rejects.toMatchObject({ code: 'LOCAL_CHANGES' })

    // Smart checkout: stash, checkout, pop -> conflict because both touched README.
    const out = await br.smartCheckout(runner, r, 'other')
    expect(head(r)).toBe('other')
    expect(out.status).toBe('conflicts')
    git(r, 'checkout', '-q', '--theirs', 'README.md') // resolve for the next step
    git(r, 'reset', '-q', '--hard')
    git(r, 'stash', 'drop', '-q')

    write(r, 'README.md', 'another edit\n')
    await br.checkout(runner, r, 'main', { force: true })
    expect(head(r)).toBe('main')
    expect(readFileSync(join(r, 'README.md'), 'utf8')).toBe('# test\n')
  })

  it('smart checkout without conflicts restores the changes', async () => {
    const r = initRepo(join(root, 'smart'))
    git(r, 'checkout', '-q', '-b', 'b2')
    commitFile(r, 'x.txt', 'x\n', 'x')
    git(r, 'checkout', '-q', 'main')
    write(r, 'README.md', 'mine\n')
    const out = await br.smartCheckout(runner, r, 'b2')
    expect(out.status).toBe('ok')
    expect(readFileSync(join(r, 'README.md'), 'utf8')).toBe('mine\n')
    expect(git(r, 'stash', 'list').trim()).toBe('')
  })
})

describe('create / rename / delete / restore / upstream', () => {
  it('validates names, creates, renames, deletes with NOT_MERGED and restores', async () => {
    const r = initRepo(join(root, 'crud'))
    await expect(br.createBranch(runner, r, 'bad..name', 'HEAD', false)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await br.createBranch(runner, r, 'feature/x', 'HEAD', true)
    expect(head(r)).toBe('feature/x')
    commitFile(r, 'f.txt', 'f\n', 'feature')
    git(r, 'checkout', '-q', 'main')
    await br.renameBranch(runner, r, 'feature/x', 'feature/y', false)
    await expect(br.deleteBranch(runner, r, 'feature/y', false)).rejects.toMatchObject({ code: 'NOT_MERGED' })
    const sha = await br.deleteBranch(runner, r, 'feature/y', true)
    expect(git(r, 'branch', '--list', 'feature/y').trim()).toBe('')
    await br.restoreBranch(runner, r, 'feature/y', sha)
    expect(git(r, 'rev-parse', 'feature/y').trim()).toBe(sha)
    expect(await br.checkRefFormat(runner, r, 'ok/name')).toBe(true)
    expect(await br.checkRefFormat(runner, r, '-oops')).toBe(false)
  })
})

describe('merge / rebase / compare', () => {
  function setup(name: string) {
    const r = initRepo(join(root, name))
    git(r, 'checkout', '-q', '-b', 'topic')
    commitFile(r, 't.txt', 't\n', 'topic 1')
    git(r, 'checkout', '-q', 'main')
    commitFile(r, 'm.txt', 'm\n', 'main 1')
    return r
  }

  it('merges with --no-ff and records a backup ref', async () => {
    const r = setup('merge')
    const out = await br.merge(runner, r, 'topic', 'no-ff')
    expect(out.status).toBe('ok')
    expect(git(r, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
    const backups = await listBackups(runner, r)
    expect(backups[0]).toMatchObject({ branch: 'main', operation: 'merge' })
  })

  it('--ff-only refuses divergent histories; --squash stages without committing', async () => {
    const r = setup('ffonly')
    await expect(br.merge(runner, r, 'topic', 'ff-only')).rejects.toMatchObject({ code: 'GIT_FAILED' })
    const out = await br.merge(runner, r, 'topic', 'squash')
    expect(out.status).toBe('ok')
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('t.txt')
  })

  it('reports conflicts as an outcome, not an error', async () => {
    const r = initRepo(join(root, 'mconf'))
    git(r, 'checkout', '-q', '-b', 'topic')
    commitFile(r, 'README.md', 'topic\n', 'topic readme')
    git(r, 'checkout', '-q', 'main')
    commitFile(r, 'README.md', 'main\n', 'main readme')
    expect((await br.merge(runner, r, 'topic', 'default')).status).toBe('conflicts')
    expect(existsSync(join(r, '.git', 'MERGE_HEAD'))).toBe(true)
  })

  it('rebases current onto another branch, and "checkout and rebase onto current"', async () => {
    const r = setup('rebase')
    const out = await br.rebase(runner, r, 'main', 'topic') // checkout topic, rebase onto main
    expect(out.status).toBe('ok')
    expect(head(r)).toBe('topic')
    expect(git(r, 'log', '--format=%s', '-3').trim().split('\n')).toEqual(['topic 1', 'main 1', 'initial'])
    expect((await listBackups(runner, r))[0]).toMatchObject({ branch: 'topic', operation: 'rebase' })
  })

  it('compares two branches both ways with the file diff', async () => {
    const r = setup('compare')
    const c = await br.compare(runner, r, 'topic', 'main')
    expect(c.onlyA.map((x) => x.subject)).toEqual(['topic 1'])
    expect(c.onlyB.map((x) => x.subject)).toEqual(['main 1'])
    expect(c.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(['A t.txt', 'D m.txt'])
  })
})

describe('remotes: fetch / pull / push / rename remote branch / delete remote', () => {
  it('works against a bare remote', async () => {
    const origin = join(root, 'origin.git')
    git(root, 'init', '-q', '--bare', origin)
    const a = initRepo(join(root, 'net-a'))
    git(a, 'remote', 'add', 'origin', origin)
    await br.push(runner, a, { remote: 'origin', branch: 'main', remoteBranch: 'main', setUpstream: true, forceWithLease: false, tags: false })
    const b = join(root, 'net-b')
    git(root, 'clone', '-q', origin, b)

    commitFile(a, 'new.txt', 'n\n', 'from a')
    await br.push(runner, a, { remote: 'origin', branch: 'main', remoteBranch: 'main', setUpstream: false, forceWithLease: false, tags: false })
    const lines: string[] = []
    await br.fetch(runner, b, null, true, undefined, (l) => lines.push(l))
    expect(git(b, 'rev-parse', 'origin/main').trim()).toBe(git(a, 'rev-parse', 'HEAD').trim())
    expect((await br.pull(runner, b, 'ff-only')).status).toBe('ok')
    expect(existsSync(join(b, 'new.txt'))).toBe(true)

    // force-with-lease refuses to overwrite commits we have not fetched.
    commitFile(b, 'b.txt', 'b\n', 'from b')
    await br.push(runner, b, { remote: 'origin', branch: 'main', remoteBranch: 'main', setUpstream: false, forceWithLease: false, tags: false })
    git(a, 'commit', '-q', '--amend', '-m', 'rewritten in a')
    await expect(
      br.push(runner, a, { remote: 'origin', branch: 'main', remoteBranch: 'main', setUpstream: false, forceWithLease: true, tags: false })
    ).rejects.toMatchObject({ code: 'GIT_FAILED' })

    // Rename a pushed branch locally and on the remote.
    git(b, 'checkout', '-q', '-b', 'old-name')
    await br.push(runner, b, { remote: 'origin', branch: 'old-name', remoteBranch: 'old-name', setUpstream: true, forceWithLease: false, tags: false })
    await br.renameBranch(runner, b, 'old-name', 'new-name', true)
    const remoteHeads = git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n').sort()
    expect(remoteHeads).toEqual(['main', 'new-name'])
    expect(git(b, 'rev-parse', '--abbrev-ref', 'new-name@{u}').trim()).toBe('origin/new-name')

    await br.deleteRemoteBranch(runner, b, 'origin', 'new-name')
    expect(git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim()).toBe('main')

    const remotes = await br.listRemotes(runner, b)
    expect(remotes).toEqual([{ name: 'origin', fetchUrl: origin, pushUrl: origin }])
    await br.setUpstream(runner, b, 'main', null)
    expect(() => git(b, 'rev-parse', '--abbrev-ref', 'main@{u}')).toThrow() // no upstream any more
  })

  it('lists recent branches from the reflog', async () => {
    const r = initRepo(join(root, 'recent'))
    git(r, 'checkout', '-q', '-b', 'one')
    git(r, 'checkout', '-q', '-b', 'two')
    git(r, 'checkout', '-q', 'main')
    expect(await br.recentBranches(runner, r)).toEqual(['main', 'two', 'one'])
  })
})
