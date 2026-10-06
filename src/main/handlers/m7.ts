import type { RemoteUpdate } from '@shared/types'
import type { MainContext } from '../context'
import { blame, fileHistory } from '../git/history'
import * as st from '../git/stash'
import * as tr from '../git/tagsRemotes'
import { assert } from '../ipcRegistry'

/** Stash, file history, blame, tags and remotes. */
export function registerM7Handlers(ctx: MainContext): void {
  const { handle, runner } = ctx
  const root = (v: unknown) => {
    ctx.requireGit()
    return assert.nonEmptyString(v, 'root')
  }
  const mutate = async <T>(r: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } finally {
      ctx.notifyRepoChanged(r)
    }
  }
  const idx = (v: unknown) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new TypeError('invalid stash index')
    return n
  }
  const str = (v: unknown, n: string) => assert.nonEmptyString(v, n)

  handle('stash:list', (_e, r0) => st.listStashes(runner, root(r0)))
  handle('stash:files', (_e, r0, i) => st.stashFiles(runner, root(r0), idx(i)))
  handle('stash:push', (_e, r0, msg, u, k) => {
    const r = root(r0)
    return mutate(r, () => st.stashPush(runner, r, assert.string(msg, 'message'), assert.boolean(u, 'includeUntracked'), assert.boolean(k, 'keepIndex')))
  })
  handle('stash:apply', (_e, r0, i, ri) => {
    const r = root(r0)
    return mutate(r, () => st.stashApply(runner, r, idx(i), assert.boolean(ri, 'reinstateIndex')))
  })
  handle('stash:pop', (_e, r0, i, ri) => {
    const r = root(r0)
    return mutate(r, () => st.stashPop(runner, r, idx(i), assert.boolean(ri, 'reinstateIndex')))
  })
  handle('stash:drop', (_e, r0, i) => {
    const r = root(r0)
    return mutate(r, () => st.stashDrop(runner, r, idx(i)))
  })
  handle('stash:branch', (_e, r0, name, i) => {
    const r = root(r0)
    return mutate(r, () => st.stashBranch(runner, r, str(name, 'name'), idx(i)))
  })
  handle('history:file', (_e, r0, p) => fileHistory(runner, root(r0), str(p, 'path')))
  handle('history:blame', (_e, r0, p, rev) => blame(runner, root(r0), str(p, 'path'), assert.nullableString(rev, 'rev')))
  handle('tag:list', (_e, r0) => tr.listTags(runner, root(r0)))
  handle('tag:create', (_e, r0, name, target, msg) => {
    const r = root(r0)
    return mutate(r, () => tr.createTag(runner, r, str(name, 'name'), str(target, 'target'), assert.nullableString(msg, 'message')))
  })
  handle('tag:delete', (_e, r0, name) => {
    const r = root(r0)
    return mutate(r, () => tr.deleteTag(runner, r, str(name, 'name')))
  })
  handle('tag:push', (_e, r0, remote, name, opId) => {
    const r = root(r0)
    return ctx.ops.run(str(opId, 'opId'), `Pushing tag ${name}`, true, (op) => tr.pushTag(runner, r, str(remote, 'remote'), str(name, 'name'), op.signal, op.progress))
  })
  handle('tag:deleteRemote', (_e, r0, remote, name, opId) => {
    const r = root(r0)
    return ctx.ops.run(str(opId, 'opId'), `Deleting tag ${name} on ${remote}`, true, (op) =>
      tr.deleteRemoteTag(runner, r, str(remote, 'remote'), str(name, 'name'), op.signal)
    )
  })
  handle('remote:add', (_e, r0, name, url, pushUrl) => {
    const r = root(r0)
    return mutate(r, () => tr.addRemote(runner, r, str(name, 'name'), str(url, 'url'), assert.nullableString(pushUrl, 'pushUrl')))
  })
  handle('remote:update', (_e, r0, name, u) => {
    const r = root(r0)
    const p = u as RemoteUpdate | undefined
    const update: RemoteUpdate = { name: str(p?.name, 'new name'), fetchUrl: str(p?.fetchUrl, 'fetchUrl'), pushUrl: assert.nullableString(p?.pushUrl, 'pushUrl') }
    return mutate(r, () => tr.updateRemote(runner, r, str(name, 'name'), update))
  })
  handle('remote:test', (_e, r0, url, opId) => {
    const r = root(r0)
    return ctx.ops.run(str(opId, 'opId'), 'Testing connection', true, (op) => tr.testRemoteUrl(runner, r, str(url, 'url'), op.signal))
  })
  handle('remote:setUrl', (_e, r0, name, url, push) => {
    const r = root(r0)
    return mutate(r, () => tr.setRemoteUrl(runner, r, str(name, 'name'), str(url, 'url'), assert.boolean(push, 'push')))
  })
  handle('remote:remove', (_e, r0, name) => {
    const r = root(r0)
    return mutate(r, () => tr.removeRemote(runner, r, str(name, 'name')))
  })
  handle('remote:rename', (_e, r0, o, n) => {
    const r = root(r0)
    return mutate(r, () => tr.renameRemote(runner, r, str(o, 'old'), str(n, 'new')))
  })
  handle('remote:prune', (_e, r0, name, opId) => {
    const r = root(r0)
    return mutate(r, () => ctx.ops.run(str(opId, 'opId'), `Pruning ${name}`, true, (op) => tr.pruneRemote(runner, r, str(name, 'name'), op.signal)))
  })
}
