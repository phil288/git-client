import { describe, expect, it } from 'vitest'
import type { AiToolInfo } from '@shared/types'
import { isValidAiModel, resolveAiTool } from '@shared/aiTool'

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

describe('isValidAiModel', () => {
  it('accepts empty (CLI default) and real model ids', () => {
    for (const m of ['', 'sonnet', 'opus[1m]', 'claude-sonnet-4-5', 'gpt-5-codex', 'gemini-2.5-pro', 'openai/gpt-5', 'anthropic.claude-v2:1']) {
      expect(isValidAiModel(m), m).toBe(true)
    }
  })
  it('rejects flags, whitespace and characters cmd.exe interprets', () => {
    for (const m of ['-p', '--tools', 'a b', 'a"b', '100%', 'a!b', 'a&b', 'a|b', 'a^b', 'a(b)', 'a\nb', 'é', 'x'.repeat(101)]) {
      expect(isValidAiModel(m), m).toBe(false)
    }
  })
})
