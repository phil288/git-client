/**
 * Pure ordering rules for the tab strip. Pinned tabs always form a contiguous
 * group at the start, like a browser: drag and drop and pinning never mix the
 * two groups.
 */

export interface Orderable {
  id: string
  pinned?: boolean
}

export function pinnedCount(tabs: readonly Orderable[]): number {
  let n = 0
  while (n < tabs.length && tabs[n]!.pinned) n++
  return n
}

/** Stable sort that puts pinned tabs first (repairs a hand-edited session). */
export function normalizeOrder<T extends Orderable>(tabs: readonly T[]): T[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}

/**
 * Moves tab `id` so that it lands before the tab currently at `beforeIndex`
 * (`tabs.length` = the end). The target is clamped to the tab's own group.
 */
export function moveTab<T extends Orderable>(tabs: readonly T[], id: string, beforeIndex: number): T[] {
  const from = tabs.findIndex((t) => t.id === id)
  if (from < 0) return tabs as T[]
  const tab = tabs[from]!
  const rest = tabs.filter((t) => t.id !== id)
  // Index in `rest` space: removing the tab shifts everything after it left.
  let to = beforeIndex > from ? beforeIndex - 1 : beforeIndex
  const pins = pinnedCount(rest)
  to = tab.pinned ? Math.min(Math.max(to, 0), pins) : Math.min(Math.max(to, pins), rest.length)
  if (to === from) return tabs as T[]
  return [...rest.slice(0, to), tab, ...rest.slice(to)]
}

/** Pinning appends to the pinned group; unpinning puts the tab first among unpinned ones. */
export function setPinned<T extends Orderable>(tabs: readonly T[], id: string, pinned: boolean): T[] {
  const tab = tabs.find((t) => t.id === id)
  if (!tab || !!tab.pinned === pinned) return tabs as T[]
  const rest = tabs.filter((t) => t.id !== id)
  const at = pinnedCount(rest)
  return [...rest.slice(0, at), { ...tab, pinned }, ...rest.slice(at)]
}
