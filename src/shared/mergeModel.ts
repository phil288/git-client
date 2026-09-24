import type { MergeRegion } from './merge3'

/**
 * State of the 3-way merge editor, independent of Monaco.
 *
 * Every non-stable region is a chunk. Each side of a chunk is `pending`
 * (its change is not in the result yet), `applied`, or `ignored`. A chunk is
 * resolved when neither side is pending. The result content of a chunk is the
 * applied sides in the order they were applied (none applied → base lines).
 */
export type SideState = 'pending' | 'applied' | 'ignored'

export interface Chunk {
  id: number
  kind: 'ours' | 'theirs' | 'same' | 'conflict'
  base: string[]
  ours: string[]
  theirs: string[]
  baseStart: number
  oursStart: number
  theirsStart: number
  left: SideState
  right: SideState
  /** Application order, 'L' = ours (Yours), 'R' = theirs. */
  order: ('L' | 'R')[]
}

export function isResolved(c: Chunk): boolean {
  return c.left !== 'pending' && c.right !== 'pending'
}

/** Chunks with the initial state: non-conflicting changes pre-applied, conflicts pending. */
export function buildChunks(regions: readonly MergeRegion[]): Chunk[] {
  const out: Chunk[] = []
  for (const r of regions) {
    if (r.kind === 'stable') continue
    const c: Chunk = {
      id: out.length,
      kind: r.kind,
      base: [...r.base],
      ours: [...r.ours],
      theirs: [...r.theirs],
      baseStart: r.baseStart,
      oursStart: r.oursStart,
      theirsStart: r.theirsStart,
      left: 'pending',
      right: 'pending',
      order: []
    }
    if (r.kind === 'ours') Object.assign(c, { left: 'applied', right: 'ignored', order: ['L'] })
    else if (r.kind === 'theirs') Object.assign(c, { left: 'ignored', right: 'applied', order: ['R'] })
    else if (r.kind === 'same') Object.assign(c, { left: 'applied', right: 'ignored', order: ['L'] })
    out.push(c)
  }
  return out
}

/** State after "Reset result to original": result = base, every change pending. */
export function resetChunks(chunks: readonly Chunk[]): Chunk[] {
  return chunks.map((c) => ({
    ...c,
    left: c.kind === 'theirs' ? 'ignored' : 'pending',
    right: c.kind === 'ours' || c.kind === 'same' ? 'ignored' : 'pending',
    order: []
  }))
}

export function chunkContent(c: Chunk): string[] {
  if (c.order.length === 0) return c.base
  return c.order.flatMap((s) => (s === 'L' ? c.ours : c.theirs))
}

/** Result lines for the given regions and chunk states, plus each chunk's start line (0-based). */
export function layoutResult(regions: readonly MergeRegion[], chunks: readonly Chunk[]): { lines: string[]; starts: number[]; lengths: number[] } {
  const lines: string[] = []
  const starts: number[] = []
  const lengths: number[] = []
  let ci = 0
  for (const r of regions) {
    if (r.kind === 'stable') {
      lines.push(...r.ours)
      continue
    }
    const c = chunks[ci++]!
    starts.push(lines.length)
    const content = chunkContent(c)
    lengths.push(content.length)
    lines.push(...content)
  }
  return { lines, starts, lengths }
}

export type ChunkAction = 'applyLeft' | 'applyRight' | 'ignoreLeft' | 'ignoreRight' | 'bothLR' | 'bothRL' | 'takeLeft' | 'takeRight'

/** Pure state transition; the caller re-renders the chunk's result block from chunkContent(). */
export function applyAction(c: Chunk, action: ChunkAction): Chunk {
  const n = { ...c, order: [...c.order] }
  const add = (s: 'L' | 'R') => {
    if (!n.order.includes(s)) n.order.push(s)
  }
  switch (action) {
    case 'applyLeft':
      add('L')
      n.left = 'applied'
      break
    case 'applyRight':
      add('R')
      n.right = 'applied'
      break
    case 'ignoreLeft':
      n.left = n.left === 'applied' ? 'applied' : 'ignored'
      break
    case 'ignoreRight':
      n.right = n.right === 'applied' ? 'applied' : 'ignored'
      break
    case 'bothLR':
      n.order = ['L', 'R']
      n.left = 'applied'
      n.right = 'applied'
      break
    case 'bothRL':
      n.order = ['R', 'L']
      n.left = 'applied'
      n.right = 'applied'
      break
    // Resolve the chunk with exactly one side (the other side's change is dropped).
    case 'takeLeft':
      n.order = ['L']
      n.left = 'applied'
      n.right = 'ignored'
      break
    case 'takeRight':
      n.order = ['R']
      n.left = 'ignored'
      n.right = 'applied'
      break
  }
  // "Same" chunks: both sides are identical, applying one covers the other.
  if (n.kind === 'same' && (n.left === 'applied' || n.right === 'applied')) {
    n.order = ['L']
    n.left = 'applied'
    n.right = n.right === 'pending' ? 'ignored' : n.right
  }
  return n
}

export function counts(chunks: readonly Chunk[]): { conflicts: number; changes: number } {
  let conflicts = 0
  let changes = 0
  for (const c of chunks) {
    if (isResolved(c)) continue
    if (c.kind === 'conflict') conflicts++
    else changes++
  }
  return { conflicts, changes }
}

/**
 * Scroll synchronisation: maps a (fractional) line in one pane to the
 * corresponding line in another, interpolating between chunk boundaries.
 * Anchors are [left, result, right] line pairs (0-based).
 */
export type Anchor = [number, number, number]

export function anchors(chunks: readonly Chunk[], resultStarts: readonly number[], resultLengths: readonly number[]): Anchor[] {
  const out: Anchor[] = [[0, 0, 0]]
  chunks.forEach((c, i) => {
    const rs = resultStarts[i] ?? 0
    out.push([c.oursStart, rs, c.theirsStart])
    out.push([c.oursStart + c.ours.length, rs + (resultLengths[i] ?? 0), c.theirsStart + c.theirs.length])
  })
  return out
}

export function mapLine(list: readonly Anchor[], from: 0 | 1 | 2, to: 0 | 1 | 2, line: number): number {
  let prev = list[0]!
  for (const a of list) {
    if (a[from] > line) {
      const span = a[from] - prev[from]
      const t = span > 0 ? (line - prev[from]) / span : 0
      return prev[to] + t * (a[to] - prev[to])
    }
    prev = a
  }
  return prev[to] + (line - prev[from])
}
