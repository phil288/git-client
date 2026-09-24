import type { MainContext } from '../context'
import * as wt from '../git/workingTree'
import { assert } from '../ipcRegistry'
import { getPrefs, updatePrefs } from './branches'

export function registerWorkingTreeHandlers(ctx: MainContext): void {
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
  const paths = (v: unknown) => assert.stringArray(v, 'paths')

  handle('wt:status', (_e, r0) => wt.workingStatus(runner, root(r0)))
  handle('wt:hunks', (_e, r0, p) => wt.fileHunks(runner, root(r0), assert.nonEmptyString(p, 'path')))
  handle('wt:stage', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => wt.stageFiles(runner, r, paths(ps)))
  })
  handle('wt:unstage', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => wt.unstageFiles(runner, r, paths(ps)))
  })
  handle('wt:discard', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => wt.discardFiles(runner, r, paths(ps)))
  })
  handle('wt:stageHunks', (_e, r0, p, ids) => {
    const r = root(r0)
    return mutate(r, () => wt.stageHunks(runner, r, assert.nonEmptyString(p, 'path'), assert.stringArray(ids, 'hunkIds')))
  })
  handle('wt:unstageHunks', (_e, r0, p, ids) => {
    const r = root(r0)
    return mutate(r, () => wt.unstageHunks(runner, r, assert.nonEmptyString(p, 'path'), assert.stringArray(ids, 'hunkIds')))
  })
  handle('wt:discardHunks', (_e, r0, p, ids) => {
    const r = root(r0)
    return mutate(r, () => wt.discardHunks(runner, r, assert.nonEmptyString(p, 'path'), assert.stringArray(ids, 'hunkIds')))
  })
  handle('wt:commit', (_e, r0, message, o) => {
    const r = root(r0)
    const msg = assert.string(message, 'message')
    const opts = (o ?? {}) as { amend?: unknown; signOff?: unknown }
    return mutate(r, async () => {
      const hash = await wt.commit(runner, r, msg, { amend: opts.amend === true, signOff: opts.signOff === true })
      const recent = getPrefs(ctx, r).recentMessages.filter((m) => m !== msg)
      updatePrefs(ctx, r, { recentMessages: [msg, ...recent].slice(0, 20) })
      return hash
    })
  })
  handle('wt:lastMessage', (_e, r0) => wt.lastCommitMessage(runner, root(r0)))
}
