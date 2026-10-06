import type { AiTool, AiToolInfo } from '@shared/types'

/** Resolves the 'auto' setting to the first installed tool (list is in priority order). */
export function resolveAiTool(setting: AiTool | 'auto', tools: AiToolInfo[]): AiToolInfo | null {
  if (setting === 'auto') return tools.find((t) => t.path !== null) ?? null
  const t = tools.find((x) => x.id === setting)
  return t && t.path !== null ? t : null
}

export const NO_AI_TOOL_HINT = 'No AI CLI found — install claude, codex, copilot, cursor or gemini, or choose one in Settings'
