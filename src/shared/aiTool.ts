import type { AiTool, AiToolInfo } from '@shared/types'

/** Resolves the 'auto' setting to the first installed tool (list is in priority order). */
export function resolveAiTool(setting: AiTool | 'auto', tools: AiToolInfo[]): AiToolInfo | null {
  if (setting === 'auto') return tools.find((t) => t.path !== null) ?? null
  const t = tools.find((x) => x.id === setting)
  return t && t.path !== null ? t : null
}

export const NO_AI_TOOL_HINT = 'No AI CLI found — install claude, codex, copilot, cursor or gemini, or choose one in Settings'

/**
 * Model names are passed as one argv element after `--model`. They also end up on the
 * cmd.exe line for Windows npm shims (tools.ts buildInvocation), so allow only what real
 * model ids use (`sonnet`, `gpt-5-codex`, `opus[1m]`, `org/model`, `...-v1:0`) and nothing
 * cmd interprets. Must start alphanumeric so it can never be read as a flag. '' = default.
 */
export const AI_MODEL_PATTERN = '^$|^[A-Za-z0-9][A-Za-z0-9._:/\\[\\]-]{0,99}$'
const AI_MODEL_RE = new RegExp(AI_MODEL_PATTERN)

export function isValidAiModel(model: string): boolean {
  return AI_MODEL_RE.test(model)
}
