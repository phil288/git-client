import type { MenuCommand } from './types'

/** The subset of KeyboardEvent the mapper needs (keeps it testable in Node). */
export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * App-wide shortcuts, handled in the renderer. When the handler calls
 * preventDefault(), Electron does not also fire the matching menu
 * accelerator, so the menu only acts as a label/fallback. Handling them there
 * keeps them context-aware (future editors can claim keys first) and makes
 * them testable with synthetic key events.
 */
export function shortcutFor(e: KeyLike, isMac: boolean): MenuCommand | null {
  const primary = isMac ? e.metaKey : e.ctrlKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'Digit9') return 'toggle-console'
  // Ctrl+Tab cycles tabs on every platform (like browsers), even on macOS.
  if (e.ctrlKey && key === 'Tab') return e.shiftKey ? 'prev-tab' : 'next-tab'
  if (!primary || e.altKey) return null

  if (e.shiftKey) return key === 'o' ? 'quick-switcher' : null
  if (key === 'o') return 'open-folder'
  if (key === 'w') return 'close-tab'
  if (key === 'e') return 'quick-switcher'
  if (key === 'k') return 'show-commit'
  if (key === ',') return 'settings'
  if (/^[1-9]$/.test(key)) return { type: 'goto-tab', index: Number(key) - 1 }
  return null
}
