import { describe, expect, it } from 'vitest'
import { shortcutFor, type KeyLike } from '@shared/shortcuts'

function key(k: string, mods: Partial<KeyLike> = {}, code = ''): KeyLike {
  return { key: k, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }
}

describe('shortcutFor (Linux/Windows)', () => {
  const s = (e: KeyLike) => shortcutFor(e, false)

  it('maps IDE-style shortcuts', () => {
    expect(s(key('o', { ctrlKey: true }))).toBe('open-folder')
    expect(s(key('O', { ctrlKey: true, shiftKey: true }))).toBe('quick-switcher')
    expect(s(key('e', { ctrlKey: true }))).toBe('quick-switcher')
    expect(s(key('w', { ctrlKey: true }))).toBe('close-tab')
    expect(s(key('Tab', { ctrlKey: true }))).toBe('next-tab')
    expect(s(key('Tab', { ctrlKey: true, shiftKey: true }))).toBe('prev-tab')
    expect(s(key('3', { ctrlKey: true }))).toEqual({ type: 'goto-tab', index: 2 })
    expect(s(key('9', { altKey: true }, 'Digit9'))).toBe('toggle-console')
  })

  it('ignores plain typing and unrelated combos', () => {
    expect(s(key('o'))).toBeNull()
    expect(s(key('w', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(s(key('x', { ctrlKey: true }))).toBeNull()
  })

  it('uses Cmd on macOS', () => {
    expect(shortcutFor(key('o', { metaKey: true }), true)).toBe('open-folder')
    expect(shortcutFor(key('o', { ctrlKey: true }), true)).toBeNull()
  })
})
