import type { MainContext } from '../context'
import { generateCommitMessage } from '../ai/commitMessage'
import { detectTools } from '../ai/detect'
import { pickTool } from '../ai/pickTool'
import { assert } from '../ipcRegistry'
import { latestProgress } from '../operations'
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

    const { aiCommitTool: setting, aiModels, aiCommitInstructions } = ctx.settings()
    const tool = pickTool(setting, detectTools())
    const model = aiModels?.[tool.id]
    return ctx.ops.run(id, 'Generating commit message', true, async (op) => {
      const p = latestProgress(op)
      try {
        return await generateCommitMessage(runner, root, { ...tool, model }, {
          amend,
          signal: op.signal,
          recentMessages: getPrefs(ctx, root).recentMessages,
          instructions: aiCommitInstructions,
          onProgress: (m) => p.progress(m, null)
        })
      } finally {
        p.dispose()
      }
    })
  })
}
