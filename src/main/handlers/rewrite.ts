import { writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { RebaseAction, RebaseTodoItem, ResetMode, RewritePlan } from '@shared/types'
import type { MainContext } from '../context'
import { listBackups } from '../git/backup'
import { AppError } from '../git/errors'
import * as rw from '../git/rewrite'
import { abortOperation, continueOperation, operationState, skipOperation } from '../git/sequencer'
import { assert } from '../ipcRegistry'

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']
const RESET_MODES: ResetMode[] = ['soft', 'mixed', 'hard', 'keep']

function sanitizePlan(p: unknown): RewritePlan {
  const o = (p ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.items) || o.items.length === 0) throw new AppError('Empty rewrite plan', 'INVALID_ARGUMENT')
  const items: RebaseTodoItem[] = o.items.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>
    if (!ACTIONS.includes(i.action as RebaseAction)) throw new AppError('Invalid rebase action', 'INVALID_ARGUMENT')
    return {
      action: i.action as RebaseAction,
      hash: assert.nonEmptyString(i.hash, 'hash'),
      subject: typeof i.subject === 'string' ? i.subject : '',
      message: typeof i.message === 'string' ? i.message : undefined
    }
  })
  return {
    base: o.base === null ? null : assert.nonEmptyString(o.base, 'base'),
    items,
    autostash: o.autostash === true,
    rebaseMerges: o.rebaseMerges === true
  }
}

export function registerRewriteHandlers(ctx: MainContext): void {
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
  const hashes = (v: unknown) => {
    const list = assert.stringArray(v, 'hashes')
    if (list.length === 0) throw new AppError('No commits selected', 'INVALID_ARGUMENT')
    return list
  }

  handle('rewrite:commits', (_e, r0, base) => rw.rangeCommits(runner, root(r0), assert.nullableString(base, 'base')))
  handle('rewrite:check', (_e, r0, base, hs) => rw.checkRewrite(runner, root(r0), assert.nullableString(base, 'base'), assert.stringArray(hs, 'hashes')))
  handle('rewrite:run', (_e, r0, plan, op) => {
    const r = root(r0)
    return mutate(r, () => rw.runRewrite(runner, r, sanitizePlan(plan), typeof op === 'string' && op ? op : 'rewrite'))
  })
  handle('rewrite:amendHead', (_e, r0, message) => {
    const r = root(r0)
    return mutate(r, () => rw.amendHeadMessage(runner, r, assert.string(message, 'message')))
  })
  handle('rewrite:reset', (_e, r0, target, mode) => {
    const r = root(r0)
    if (!RESET_MODES.includes(mode)) throw new AppError('Invalid reset mode', 'INVALID_ARGUMENT')
    return mutate(r, () => rw.reset(runner, r, assert.nonEmptyString(target, 'target'), mode))
  })
  handle('rewrite:undoCommit', (_e, r0) => {
    const r = root(r0)
    return mutate(r, () => rw.undoCommit(runner, r))
  })
  handle('rewrite:cherryPick', (_e, r0, hs) => {
    const r = root(r0)
    return mutate(r, () => rw.cherryPick(runner, r, hashes(hs)))
  })
  handle('rewrite:revert', (_e, r0, hs) => {
    const r = root(r0)
    return mutate(r, () => rw.revert(runner, r, hashes(hs)))
  })
  handle('rewrite:patch', (_e, r0, hs) => rw.createPatch(runner, root(r0), hashes(hs)))
  handle('rewrite:reflog', (_e, r0) => rw.reflog(runner, root(r0)))
  handle('rewrite:backups', (_e, r0) => listBackups(runner, root(r0)))
  handle('rewrite:undoLast', (_e, r0, hard) => {
    const r = root(r0)
    return mutate(r, () => rw.undoLast(runner, r, assert.boolean(hard, 'hard')))
  })
  handle('op:state', (_e, r0) => operationState(runner, root(r0)))
  handle('op:continue', (_e, r0, message) => {
    const r = root(r0)
    return mutate(r, () => continueOperation(runner, r, assert.nullableString(message, 'message') ?? undefined))
  })
  handle('op:skip', (_e, r0) => {
    const r = root(r0)
    return mutate(r, () => skipOperation(runner, r))
  })
  handle('op:abort', (_e, r0) => {
    const r = root(r0)
    return mutate(r, () => abortOperation(runner, r))
  })
  handle('dialog:saveText', async (_e, title, defaultName, content) => {
    const opts = { title: assert.string(title, 'title'), defaultPath: assert.string(defaultName, 'defaultName') }
    const win = ctx.window()
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, assert.string(content, 'content'))
    return res.filePath
  })
}
