/**
 * Pure line-based 3-way text merge: EOL handling, a linear-space Myers diff,
 * region classification (stable / ours / theirs / same / conflict), automatic
 * resolution of non-overlapping changes, git-style conflict markers and a
 * word-level diff for highlighting changes inside modified lines.
 *
 * Deliberately more permissive than `git merge-file`: changes that only touch
 * (adjacent base lines) are both applied instead of producing a conflict.
 */

export type Eol = '\n' | '\r\n'

export interface TextInfo {
  eol: Eol
  finalNewline: boolean
}

/** Detect dominant EOL (CRLF if at least half of line breaks are CRLF, default '\n') and whether text ends with a line break. */
export function detectTextInfo(text: string): TextInfo {
  let lf = 0
  let crlf = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++
    else lf++
  }
  const total = lf + crlf
  return { eol: total > 0 && crlf * 2 >= total ? '\r\n' : '\n', finalNewline: text.endsWith('\n') }
}

/** Split into lines WITHOUT line terminators. A trailing line break does not produce an empty last line. '' -> []. Handles mixed \r\n and \n. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split(/\r?\n/)
  if (text.endsWith('\n')) lines.pop()
  return lines
}

/** Inverse of splitLines using info.eol between lines and a final eol iff info.finalNewline (and lines.length>0). */
export function joinLines(lines: readonly string[], info: TextInfo): string {
  if (lines.length === 0) return ''
  return lines.join(info.eol) + (info.finalNewline ? info.eol : '')
}

// ---------------------------------------------------------------------------
// Diff

/** Half-open ranges, a = old, b = new. */
export interface Hunk {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

const strictEquals = (x: string, y: string): boolean => x === y

/**
 * Myers O(ND) line diff (linear-space divide and conquer on the middle snake,
 * after stripping common prefix/suffix). Returns minimal change hunks in
 * order; hunks are always separated by at least one unchanged line.
 * `equals` defaults to ===.
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  equals: (x: string, y: string) => boolean = strictEquals
): Hunk[] {
  const n = a.length
  const m = b.length
  const aChanged = new Uint8Array(n)
  const bChanged = new Uint8Array(m)
  const eq = (i: number, j: number): boolean => equals(a[i] as string, b[j] as string)

  const compare = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && eq(aLo, bLo)) {
      aLo++
      bLo++
    }
    while (aLo < aHi && bLo < bHi && eq(aHi - 1, bHi - 1)) {
      aHi--
      bHi--
    }
    if (aLo === aHi) {
      bChanged.fill(1, bLo, bHi)
      return
    }
    if (bLo === bHi) {
      aChanged.fill(1, aLo, aHi)
      return
    }
    const [x0, y0, x1, y1] = middleSnake(eq, aLo, aHi, bLo, bHi)
    // Safety net: a degenerate split would recurse forever.
    if ((x0 === aLo && y0 === bLo && x1 === aLo && y1 === bLo) || (x0 === aHi && y0 === bHi)) {
      aChanged.fill(1, aLo, aHi)
      bChanged.fill(1, bLo, bHi)
      return
    }
    compare(aLo, x0, bLo, y0)
    compare(x1, aHi, y1, bHi)
  }
  compare(0, n, 0, m)

  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && aChanged[i] === 0 && bChanged[j] === 0) {
      i++
      j++
      continue
    }
    const aStart = i
    const bStart = j
    while (i < n && aChanged[i] === 1) i++
    while (j < m && bChanged[j] === 1) j++
    hunks.push({ aStart, aEnd: i, bStart, bEnd: j })
  }
  return hunks
}

/**
 * Finds the middle snake of the (already prefix/suffix-stripped) range.
 * Returns absolute [x0, y0, x1, y1]: a[x0..x1) matches b[y0..y1).
 * Paths are kept inside the edit grid (invalid moves are skipped, -1 marks
 * an unreached diagonal) so no out-of-range comparison ever happens.
 */
function middleSnake(
  eq: (i: number, j: number) => boolean,
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number
): [number, number, number, number] {
  const N = aHi - aLo
  const M = bHi - bLo
  const delta = N - M
  const odd = (delta & 1) !== 0
  const max = Math.ceil((N + M) / 2)
  const off = max + 1
  const vf = new Int32Array(2 * max + 3).fill(-1)
  const vb = new Int32Array(2 * max + 3).fill(-1)
  const at = (v: Int32Array, k: number): number => v[off + k] as number

  // Furthest x reachable on diagonal k after d edits, or -1.
  const step = (v: Int32Array, d: number, k: number): number => {
    if (d === 0) return 0
    const down = at(v, k + 1)
    const right = at(v, k - 1)
    const downOk = down >= 0 && down - (k + 1) < M
    const rightOk = right >= 0 && right < N
    if (downOk && rightOk) return Math.max(down, right + 1)
    if (downOk) return down
    if (rightOk) return right + 1
    return -1
  }

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      if (k < -M || k > N) continue
      let x = step(vf, d, k)
      if (x < 0) {
        vf[off + k] = -1
        continue
      }
      let y = x - k
      const sx = x
      const sy = y
      while (x < N && y < M && eq(aLo + x, bLo + y)) {
        x++
        y++
      }
      vf[off + k] = x
      if (odd) {
        const kr = delta - k
        if (kr >= -(d - 1) && kr <= d - 1) {
          const xb = at(vb, kr)
          if (xb >= 0 && x + xb >= N) return [aLo + sx, bLo + sy, aLo + x, bLo + y]
        }
      }
    }
    for (let k = -d; k <= d; k += 2) {
      if (k < -M || k > N) continue
      let x = step(vb, d, k)
      if (x < 0) {
        vb[off + k] = -1
        continue
      }
      let y = x - k
      const sx = x
      const sy = y
      while (x < N && y < M && eq(aHi - 1 - x, bHi - 1 - y)) {
        x++
        y++
      }
      vb[off + k] = x
      if (!odd) {
        const kf = delta - k
        if (kf >= -d && kf <= d) {
          const xf = at(vf, kf)
          if (xf >= 0 && x + xf >= N) return [aHi - x, bHi - y, aHi - sx, bHi - sy]
        }
      }
    }
  }
  // Unreachable for valid input; treat the whole range as changed.
  return [aHi, bHi, aHi, bHi]
}

// ---------------------------------------------------------------------------
// 3-way merge

export type RegionKind = 'stable' | 'ours' | 'theirs' | 'same' | 'conflict'

export interface MergeRegion {
  kind: RegionKind
  /** Lines of the region in each version (for 'stable' all three are equal, modulo ignored whitespace). */
  base: string[]
  ours: string[]
  theirs: string[]
  /** Start line (0-based) of this region in base / ours / theirs. */
  baseStart: number
  oursStart: number
  theirsStart: number
}

export interface Merge3Options {
  ignoreWhitespace?: 'none' | 'trailing' | 'all'
}

interface SideHunk extends Hunk {
  side: 0 | 1
}

function normalizer(opts?: Merge3Options): ((s: string) => string) | null {
  switch (opts?.ignoreWhitespace) {
    case 'trailing':
      return (s) => s.replace(/\s+$/, '')
    case 'all':
      return (s) => s.replace(/\s+/g, '')
    default:
      return null
  }
}

/** Whether an ours hunk and a theirs hunk must be resolved together. */
function interacts(h: Hunk, o: Hunk): boolean {
  const hIns = h.aStart === h.aEnd
  const oIns = o.aStart === o.aEnd
  if (hIns && oIns) return h.aStart === o.aStart
  if (hIns) return o.aStart < h.aStart && h.aStart < o.aEnd
  if (oIns) return h.aStart < o.aStart && o.aStart < h.aEnd
  return Math.max(h.aStart, o.aStart) < Math.min(h.aEnd, o.aEnd)
}

function sameLines(x: readonly string[], y: readonly string[]): boolean {
  return x.length === y.length && x.every((s, i) => s === y[i])
}

/**
 * Line-based 3-way merge. One-sided changes become 'ours' / 'theirs', identical
 * changes 'same'. A 'conflict' arises only when the sides' hunks share a base
 * line, both insert different content at the same base position, or one side
 * inserts strictly inside the other's changed base range. Changes that merely
 * touch (adjacent base lines, or an insertion at the edge of the other side's
 * range) are applied both. `ignoreWhitespace` only affects line comparison;
 * region content always comes from the real versions.
 */
export function merge3(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
  opts?: Merge3Options
): MergeRegion[] {
  const norm = normalizer(opts)
  const nb = norm ? base.map(norm) : base
  const no = norm ? ours.map(norm) : ours
  const nt = norm ? theirs.map(norm) : theirs

  const all: SideHunk[] = [
    ...diffLines(nb, no).map((h): SideHunk => ({ ...h, side: 0 })),
    ...diffLines(nb, nt).map((h): SideHunk => ({ ...h, side: 1 }))
  ].sort((x, y) => x.aStart - y.aStart || x.aEnd - y.aEnd || x.side - y.side)

  // Group interacting hunks. Hunks of one side are disjoint and separated, so
  // checking against the last hunk of the other side in the cluster suffices.
  const clusters: SideHunk[][] = []
  let cur: SideHunk[] = []
  let last: [SideHunk | undefined, SideHunk | undefined] = [undefined, undefined]
  for (const h of all) {
    const other = last[h.side === 0 ? 1 : 0]
    if (cur.length > 0 && other && interacts(h, other)) {
      cur.push(h)
    } else {
      if (cur.length > 0) clusters.push(cur)
      cur = [h]
      last = [undefined, undefined]
    }
    last[h.side] = h
  }
  if (cur.length > 0) clusters.push(cur)

  const regions: MergeRegion[] = []
  const push = (r: MergeRegion): void => {
    const prev = regions[regions.length - 1]
    if (prev && prev.kind === r.kind && r.kind !== 'conflict') {
      prev.base.push(...r.base)
      prev.ours.push(...r.ours)
      prev.theirs.push(...r.theirs)
    } else {
      regions.push(r)
    }
  }
  let bp = 0
  let op = 0
  let tp = 0
  const stableUntil = (bs: number): void => {
    const len = bs - bp
    if (len <= 0) return
    push({
      kind: 'stable',
      base: base.slice(bp, bs),
      ours: ours.slice(op, op + len),
      theirs: theirs.slice(tp, tp + len),
      baseStart: bp,
      oursStart: op,
      theirsStart: tp
    })
    bp = bs
    op += len
    tp += len
  }

  for (const cluster of clusters) {
    const bs = (cluster[0] as SideHunk).aStart
    const be = Math.max(...cluster.map((h) => h.aEnd))
    stableUntil(bs)
    let oursLen = be - bs
    let theirsLen = be - bs
    let hasOurs = false
    let hasTheirs = false
    for (const h of cluster) {
      const growth = h.bEnd - h.bStart - (h.aEnd - h.aStart)
      if (h.side === 0) {
        oursLen += growth
        hasOurs = true
      } else {
        theirsLen += growth
        hasTheirs = true
      }
    }
    let kind: RegionKind
    if (!hasTheirs) kind = 'ours'
    else if (!hasOurs) kind = 'theirs'
    else kind = sameLines(no.slice(op, op + oursLen), nt.slice(tp, tp + theirsLen)) ? 'same' : 'conflict'
    push({
      kind,
      base: base.slice(bs, be),
      ours: ours.slice(op, op + oursLen),
      theirs: theirs.slice(tp, tp + theirsLen),
      baseStart: bs,
      oursStart: op,
      theirsStart: tp
    })
    bp = be
    op += oursLen
    tp += theirsLen
  }
  stableUntil(base.length)
  return regions
}

export interface AutoMergeResult {
  lines: string[]
  conflicts: number
  regions: MergeRegion[]
}

/**
 * Applies every non-conflicting region; conflicting regions keep the BASE
 * lines. conflicts = number of conflict regions. 'stable' and 'same' regions
 * take ours' lines (they only differ from base/theirs in ignored whitespace).
 */
export function autoMerge(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
  opts?: Merge3Options
): AutoMergeResult {
  const regions = merge3(base, ours, theirs, opts)
  const lines: string[] = []
  let conflicts = 0
  for (const r of regions) {
    switch (r.kind) {
      case 'theirs':
        lines.push(...r.theirs)
        break
      case 'conflict':
        conflicts++
        lines.push(...r.base)
        break
      default:
        lines.push(...r.ours)
    }
  }
  return { lines, conflicts, regions }
}

/**
 * Text-level convenience: EOL comes from the first of ours/theirs/base that
 * contains a line break, the final-newline flag from the first non-empty one.
 * Returns the merged text when conflicts === 0, otherwise text is null.
 */
export function mergeTexts(
  base: string,
  ours: string,
  theirs: string,
  opts?: Merge3Options
): { text: string | null; conflicts: number; info: TextInfo } {
  const candidates = [ours, theirs, base]
  const withBreak = candidates.find((t) => t.includes('\n'))
  const nonEmpty = candidates.find((t) => t.length > 0) ?? ''
  const info: TextInfo = {
    eol: withBreak === undefined ? '\n' : detectTextInfo(withBreak).eol,
    finalNewline: nonEmpty.endsWith('\n')
  }
  const res = autoMerge(splitLines(base), splitLines(ours), splitLines(theirs), opts)
  return { text: res.conflicts === 0 ? joinLines(res.lines, info) : null, conflicts: res.conflicts, info }
}

/** Renders regions as a file with diff3-style git markers for conflicts ('<<<<<<< ours', '||||||| base', '=======', '>>>>>>> theirs'). */
export function renderWithMarkers(regions: readonly MergeRegion[], oursLabel: string, theirsLabel: string): string[] {
  const out: string[] = []
  for (const r of regions) {
    if (r.kind === 'conflict') {
      out.push(`<<<<<<< ${oursLabel}`, ...r.ours, '||||||| base', ...r.base, '=======', ...r.theirs, `>>>>>>> ${theirsLabel}`)
    } else {
      out.push(...(r.kind === 'theirs' ? r.theirs : r.ours))
    }
  }
  return out
}

/** True if text contains a line that starts with 7 '<', '=' or '>' characters followed by space/end of line (git conflict markers). */
export function hasConflictMarkers(text: string): boolean {
  return /^(?:<{7}|={7}|>{7})(?: |\r?$)/m.test(text)
}

// ---------------------------------------------------------------------------
// Word diff

function tokenize(s: string): { tokens: string[]; offsets: number[] } {
  const tokens: string[] = []
  const offsets: number[] = []
  for (const m of s.matchAll(/[A-Za-z0-9_]+|[\s\S]/g)) {
    tokens.push(m[0])
    offsets.push(m.index)
  }
  offsets.push(s.length)
  return { tokens, offsets }
}

/** Character ranges (half-open, in each string) that differ between two lines, at word granularity (runs of [A-Za-z0-9_] vs single other chars). */
export function wordDiff(a: string, b: string): { a: [number, number][]; b: [number, number][] } {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const ra: [number, number][] = []
  const rb: [number, number][] = []
  for (const h of diffLines(ta.tokens, tb.tokens)) {
    if (h.aEnd > h.aStart) ra.push([ta.offsets[h.aStart] as number, ta.offsets[h.aEnd] as number])
    if (h.bEnd > h.bStart) rb.push([tb.offsets[h.bStart] as number, tb.offsets[h.bEnd] as number])
  }
  return { a: ra, b: rb }
}
