import type { MergeMode, PullMode, PushOptions, RepoPrefs } from '@shared/types'
import type { MainContext } from '../context'
import * as br from '../git/branches'
import { AppError } from '../git/errors'
import { assert } from '../ipcRegistry'
import { pathKey } from '../paths'

const MERGE_MODES: MergeMode[] = ['default', 'no-ff', 'ff-only', 'squash']
const PULL_MODES: PullMode[] = ['merge', 'rebase', 'ff-only']

export function getPrefs(ctx: MainContext, root: string): RepoPrefs {
  const all = ctx.store.get('repoPrefs') ?? {}
  const p = all[pathKey(root)]
  return { favorites: p?.favorites ?? [], recentMessages: p?.recentMessages ?? [] }
}

export function updatePrefs(ctx: MainContext, root: string, patch: Partial<RepoPrefs>): RepoPrefs {
  const cur = getPrefs(ctx, root)
  const next: RepoPrefs = {
    favorites: Array.isArray(patch.favorites) ? patch.favorites.filter((x) => typeof x === 'string').slice(0, 200) : cur.favorites,
    recentMessages: Array.isArray(patch.recentMessages)
      ? patch.recentMessages.filter((x) => typeof x === 'string').slice(0, 20)
      : cur.recentMessages
  }
  ctx.store.set('repoPrefs', { ...(ctx.store.get('repoPrefs') ?? {}), [pathKey(root)]: next })
  return next
}

export function registerBranchHandlers(ctx: MainContext): void {
  const { handle, runner } = ctx
  const root = (v: unknown) => {
    ctx.requireGit()
    return assert.nonEmptyString(v, 'root')
  }
  /** Runs a mutating op and tells the renderer the repo changed. */
  const mutate = async <T>(r: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } finally {
      ctx.notifyRepoChanged(r)
    }
  }
  const opts = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

  handle('branch:checkout', (_e, r0, target, o) => {
    const r = root(r0)
    return mutate(r, () => br.checkout(runner, r, assert.nonEmptyString(target, 'target'), { force: opts(o).force === true, detach: opts(o).detach === true }))
  })
  handle('branch:smartCheckout', (_e, r0, target, o) => {
    const r = root(r0)
    return mutate(r, () => br.smartCheckout(runner, r, assert.nonEmptyString(target, 'target'), { detach: opts(o).detach === true }))
  })
  handle('branch:checkoutRemote', (_e, r0, rb0, local0, o) => {
    const r = root(r0)
    const rb = assert.nonEmptyString(rb0, 'remoteBranch')
    const local = assert.nonEmptyString(local0, 'localName')
    return mutate(r, async () => {
      if (opts(o).smart === true) {
        await br.ensureTrackingBranch(runner, r, rb, local)
        return br.smartCheckout(runner, r, local)
      }
      await br.checkoutRemote(runner, r, rb, local, { force: opts(o).force === true })
      return { status: 'ok' as const, message: `Checked out ${local} (tracking ${rb})` }
    })
  })
  handle('branch:create', (_e, r0, name, start, co) => {
    const r = root(r0)
    return mutate(r, () => br.createBranch(runner, r, assert.nonEmptyString(name, 'name'), assert.nonEmptyString(start, 'start'), assert.boolean(co, 'checkout')))
  })
  handle('branch:checkName', (_e, r0, name) => br.checkRefFormat(runner, root(r0), assert.string(name, 'name')))
  handle('branch:rename', (_e, r0, o, n, remote, opId) => {
    const r = root(r0)
    return mutate(r, () =>
      ctx.ops.run(assert.nonEmptyString(opId, 'opId'), `Renaming ${o}`, false, (op) =>
        br.renameBranch(runner, r, assert.nonEmptyString(o, 'old'), assert.nonEmptyString(n, 'new'), assert.boolean(remote, 'renameRemote'), op.progress)
      )
    )
  })
  handle('branch:delete', (_e, r0, name, force) => {
    const r = root(r0)
    return mutate(r, () => br.deleteBranch(runner, r, assert.nonEmptyString(name, 'name'), assert.boolean(force, 'force')))
  })
  handle('branch:restore', (_e, r0, name, sha) => {
    const r = root(r0)
    return mutate(r, () => br.restoreBranch(runner, r, assert.nonEmptyString(name, 'name'), assert.nonEmptyString(sha, 'sha')))
  })
  handle('branch:deleteRemote', (_e, r0, remote, b, opId) => {
    const r = root(r0)
    return mutate(r, () =>
      ctx.ops.run(assert.nonEmptyString(opId, 'opId'), `Deleting ${remote}/${b}`, true, (op) =>
        br.deleteRemoteBranch(runner, r, assert.nonEmptyString(remote, 'remote'), assert.nonEmptyString(b, 'branch'), op.progress)
      )
    )
  })
  handle('branch:deleteRemoteMany', (_e, r0, remote, bs, opId) => {
    const r = root(r0)
    const list = assert.stringArray(bs, 'branches')
    return mutate(r, () =>
      ctx.ops.run(assert.nonEmptyString(opId, 'opId'), `Deleting ${list.length} branches on ${remote}`, true, (op) =>
        br.deleteRemoteBranches(runner, r, assert.nonEmptyString(remote, 'remote'), list, op.progress)
      )
    )
  })
  handle('branch:setUpstream', (_e, r0, b, up) => {
    const r = root(r0)
    return mutate(r, () => br.setUpstream(runner, r, assert.nonEmptyString(b, 'branch'), assert.nullableString(up, 'upstream')))
  })
  handle('branch:merge', (_e, r0, ref, mode) => {
    const r = root(r0)
    if (!MERGE_MODES.includes(mode)) throw new AppError('Invalid merge mode', 'INVALID_ARGUMENT')
    return mutate(r, () => br.merge(runner, r, assert.nonEmptyString(ref, 'ref'), mode))
  })
  handle('branch:rebase', (_e, r0, onto, b) => {
    const r = root(r0)
    return mutate(r, () => br.rebase(runner, r, assert.nonEmptyString(onto, 'onto'), assert.nullableString(b, 'branch') ?? undefined))
  })
  handle('branch:compare', (_e, r0, a, b) => br.compare(runner, root(r0), assert.nonEmptyString(a, 'a'), assert.nonEmptyString(b, 'b')))
  handle('branch:recent', (_e, r0) => br.recentBranches(runner, root(r0)))
  handle('remote:list', (_e, r0) => br.listRemotes(runner, root(r0)))
  handle('remote:fetch', (_e, r0, remote, prune, opId) => {
    const r = root(r0)
    const name = assert.nullableString(remote, 'remote')
    return mutate(r, () =>
      ctx.ops.run(assert.nonEmptyString(opId, 'opId'), name ? `Fetching ${name}` : 'Fetching all remotes', true, (op) =>
        br.fetch(runner, r, name, assert.boolean(prune, 'prune'), op.signal, op.progress)
      )
    )
  })
  handle('remote:pull', (_e, r0, mode, opId) => {
    const r = root(r0)
    if (!PULL_MODES.includes(mode)) throw new AppError('Invalid pull mode', 'INVALID_ARGUMENT')
    return mutate(r, () => ctx.ops.run(assert.nonEmptyString(opId, 'opId'), 'Pulling', true, (op) => br.pull(runner, r, mode, op.signal, op.progress)))
  })
  handle('remote:push', (_e, r0, o, opId) => {
    const r = root(r0)
    const p = o as PushOptions
    const options: PushOptions = {
      remote: assert.nonEmptyString(p?.remote, 'remote'),
      branch: assert.nonEmptyString(p?.branch, 'branch'),
      remoteBranch: assert.nonEmptyString(p?.remoteBranch, 'remoteBranch'),
      setUpstream: p?.setUpstream === true,
      forceWithLease: p?.forceWithLease === true,
      tags: p?.tags === true
    }
    return mutate(r, () =>
      ctx.ops.run(assert.nonEmptyString(opId, 'opId'), `Pushing ${options.branch} to ${options.remote}`, true, (op) =>
        br.push(runner, r, options, op.signal, op.progress)
      )
    )
  })
  handle('remote:outgoing', (_e, r0, b, remote, rb) =>
    br.outgoing(runner, root(r0), assert.nonEmptyString(b, 'branch'), assert.nonEmptyString(remote, 'remote'), assert.nonEmptyString(rb, 'remoteBranch'))
  )
  handle('prefs:get', (_e, r0) => getPrefs(ctx, assert.nonEmptyString(r0, 'root')))
  handle('prefs:update', (_e, r0, patch) => updatePrefs(ctx, assert.nonEmptyString(r0, 'root'), (patch ?? {}) as Partial<RepoPrefs>))
}
