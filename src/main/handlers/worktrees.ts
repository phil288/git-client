import type { MergeMode, WorktreeForce } from '@shared/types'
import type { MainContext } from '../context'
import { AppError } from '../git/errors'
import * as wt from '../git/worktrees'
import { assert } from '../ipcRegistry'

const MERGE_MODES: MergeMode[] = ['default', 'no-ff', 'ff-only']

/** Linked worktrees: list, add, remove (-f / -f -f), lock, prune, merge into another branch. */
export function registerWorktreeHandlers(ctx: MainContext): void {
  const { handle, runner } = ctx
  const root = (v: unknown) => {
    ctx.requireGit()
    return assert.nonEmptyString(v, 'root')
  }
  /** Runs a mutating op and tells the renderer which repos changed (the merge may run in another worktree). */
  const mutate = async <T>(r: string, fn: () => Promise<T>, others: () => (string | null)[] = () => []): Promise<T> => {
    try {
      return await fn()
    } finally {
      ctx.notifyRepoChanged(r)
      for (const p of others()) if (p) ctx.notifyRepoChanged(p)
    }
  }
  const str = (v: unknown, n: string) => assert.nonEmptyString(v, n)
  const force = (v: unknown): WorktreeForce => {
    if (v !== 0 && v !== 1 && v !== 2) throw new TypeError('force must be 0, 1 or 2')
    return v
  }

  handle('worktree:list', (_e, r0) => wt.listWorktrees(runner, root(r0)))
  handle('worktree:suggestPath', (_e, r0, name) => wt.suggestWorktreePath(runner, root(r0), assert.string(name, 'name')))
  handle('worktree:defaultBranch', (_e, r0) => wt.defaultBranch(runner, root(r0)))
  handle('worktree:add', (_e, r0, path, start, nb) => {
    const r = root(r0)
    return mutate(r, () => wt.addWorktree(runner, r, str(path, 'path'), str(start, 'start'), assert.nullableString(nb, 'newBranch')))
  })
  handle('worktree:remove', (_e, r0, path, f) => {
    const r = root(r0)
    return mutate(r, () => wt.removeWorktree(runner, r, str(path, 'path'), force(f)))
  })
  handle('worktree:lock', (_e, r0, path, reason) => {
    const r = root(r0)
    return mutate(r, () => wt.lockWorktree(runner, r, str(path, 'path'), assert.nullableString(reason, 'reason')))
  })
  handle('worktree:unlock', (_e, r0, path) => {
    const r = root(r0)
    return mutate(r, () => wt.unlockWorktree(runner, r, str(path, 'path')))
  })
  handle('worktree:prune', (_e, r0) => {
    const r = root(r0)
    return mutate(r, () => wt.pruneWorktrees(runner, r))
  })
  handle('worktree:mergeInto', (_e, r0, source, target, mode) => {
    const r = root(r0)
    if (!MERGE_MODES.includes(mode)) throw new AppError('Invalid merge mode', 'INVALID_ARGUMENT')
    let mergedIn: string | null = null
    return mutate(
      r,
      async () => {
        const res = await wt.mergeInto(runner, r, str(source, 'source'), str(target, 'target'), mode)
        mergedIn = res.mergedIn
        return res
      },
      () => [mergedIn]
    )
  })
}
