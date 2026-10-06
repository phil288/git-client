import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { listRemotes } from '../../src/main/git/branches'
import { blame, fileHistory } from '../../src/main/git/history'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import * as st from '../../src/main/git/stash'
import * as tr from '../../src/main/git/tagsRemotes'
import { operationState } from '../../src/main/git/sequencer'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir()
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

describe('stash', () => {
  it('pushes (with untracked), lists, shows files, applies, pops, drops and branches', async () => {
    const r = initRepo(join(root, 'stash'))
    commitFile(r, 'a.txt', 'a\n', 'a')
    await expect(st.stashPush(runner, r, 'nothing', false, false)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    write(r, 'a.txt', 'a changed\n')
    write(r, 'new.txt', 'untracked')
    await st.stashPush(runner, r, 'my work', true, false)
    expect(existsSync(join(r, 'new.txt'))).toBe(false)
    const list = await st.listStashes(runner, r)
    expect(list).toHaveLength(1)
    expect(list[0]!.message).toContain('my work')
    const files = await st.stashFiles(runner, r, 0)
    expect(files.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(files.untracked.map((f) => f.path)).toEqual(['new.txt'])

    expect((await st.stashApply(runner, r, 0, false)).status).toBe('ok')
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('a changed\n')
    git(r, 'checkout', '-q', '--', 'a.txt')
    git(r, 'clean', '-qf')
    expect((await st.stashPop(runner, r, 0, false)).status).toBe('ok')
    expect(await st.listStashes(runner, r)).toHaveLength(0)

    await st.stashPush(runner, r, 'for branch', true, false)
    await st.stashBranch(runner, r, 'from-stash', 0)
    expect(git(r, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('from-stash')
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('a changed\n')

    write(r, 'a.txt', 'again\n')
    await st.stashPush(runner, r, 'to drop', false, false)
    await st.stashDrop(runner, r, 0)
    expect(await st.listStashes(runner, r)).toHaveLength(0)
  })

  it('stash pop with conflicts keeps the stash and is detected as a stash conflict', async () => {
    const r = initRepo(join(root, 'stash-conflict'))
    write(r, 'README.md', 'stashed\n')
    await st.stashPush(runner, r, 'conflicting', false, false)
    commitFile(r, 'README.md', 'committed\n', 'change readme')
    const out = await st.stashPop(runner, r, 0, false)
    expect(out.status).toBe('conflicts')
    expect(await st.listStashes(runner, r)).toHaveLength(1)
    const state = await operationState(runner, r)
    expect(state.operation).toBeNull()
    expect(state.conflicted).toEqual(['README.md'])
  })
})

describe('file history and blame', () => {
  it('follows renames and reports the path per commit', async () => {
    const r = initRepo(join(root, 'history'))
    commitFile(r, 'old.txt', Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n', 'add old')
    mkdirSync(join(r, 'dir with space'))
    git(r, 'mv', 'old.txt', 'dir with space/new.txt')
    git(r, 'commit', '-q', '-m', 'rename')
    write(r, 'dir with space/new.txt', readFileSync(join(r, 'dir with space/new.txt'), 'utf8') + 'more\n')
    git(r, 'commit', '-q', '-am', 'edit')
    commitFile(r, 'other.txt', 'x', 'unrelated')
    const h = await fileHistory(runner, r, 'dir with space/new.txt')
    expect(h.map((e) => e.commit.subject)).toEqual(['edit', 'rename', 'add old'])
    expect(h[0]).toMatchObject({ status: 'M', path: 'dir with space/new.txt' })
    expect(h[1]).toMatchObject({ status: 'R', oldPath: 'old.txt', path: 'dir with space/new.txt' })
    expect(h[2]).toMatchObject({ status: 'A', path: 'old.txt' })
  })

  it('blames every line with author, time and summary (incl. uncommitted lines)', async () => {
    const r = initRepo(join(root, 'blame'))
    git(r, 'config', 'user.name', 'Alice')
    commitFile(r, 'b.txt', 'one\ntwo\n', 'first')
    git(r, 'config', 'user.name', 'Bob')
    commitFile(r, 'b.txt', 'one\nTWO\nthree\n', 'second')
    write(r, 'b.txt', 'one\nTWO\nthree\nlocal\n')
    const lines = await blame(runner, r, 'b.txt', null)
    expect(lines.map((l) => [l.line, l.text, l.author, l.summary])).toEqual([
      [1, 'one', 'Alice', 'first'],
      [2, 'TWO', 'Bob', 'second'],
      [3, 'three', 'Bob', 'second'],
      [4, 'local', 'Not Committed Yet', 'Version of b.txt from b.txt']
    ])
    expect(lines[3]!.hash).toMatch(/^0+$/)
    const atHead = await blame(runner, r, 'b.txt', 'HEAD~1')
    expect(atHead.map((l) => l.text)).toEqual(['one', 'two'])
  })
})

describe('tags and remotes', () => {
  it('creates lightweight and annotated tags, pushes and deletes them locally and remotely', async () => {
    const origin = join(root, 'tags-origin.git')
    git(root, 'init', '-q', '--bare', origin)
    const r = initRepo(join(root, 'tags'))
    git(r, 'remote', 'add', 'origin', origin)
    await tr.createTag(runner, r, 'v1', 'HEAD', null)
    await tr.createTag(runner, r, 'v2', 'HEAD', 'Release 2\n\nNotes')
    await expect(tr.createTag(runner, r, 'bad..tag', 'HEAD', null)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(git(r, 'cat-file', '-t', 'v1').trim()).toBe('commit')
    expect(git(r, 'cat-file', '-t', 'v2').trim()).toBe('tag')
    expect(git(r, 'tag', '-l', '--format=%(contents)', 'v2').trim()).toBe('Release 2\n\nNotes')
    const listed = await tr.listTags(runner, r)
    const head = git(r, 'rev-parse', 'HEAD').trim()
    expect(listed.map((t) => t.name).sort()).toEqual(['v1', 'v2'])
    expect(listed.find((t) => t.name === 'v1')).toMatchObject({ hash: head, annotated: false, tagger: null, message: '', commitSubject: 'initial' })
    expect(listed.find((t) => t.name === 'v2')).toMatchObject({ hash: head, annotated: true, message: 'Release 2\n\nNotes', commitSubject: 'initial' })
    expect(listed.find((t) => t.name === 'v2')!.tagger).toBeTruthy()
    await tr.pushTag(runner, r, 'origin', 'v2')
    expect(git(origin, 'tag').trim()).toBe('v2')
    await tr.deleteRemoteTag(runner, r, 'origin', 'v2')
    expect(git(origin, 'tag').trim()).toBe('')
    await tr.deleteTag(runner, r, 'v1')
    expect(git(r, 'tag').trim()).toBe('v2')
  })

  it('adds, edits, renames, prunes and removes remotes', async () => {
    const r = initRepo(join(root, 'remotes'))
    await tr.addRemote(runner, r, 'up', 'https://example.invalid/a.git')
    await tr.setRemoteUrl(runner, r, 'up', 'https://example.invalid/b.git', false)
    await tr.setRemoteUrl(runner, r, 'up', 'git@example.invalid:b.git', true)
    expect(await listRemotes(runner, r)).toEqual([{ name: 'up', fetchUrl: 'https://example.invalid/b.git', pushUrl: 'git@example.invalid:b.git' }])
    await tr.renameRemote(runner, r, 'up', 'upstream')
    const origin = join(root, 'prune-origin.git')
    git(root, 'init', '-q', '--bare', origin)
    await tr.addRemote(runner, r, 'origin', origin)
    git(r, 'push', '-q', 'origin', 'HEAD:refs/heads/gone')
    git(r, 'fetch', '-q', 'origin')
    git(origin, 'branch', '-D', 'gone')
    await tr.pruneRemote(runner, r, 'origin')
    expect(git(r, 'branch', '-r').trim()).toBe('')
    await tr.removeRemote(runner, r, 'upstream')
    expect((await listRemotes(runner, r)).map((x) => x.name)).toEqual(['origin'])
  })

  it('adds with a push URL and updates name / URLs in one call', async () => {
    const r = initRepo(join(root, 'remotes-update'))
    await tr.addRemote(runner, r, 'origin', 'https://example.invalid/a.git', 'git@example.invalid:a.git')
    expect(await listRemotes(runner, r)).toEqual([{ name: 'origin', fetchUrl: 'https://example.invalid/a.git', pushUrl: 'git@example.invalid:a.git' }])
    // Same push URL as fetch: no pushurl is written.
    await tr.addRemote(runner, r, 'same', 'https://example.invalid/s.git', 'https://example.invalid/s.git')
    expect(git(r, 'config', '--get-all', 'remote.same.url').trim()).toBe('https://example.invalid/s.git')
    expect(() => git(r, 'config', '--get', 'remote.same.pushurl')).toThrow()

    await tr.updateRemote(runner, r, 'origin', { name: 'mine', fetchUrl: 'https://example.invalid/b.git', pushUrl: null })
    expect((await listRemotes(runner, r)).find((x) => x.name === 'mine')).toEqual({ name: 'mine', fetchUrl: 'https://example.invalid/b.git', pushUrl: 'https://example.invalid/b.git' })
    await tr.updateRemote(runner, r, 'mine', { name: 'mine', fetchUrl: 'https://example.invalid/b.git', pushUrl: 'git@example.invalid:p.git' })
    expect((await listRemotes(runner, r)).find((x) => x.name === 'mine')!.pushUrl).toBe('git@example.invalid:p.git')
    await expect(tr.updateRemote(runner, r, 'nope', { name: 'x', fetchUrl: 'u', pushUrl: null })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(tr.updateRemote(runner, r, 'mine', { name: 'same', fetchUrl: 'u', pushUrl: null })).rejects.toBeTruthy()
  })

  it('tests a URL with ls-remote without changing the repository', async () => {
    const origin = join(root, 'test-origin.git')
    git(root, 'init', '-q', '--bare', '-b', 'trunk', origin)
    const r = initRepo(join(root, 'remotes-test'))
    expect(await tr.testRemoteUrl(runner, r, origin)).toEqual({ branches: 0, tags: 0, defaultBranch: null })
    git(r, 'push', '-q', origin, 'HEAD:refs/heads/trunk', 'HEAD:refs/heads/dev')
    git(r, 'tag', '-a', '-m', 'v', 'v1')
    git(r, 'push', '-q', origin, 'v1')
    expect(await tr.testRemoteUrl(runner, r, origin)).toEqual({ branches: 2, tags: 1, defaultBranch: 'trunk' })
    expect(git(r, 'remote').trim()).toBe('')
    await expect(tr.testRemoteUrl(runner, r, join(root, 'missing.git'))).rejects.toMatchObject({ code: 'GIT_FAILED' })
    await expect(tr.testRemoteUrl(runner, r, '--upload-pack=touch x')).rejects.toBeTruthy()
  })
})
