import { describe, expect, it } from 'vitest'
import type { AiToolInfo } from '@shared/types'
import { resolveAiTool } from '@shared/aiTool'

const tools = (installed: string[]): AiToolInfo[] =>
  (['claude', 'codex', 'copilot', 'cursor', 'gemini'] as const).map((id) => ({ id, label: id.toUpperCase(), path: installed.includes(id) ? `/bin/${id}` : null }))

describe('resolveAiTool', () => {
  it('auto picks the first installed tool', () => {
    expect(resolveAiTool('auto', tools(['cursor', 'codex']))?.id).toBe('codex')
  })
  it('auto with nothing installed is null', () => {
    expect(resolveAiTool('auto', tools([]))).toBeNull()
  })
  it('an explicit tool must be installed', () => {
    expect(resolveAiTool('gemini', tools(['gemini']))?.id).toBe('gemini')
    expect(resolveAiTool('gemini', tools(['claude']))).toBeNull()
  })
})
