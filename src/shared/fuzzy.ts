/**
 * Small fuzzy matcher (subsequence match with bonuses), used by the welcome
 * screen, the quick switcher and later the branch popup. Case-insensitive.
 *
 * Scoring: consecutive matches, matches at word starts (after / \ - _ . space
 * or a camelCase hump) and a match at position 0 score higher. Returns null
 * when `query` is not a subsequence of `text`.
 */
export interface FuzzyMatch {
  score: number
  /** Indices in `text` that matched, for highlighting. */
  positions: number[]
}

const SEPARATORS = new Set(['/', '\\', '-', '_', '.', ' ', ':'])

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1] as string
  if (SEPARATORS.has(prev)) return true
  const ch = text[i] as string
  return prev === prev.toLowerCase() && ch !== ch.toLowerCase()
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return { score: 0, positions: [] }
  const t = text.toLowerCase()

  // Exact substring gets a strong, simple score so it always ranks first.
  const sub = t.indexOf(q)
  if (sub >= 0) {
    const positions = Array.from({ length: q.length }, (_, k) => sub + k)
    const score = 1000 + (isWordStart(text, sub) ? 200 : 0) - sub - (t.length - q.length) * 0.1
    return { score, positions }
  }

  const positions: number[] = []
  let score = 0
  let ti = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    // Prefer a word-start occurrence of the next char if one exists ahead.
    let found = -1
    let firstAny = -1
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== ch) continue
      if (firstAny < 0) firstAny = k
      if (isWordStart(text, k)) {
        found = k
        break
      }
    }
    if (found < 0) found = firstAny
    // Keep consecutive runs when the very next char matches.
    if (prevMatch >= 0 && t[prevMatch + 1] === ch) found = prevMatch + 1
    if (found < 0) return null
    positions.push(found)
    score += 10
    if (found === prevMatch + 1) score += 15
    if (isWordStart(text, found)) score += 20
    score -= Math.min(found - ti, 10)
    prevMatch = found
    ti = found + 1
  }
  score -= (t.length - q.length) * 0.05
  return { score, positions }
}

/**
 * Filters and sorts items by best fuzzy score across the given fields.
 * Stable for equal scores (keeps input order, which callers use for recency).
 */
export function fuzzyFilter<T>(items: readonly T[], query: string, fields: (item: T) => string[]): T[] {
  if (query.trim() === '') return [...items]
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    let best: number | null = null
    fields(item).forEach((field, fi) => {
      const m = fuzzyMatch(query, field)
      if (m) {
        // Earlier fields (e.g. name) weigh more than later ones (e.g. path).
        const s = m.score - fi * 50
        if (best === null || s > best) best = s
      }
    })
    if (best !== null) scored.push({ item, score: best, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map((s) => s.item)
}
