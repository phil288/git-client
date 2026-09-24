import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { RebaseTodoItem } from '@shared/types'
import { listBackups } from '../../src/main/git/backup'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import * as rw from '../../src/main/git/rewrite'
import { GitRunner } from '../../src/main/git/runner'
import { abortOperation, continueOperation, operationState, skipOperation } from '../../src/main/git/sequencer'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir()

beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

const subjects = (r: string, n = 10) => git(r, 'log', '--format=%s', `-${n}`).trim().split('\n')
const hashOf = (r: string, subject: string) => git(r, 'log', '--all', '--format=%H', `--grep=^${subject}$`).trim().split('\n')[0]!

/** initial, c1, c2, c3 (each touching its own file). */
function linear(name: string): string {
  const r = initRepo(join(root, name))
  for (const n of [1, 2, 3]) commitFile(r, `f${n}.txt`, `${n}\n`, `c${n}`)
  return r
}

async function plan(r: string, base: string, edit: (items: RebaseTodoItem[]) => RebaseTodoItem[], extra: Partial<Parameters<typeof rw.runRewrite>[2]> = {}) {
  const commits = await rw.rangeCommits(runner, r, base)
  const items = edit(commits.map((c) => ({ action: 'pick' as const, hash: c.hash, subject: c.subject })))
  return rw.runRewrite(runner, r, { base, items, ...extra })
}

describe('history rewriting via scripted rebase -i', () => {
  it('rewords a non-HEAD commit (exec amend -F) and keeps a backup ref', async () => {
    const r = linear('reword')
    const base = hashOf(r, 'initial')
    const out = await plan(r, base, (items) => items.map((i) => (i.subject === 'c2' ? { ...i, action: 'reword', message: 'c2 reworded\n\nwith a body' } : i)))
    expect(out.status).toBe('ok')
    expect(subjects(r, 4)).toEqual(['c3', 'c2 reworded', 'c1', 'initial'])
    expect(git(r, 'log', '-1', '--skip=1', '--format=%B').trim()).toBe('c2 reworded\n\nwith a body')
    expect((await listBackups(runner, r))[0]).toMatchObject({ branch: 'main', operation: 'rewrite' })
  })

  it('rewords HEAD with --amend --only (staged changes stay staged)', async () => {
    const r = linear('reword-head')
    write(r, 'staged.txt', 's')
    git(r, 'add', 'staged.txt')
    await rw.amendHeadMessage(runner, r, 'c3 better')
    expect(subjects(r, 1)).toEqual(['c3 better'])
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('staged.txt')
  })

  it('squashes with an edited combined message, fixes up, drops and reorders', async () => {
    const r = linear('squash')
    const base = hashOf(r, 'initial')
    await plan(r, base, (items) => items.map((i) => (i.subject === 'c3' ? { ...i, action: 'squash', message: 'c2 + c3 combined' } : i)))
    expect(subjects(r, 3)).toEqual(['c2 + c3 combined', 'c1', 'initial'])
    expect(git(r, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['f2.txt', 'f3.txt'])

    const r2 = linear('fixup-drop-reorder')
    const b2 = hashOf(r2, 'initial')
    await plan(r2, b2, (items) => {
      const [c1, c2, c3] = items
      return [{ ...c3!, action: 'pick' }, { ...c1!, action: 'fixup' }, { ...c2!, action: 'drop' }]
    })
    expect(subjects(r2, 3)).toEqual(['c3', 'initial'])
    expect(existsSync(join(r2, 'f1.txt'))).toBe(true) // fixed up into c3
    expect(existsSync(join(r2, 'f2.txt'))).toBe(false) // dropped
  })

  it('refuses a plan starting with squash/fixup', async () => {
    const r = linear('invalid')
    await expect(plan(r, hashOf(r, 'initial'), (items) => [{ ...items[0]!, action: 'fixup' }, ...items.slice(1)])).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })

  it('stops for "edit" and continues', async () => {
    const r = linear('edit')
    const out = await plan(r, hashOf(r, 'initial'), (items) => items.map((i) => (i.subject === 'c2' ? { ...i, action: 'edit' } : i)))
    expect(out.status).toBe('stopped')
    const st = await operationState(runner, r)
    expect(st.operation).toBe('rebase')
    expect(st.title).toBe('Rebasing main onto ' + st.ontoName)
    write(r, 'f2.txt', '2 edited\n')
    git(r, 'commit', '-q', '-a', '--amend', '--no-edit')
    expect((await continueOperation(runner, r)).status).toBe('ok')
    expect(readFileSync(join(r, 'f2.txt'), 'utf8')).toBe('2 edited\n')
    expect(subjects(r, 4)).toEqual(['c3', 'c2', 'c1', 'initial'])
  })

  it('dirty working tree: DIRTY unless autostash, which stashes and restores', async () => {
    const r = linear('dirty')
    write(r, 'f1.txt', 'local edit\n')
    const base = hashOf(r, 'initial')
    const check = await rw.checkRewrite(runner, r, base, [hashOf(r, 'c2')])
    expect(check.dirty).toBe(true)
    await expect(plan(r, base, (i) => i.map((x) => (x.subject === 'c2' ? { ...x, action: 'reword', message: 'x' } : x)))).rejects.toMatchObject({ code: 'DIRTY' })
    const out = await plan(r, base, (i) => i.map((x) => (x.subject === 'c2' ? { ...x, action: 'reword', message: 'c2 new' } : x)), { autostash: true })
    expect(out.status).toBe('ok')
    expect(readFileSync(join(r, 'f1.txt'), 'utf8')).toBe('local edit\n')
    expect(subjects(r, 2)).toEqual(['c3', 'c2 new'])
  })

  it('detects pushed commits and merge commits; rebase-merges mode rewords around a merge', async () => {
    const origin = join(root, 'pushed-origin.git')
    git(root, 'init', '-q', '--bare', origin)
    const r = linear('pushed')
    git(r, 'remote', 'add', 'origin', origin)
    git(r, 'push', '-q', '-u', 'origin', 'main')
    commitFile(r, 'f4.txt', '4\n', 'c4')
    const base = hashOf(r, 'c1')
    expect((await rw.checkRewrite(runner, r, base, [hashOf(r, 'c2')])).pushed).toBe(true)
    expect((await rw.checkRewrite(runner, r, base, [hashOf(r, 'c4')])).pushed).toBe(false)

    // Merge in range.
    git(r, 'checkout', '-q', '-b', 'side', 'HEAD~1')
    commitFile(r, 's.txt', 's\n', 'side work')
    git(r, 'checkout', '-q', 'main')
    git(r, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    commitFile(r, 'f5.txt', '5\n', 'c5')
    const b = hashOf(r, 'c3')
    expect((await rw.checkRewrite(runner, r, b, [hashOf(r, 'c4')])).containsMerges).toBe(true)
    const reword = (items: RebaseTodoItem[]) => items.map((i) => (i.subject === 'c4' ? { ...i, action: 'reword' as const, message: 'c4 reworded' } : i))
    await expect(plan(r, b, reword)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const commits = (await rw.rangeCommits(runner, r, b)).filter((c) => c.parents.length < 2)
    const out = await rw.runRewrite(runner, r, {
      base: b,
      rebaseMerges: true,
      items: reword(commits.map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject })))
    })
    expect(out.status).toBe('ok')
    expect(git(r, 'log', '--format=%s', '--first-parent', '-4').trim().split('\n')).toEqual(['c5', 'merge side', 'c4 reworded', 'c3'])
    expect(git(r, 'rev-list', '--min-parents=2', '--count', 'HEAD').trim()).toBe('1')
  })

  it('conflict during a rewrite: stop, resolve, continue, finish — or abort to the original', async () => {
    const make = (name: string) => {
      const r = initRepo(join(root, name))
      commitFile(r, 'x.txt', 'a\n', 'x = a')
      commitFile(r, 'x.txt', 'b\n', 'x = b')
      commitFile(r, 'y.txt', 'y\n', 'add y')
      return r
    }
    // Reordering "x = b" before "x = a" conflicts.
    const r = make('conflict')
    const base = hashOf(r, 'initial')
    const reorder = (items: RebaseTodoItem[]) => [items[1]!, items[0]!, items[2]!]
    const out = await plan(r, base, reorder)
    expect(out.status).toBe('conflicts')
    let st = await operationState(runner, r)
    expect(st).toMatchObject({ operation: 'rebase', headName: 'main', step: 1, total: 3, conflicted: ['x.txt'] })
    await expect(continueOperation(runner, r)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    write(r, 'x.txt', 'b\n')
    git(r, 'add', 'x.txt')
    const next = await continueOperation(runner, r)
    // Next step (x = a on top of x = b) conflicts again.
    expect(next.status).toBe('conflicts')
    write(r, 'x.txt', 'a\n')
    git(r, 'add', 'x.txt')
    expect((await continueOperation(runner, r)).status).toBe('ok')
    st = await operationState(runner, r)
    expect(st.operation).toBeNull()
    expect(subjects(r, 4)).toEqual(['add y', 'x = a', 'x = b', 'initial'])

    const r2 = make('conflict-abort')
    const before = git(r2, 'rev-parse', 'HEAD').trim()
    expect((await plan(r2, hashOf(r2, 'initial'), reorder)).status).toBe('conflicts')
    await abortOperation(runner, r2)
    expect(git(r2, 'rev-parse', 'HEAD').trim()).toBe(before)

    const r3 = make('conflict-skip')
    expect((await plan(r3, hashOf(r3, 'initial'), reorder)).status).toBe('conflicts')
    const skipped = await skipOperation(runner, r3)
    expect(['conflicts', 'ok']).toContain(skipped.status)
  })
})

describe('reset / undo / cherry-pick / revert / patch / reflog', () => {
  it('reset modes and undo-last restore via backup refs', async () => {
    const r = linear('reset')
    const c1 = hashOf(r, 'c1')
    const head = git(r, 'rev-parse', 'HEAD').trim()
    await rw.reset(runner, r, c1, 'soft')
    expect(git(r, 'diff', '--cached', '--name-only').trim().split('\n').sort()).toEqual(['f2.txt', 'f3.txt'])
    const undone = await rw.undoLast(runner, r, false)
    expect(undone.operation).toBe('reset-soft')
    expect(git(r, 'rev-parse', 'HEAD').trim()).toBe(head)

    await rw.reset(runner, r, c1, 'hard')
    expect(existsSync(join(r, 'f3.txt'))).toBe(false)
    await rw.undoLast(runner, r, false)
    expect(existsSync(join(r, 'f3.txt'))).toBe(true)
    await expect(rw.undoLast(runner, r, false)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' }) // nothing left
  })

  it('undo last refuses to overwrite local changes unless hard', async () => {
    const r = linear('undo-dirty')
    await rw.amendHeadMessage(runner, r, 'c3 renamed')
    await rw.reset(runner, r, hashOf(r, 'c1'), 'mixed')
    write(r, 'f3.txt', 'local\n')
    await expect(rw.undoLast(runner, r, false)).rejects.toMatchObject({ code: 'DIRTY' })
    await rw.undoLast(runner, r, true)
    expect(subjects(r, 1)).toEqual(['c3 renamed'])
  })

  it('undo commit keeps the changes staged', async () => {
    const r = linear('undo-commit')
    await rw.undoCommit(runner, r)
    expect(subjects(r, 1)).toEqual(['c2'])
    expect(git(r, 'diff', '--cached', '--name-only').trim()).toBe('f3.txt')
  })

  it('cherry-picks and reverts, with conflicts as outcomes', async () => {
    const r = linear('pick')
    git(r, 'checkout', '-q', '-b', 'other', hashOf(r, 'initial'))
    const out = await rw.cherryPick(runner, r, [hashOf(r, 'c1'), hashOf(r, 'c2')])
    expect(out.status).toBe('ok')
    expect(subjects(r, 3)).toEqual(['c2', 'c1', 'initial'])
    expect((await rw.revert(runner, r, [git(r, 'rev-parse', 'HEAD').trim()])).status).toBe('ok')
    expect(existsSync(join(r, 'f2.txt'))).toBe(false)

    const c = initRepo(join(root, 'pick-conflict'))
    git(c, 'checkout', '-q', '-b', 't')
    commitFile(c, 'README.md', 'theirs\n', 'theirs')
    git(c, 'checkout', '-q', 'main')
    commitFile(c, 'README.md', 'ours\n', 'ours')
    expect((await rw.cherryPick(runner, c, [git(c, 'rev-parse', 't').trim()])).status).toBe('conflicts')
    expect((await operationState(runner, c)).operation).toBe('cherry-pick')
    await abortOperation(runner, c)
    expect((await operationState(runner, c)).operation).toBeNull()
  })

  it('creates patches and reads the reflog', async () => {
    const r = linear('patch')
    const p = await rw.createPatch(runner, r, [hashOf(r, 'c1'), hashOf(r, 'c2')])
    expect(p.match(/^From [0-9a-f]{40} /gm)).toHaveLength(2)
    expect(p).toContain('Subject: [PATCH] c2')
    const log = await rw.reflog(runner, r)
    expect(log[0]!.message).toMatch(/commit/)
  })
})
