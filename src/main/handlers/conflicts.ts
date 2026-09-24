import type { FileContent } from '@shared/types'
import type { MainContext } from '../context'
import * as cf from '../git/conflicts'
import { AppError } from '../git/errors'
import { assert } from '../ipcRegistry'

const ENCODINGS: FileContent['encoding'][] = ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'latin1']

export function registerConflictHandlers(ctx: MainContext, gitVersion: () => [number, number, number]): void {
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

  handle('conflicts:state', (_e, r0) => cf.conflictState(runner, root(r0)))
  handle('conflicts:versions', (_e, r0, p) => cf.conflictVersions(runner, root(r0), assert.nonEmptyString(p, 'path')))
  handle('conflicts:acceptSide', (_e, r0, ps, side) => {
    const r = root(r0)
    if (side !== 'yours' && side !== 'theirs') throw new AppError('Invalid side', 'INVALID_ARGUMENT')
    return mutate(r, () => cf.acceptSide(runner, r, paths(ps), side))
  })
  handle('conflicts:resolveSubmodule', (_e, r0, p, sha) => {
    const r = root(r0)
    return mutate(r, () => cf.resolveSubmodule(runner, r, assert.nonEmptyString(p, 'path'), assert.nonEmptyString(sha, 'sha')))
  })
  handle('conflicts:markResolved', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => cf.markResolved(runner, r, paths(ps)))
  })
  handle('conflicts:delete', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => cf.resolveDelete(runner, r, paths(ps)))
  })
  handle('conflicts:save', (_e, r0, p, text, enc) => {
    const r = root(r0)
    if (!ENCODINGS.includes(enc)) throw new AppError('Invalid encoding', 'INVALID_ARGUMENT')
    return mutate(r, () => cf.saveResolution(runner, r, assert.nonEmptyString(p, 'path'), assert.string(text, 'text'), enc))
  })
  handle('conflicts:autoResolve', (_e, r0, ps) => {
    const r = root(r0)
    return mutate(r, () => cf.autoResolve(runner, r, ps === null ? undefined : paths(ps)))
  })
  handle('conflicts:mergeTool', (_e, r0, p) => {
    const r = root(r0)
    return mutate(r, () => cf.runMergeTool(runner, r, assert.nonEmptyString(p, 'path'), ctx.settings().mergeTool))
  })
  handle('conflicts:preview', (_e, r0, ref) => cf.previewMerge(runner, root(r0), assert.nonEmptyString(ref, 'ref'), gitVersion()))
  handle('conflicts:getRerere', (_e, r0) => cf.getRerere(runner, root(r0)))
  handle('conflicts:setRerere', (_e, r0, on) => cf.setRerere(runner, root(r0), assert.boolean(on, 'enabled')))
  handle('conflicts:configuredTool', (_e, r0) => cf.configuredMergeTool(runner, root(r0)))
}
