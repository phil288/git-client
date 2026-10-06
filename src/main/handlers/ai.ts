import { AI_TOOLS, type AiTool } from '@shared/types'
import type { MainContext } from '../context'
import { generateCommitMessage } from '../ai/commitMessage'
import { detectTools } from '../ai/detect'
import { AppError } from '../git/errors'
import { assert } from '../ipcRegistry'
import { getPrefs } from './branches'

export function registerAiHandlers(ctx: MainContext): void {
  const { handle, runner } = ctx

  // Resolved on every call (cheap stat()s) so newly installed CLIs appear without a restart.
  handle('ai:tools', () => detectTools())

  handle('ai:commitMessage', (_e, r0, opId, o) => {
    ctx.requireGit()
    const root = assert.nonEmptyString(r0, 'root')
    const id = assert.nonEmptyString(opId, 'opId')
    const amend = assert.boolean((o as { amend?: unknown } | null)?.amend, 'amend')

    const setting = ctx.settings().aiCommitTool
    const tools = detectTools()
    let tool: { id: AiTool; path: string }
    if (setting === 'auto' || !AI_TOOLS.includes(setting)) {
      const first = tools.find((t) => t.path !== null)
      if (first?.path) tool = { id: first.id, path: first.path }
      else throw new AppError('No supported AI CLI found (claude, codex, copilot, cursor, gemini). Install one or choose it in Settings.', 'INVALID_ARGUMENT')
    } else {
      const chosen = tools.find((t) => t.id === setting)
      if (!chosen?.path) throw new AppError(`${chosen?.label ?? setting} is not installed or not on PATH. Install it or choose another tool in Settings.`, 'INVALID_ARGUMENT')
      tool = { id: chosen.id, path: chosen.path }
    }
    return ctx.ops.run(id, 'Generating commit message', true, async (op) => {
      // OperationManager drops progress calls < 50 ms apart; "Asking…" usually follows
      // "Reading…" faster than that and is the one that stays on screen, so defer it.
      let last = 0
      let timer: NodeJS.Timeout | undefined
      const progress = (message: string): void => {
        clearTimeout(timer)
        const wait = last + 60 - Date.now()
        const emit = (): void => {
          last = Date.now()
          op.progress(message, null)
        }
        if (wait > 0) timer = setTimeout(emit, wait)
        else emit()
      }
      try {
        return await generateCommitMessage(runner, root, tool, {
          amend,
          signal: op.signal,
          recentMessages: getPrefs(ctx, root).recentMessages,
          onProgress: progress
        })
      } finally {
        clearTimeout(timer)
      }
    })
  })
}
