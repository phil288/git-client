import { AI_TOOLS, type AiTool, type AiToolInfo } from '@shared/types'
import { AppError } from '../git/errors'

export interface PickedTool {
  id: AiTool
  path: string
}

/** Tool for a Settings value ('auto' = first installed); throws a user-facing error when none is usable. */
export function pickTool(setting: AiTool | 'auto', tools: AiToolInfo[]): PickedTool {
  if (setting === 'auto' || !AI_TOOLS.includes(setting)) {
    const first = tools.find((t) => t.path !== null)
    if (first?.path) return { id: first.id, path: first.path }
    throw new AppError('No supported AI CLI found (claude, codex, copilot, cursor, gemini). Install one or choose it in Settings.', 'INVALID_ARGUMENT')
  }
  const chosen = tools.find((t) => t.id === setting)
  if (!chosen?.path) throw new AppError(`${chosen?.label ?? setting} is not installed or not on PATH. Install it or choose another tool in Settings.`, 'INVALID_ARGUMENT')
  return { id: chosen.id, path: chosen.path }
}
