import { dialog } from 'electron'
import type { LogQuery } from '@shared/types'
import { AppError } from '../git/errors'
import type { MainContext } from '../context'
import { assert } from '../ipcRegistry'
import { changedFiles, changesAgainstWorktree, commitDetails, containingRefs, fileBase64, fileContent, listRefs } from '../git/repoData'

function sanitizeQuery(q: unknown): LogQuery {
  const o = (q ?? {}) as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
  return {
    revs: strings(o.revs),
    text: str(o.text),
    regex: o.regex === true,
    matchCase: o.matchCase === true,
    authors: strings(o.authors),
    since: str(o.since),
    until: str(o.until),
    paths: strings(o.paths),
    follow: o.follow === true
  }
}

export function registerLogHandlers(ctx: MainContext): void {
  const { handle, runner } = ctx
  const root = (v: unknown) => {
    ctx.requireGit()
    return assert.nonEmptyString(v, 'root')
  }

  handle('log:open', (_e, r, query) => ctx.logs.open(root(r), sanitizeQuery(query)))
  handle('log:next', (_e, id, count) => ctx.logs.next(assert.string(id, 'id'), Math.max(1, Math.min(10_000, Number(count) || 2000))))
  handle('log:close', (_e, id) => ctx.logs.close(assert.string(id, 'id')))
  handle('repo:refs', (_e, r) => listRefs(runner, root(r)))
  handle('repo:commitDetails', (_e, r, hash) => commitDetails(runner, root(r), assert.nonEmptyString(hash, 'hash')))
  handle('repo:changes', (_e, r, from, to) =>
    changedFiles(runner, root(r), assert.nullableString(from, 'from'), assert.nonEmptyString(to, 'to'))
  )
  handle('repo:changesVsWorktree', (_e, r, rev) => changesAgainstWorktree(runner, root(r), assert.nonEmptyString(rev, 'rev')))
  handle('repo:containing', (_e, r, hash) => containingRefs(runner, root(r), assert.nonEmptyString(hash, 'hash')))
  handle('repo:fileContent', (_e, r, rev, path) => fileContent(runner, root(r), assert.nonEmptyString(rev, 'rev'), assert.nonEmptyString(path, 'path')))
  handle('repo:resolveRev', async (_e, r, rev) => {
    const name = assert.nonEmptyString(rev, 'rev').trim()
    if (name.startsWith('-')) throw new AppError('Invalid revision', 'INVALID_ARGUMENT')
    const res = await runner.run(['rev-parse', '-q', '--verify', '--end-of-options', `${name}^{commit}`], { cwd: root(r), okExitCodes: [0, 1] })
    return res.exitCode === 0 ? res.stdout.trim() || null : null
  })
  handle('repo:config', async (_e, r, key) => {
    const k = assert.nonEmptyString(key, 'key')
    if (!/^[A-Za-z0-9.-]+$/.test(k)) throw new AppError('Invalid config key', 'INVALID_ARGUMENT')
    const res = await runner.run(['config', '--get', k], { cwd: root(r), okExitCodes: [0, 1] })
    return res.exitCode === 0 ? res.stdout.trim() : null
  })
  handle('dialog:pickPaths', async (_e, title, defaultPath, kind) => {
    const opts = {
      title: assert.string(title, 'title'),
      defaultPath: assert.string(defaultPath, 'defaultPath'),
      properties: [kind === 'folders' ? ('openDirectory' as const) : ('openFile' as const), 'multiSelections' as const]
    }
    const win = ctx.window()
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })
  handle('repo:fileBase64', (_e, r, rev, path) => fileBase64(runner, root(r), assert.nonEmptyString(rev, 'rev'), assert.nonEmptyString(path, 'path')))
}
