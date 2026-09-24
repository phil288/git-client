import { describe, expect, it } from 'vitest'
import {
  autoMerge,
  detectTextInfo,
  diffLines,
  hasConflictMarkers,
  joinLines,
  merge3,
  mergeTexts,
  renderWithMarkers,
  splitLines,
  wordDiff,
  type Hunk
} from '@shared/merge3'

const L = (s: string): string[] => (s.length === 0 ? [] : s.split(''))

/** Applies hunks of diff(a, b) to a; must reproduce b. */
function applyHunks(a: readonly string[], b: readonly string[], hunks: Hunk[]): string[] {
  const out: string[] = []
  let i = 0
  for (const h of hunks) {
    out.push(...a.slice(i, h.aStart), ...b.slice(h.bStart, h.bEnd))
    i = h.aEnd
  }
  out.push(...a.slice(i))
  return out
}

function editCost(hunks: Hunk[]): number {
  return hunks.reduce((s, h) => s + (h.aEnd - h.aStart) + (h.bEnd - h.bStart), 0)
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = dp[i] as number[]
      const prev = dp[i - 1] as number[]
      row[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] as number) + 1 : Math.max(prev[j] as number, row[j - 1] as number)
    }
  }
  return (dp[a.length] as number[])[b.length] as number
}

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomEdit(base: string[], rand: () => number): string[] {
  const out = [...base]
  const edits = Math.floor(rand() * 4)
  for (let e = 0; e < edits; e++) {
    const pos = Math.floor(rand() * (out.length + 1))
    const op = rand()
    const line = 'abcdefXYZ'[Math.floor(rand() * 9)] as string
    if (op < 0.33) out.splice(pos, 0, line)
    else if (op < 0.66) out.splice(pos, 1)
    else if (pos < out.length) out[pos] = line
  }
  return out
}

describe('detectTextInfo', () => {
  it('detects LF', () => {
    expect(detectTextInfo('a\nb\n')).toEqual({ eol: '\n', finalNewline: true })
  })
  it('detects CRLF', () => {
    expect(detectTextInfo('a\r\nb\r\n')).toEqual({ eol: '\r\n', finalNewline: true })
  })
  it('uses CRLF when at least half of breaks are CRLF', () => {
    expect(detectTextInfo('a\r\nb\nc').eol).toBe('\r\n')
    expect(detectTextInfo('a\r\nb\nc\nd').eol).toBe('\n')
  })
  it('detects a missing final newline', () => {
    expect(detectTextInfo('a\nb')).toEqual({ eol: '\n', finalNewline: false })
  })
  it('handles empty text', () => {
    expect(detectTextInfo('')).toEqual({ eol: '\n', finalNewline: false })
  })
})

describe('splitLines / joinLines', () => {
  it('splits without terminators', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('a\n')).toEqual(['a'])
    expect(splitLines('\n')).toEqual([''])
    expect(splitLines('a\r\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })
  it('round-trips LF, CRLF and missing final newline', () => {
    for (const text of ['a\nb\n', 'a\r\nb\r\n', 'a\r\nb', 'a\nb', 'x', '\n', '\r\n\r\n', '']) {
      expect(joinLines(splitLines(text), detectTextInfo(text))).toBe(text)
    }
  })
  it('joins an empty list to the empty string', () => {
    expect(joinLines([], { eol: '\n', finalNewline: true })).toBe('')
  })
})

describe('diffLines', () => {
  it('handles identical and empty inputs', () => {
    expect(diffLines(L('abc'), L('abc'))).toEqual([])
    expect(diffLines([], [])).toEqual([])
    expect(diffLines([], L('ab'))).toEqual([{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 2 }])
    expect(diffLines(L('ab'), [])).toEqual([{ aStart: 0, aEnd: 2, bStart: 0, bEnd: 0 }])
  })
  it('finds an insertion', () => {
    expect(diffLines(L('abc'), L('abXc'))).toEqual([{ aStart: 2, aEnd: 2, bStart: 2, bEnd: 3 }])
  })
  it('finds a deletion', () => {
    expect(diffLines(L('abc'), L('ac'))).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }])
  })
  it('finds a replacement', () => {
    expect(diffLines(L('abcd'), L('aXYd'))).toEqual([{ aStart: 1, aEnd: 3, bStart: 1, bEnd: 3 }])
  })
  it('returns several separated hunks', () => {
    const hunks = diffLines(L('abcdefg'), L('aBcdEfgh'))
    expect(hunks).toEqual([
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
      { aStart: 4, aEnd: 5, bStart: 4, bEnd: 5 },
      { aStart: 7, aEnd: 7, bStart: 7, bEnd: 8 }
    ])
  })
  it('honours a custom equals', () => {
    expect(diffLines(['A', 'b'], ['a', 'b'], (x, y) => x.toLowerCase() === y.toLowerCase())).toEqual([])
  })
  it('produces valid and minimal diffs on random inputs', () => {
    const rand = rng(42)
    for (let t = 0; t < 500; t++) {
      const a = Array.from({ length: Math.floor(rand() * 12) }, () => 'abc'[Math.floor(rand() * 3)] as string)
      const b = Array.from({ length: Math.floor(rand() * 12) }, () => 'abc'[Math.floor(rand() * 3)] as string)
      const hunks = diffLines(a, b)
      expect(applyHunks(a, b, hunks)).toEqual(b)
      expect(editCost(hunks)).toBe(a.length + b.length - 2 * lcsLength(a, b))
    }
  })
  it('is fast on a 20k-line file with 3 changes', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`)
    const b = [...a]
    b[100] = 'changed'
    b.splice(10000, 0, 'inserted')
    b.splice(19000, 1)
    const t0 = performance.now()
    const hunks = diffLines(a, b)
    const ms = performance.now() - t0
    expect(hunks).toHaveLength(3)
    expect(applyHunks(a, b, hunks)).toEqual(b)
    expect(ms).toBeLessThan(200)
  })
  it('handles a fully rewritten large file', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`)
    expect(diffLines(a, b)).toEqual([{ aStart: 0, aEnd: 3000, bStart: 0, bEnd: 3000 }])
  })
})

describe('merge3', () => {
  const kinds = (b: string, o: string, t: string): string[] => merge3(L(b), L(o), L(t)).map((r) => r.kind)

  it('returns a single stable region when nothing changed', () => {
    const regions = merge3(L('abc'), L('abc'), L('abc'))
    expect(regions).toEqual([
      { kind: 'stable', base: L('abc'), ours: L('abc'), theirs: L('abc'), baseStart: 0, oursStart: 0, theirsStart: 0 }
    ])
  })
  it('classifies ours-only changes', () => {
    const regions = merge3(L('abcd'), L('aXcd'), L('abcd'))
    expect(regions.map((r) => r.kind)).toEqual(['stable', 'ours', 'stable'])
    expect(regions[1]).toMatchObject({ base: ['b'], ours: ['X'], theirs: ['b'], baseStart: 1, oursStart: 1, theirsStart: 1 })
  })
  it('classifies theirs-only changes', () => {
    expect(kinds('abcd', 'abcd', 'abYd')).toEqual(['stable', 'theirs', 'stable'])
  })
  it('classifies identical changes as same', () => {
    expect(kinds('abcd', 'aXcd', 'aXcd')).toEqual(['stable', 'same', 'stable'])
  })
  it('treats both deleting the same lines as same', () => {
    const regions = merge3(L('abcd'), L('ad'), L('ad'))
    expect(regions.map((r) => r.kind)).toEqual(['stable', 'same', 'stable'])
    expect(regions[1]).toMatchObject({ base: ['b', 'c'], ours: [], theirs: [] })
  })
  it('conflicts on overlapping edits', () => {
    const regions = merge3(L('abcde'), L('aXYde'), L('abZZe'))
    expect(regions.map((r) => r.kind)).toEqual(['stable', 'conflict', 'stable'])
    expect(regions[1]).toMatchObject({ base: L('bcd'), ours: L('XYd'), theirs: L('bZZ'), baseStart: 1, oursStart: 1, theirsStart: 1 })
  })
  it('conflicts on different insertions at the same position', () => {
    expect(kinds('ab', 'aXb', 'aYb')).toEqual(['stable', 'conflict', 'stable'])
  })
  it('treats identical insertions at the same position as same', () => {
    expect(kinds('ab', 'aXb', 'aXb')).toEqual(['stable', 'same', 'stable'])
  })
  it('conflicts when one side inserts strictly inside the other side’s changed range', () => {
    expect(kinds('abcde', 'aXYZe', 'abcQde')).toEqual(['stable', 'conflict', 'stable'])
  })
  it('does NOT conflict on adjacent edits', () => {
    const r = autoMerge(L('abcdef'), L('abcDef'), L('abcdEf'))
    expect(r.regions.map((x) => x.kind)).toEqual(['stable', 'ours', 'theirs', 'stable'])
    expect(r.conflicts).toBe(0)
    expect(r.lines.join('')).toBe('abcDEf')
  })
  it('does NOT conflict when an insertion touches the other side’s changed range', () => {
    const before = autoMerge(L('abcd'), L('aXbcd'), L('aBCd'))
    expect(before.conflicts).toBe(0)
    expect(before.lines.join('')).toBe('aXBCd')
    const after = autoMerge(L('abcd'), L('abcXd'), L('aBCd'))
    expect(after.conflicts).toBe(0)
    expect(after.lines.join('')).toBe('aBCXd')
  })
  it('conflicts on deletion vs edit', () => {
    expect(kinds('abc', 'ac', 'aXc')).toEqual(['stable', 'conflict', 'stable'])
  })
  it('handles add/add with an empty base', () => {
    const conflict = merge3([], ['x', 'y'], ['z'])
    expect(conflict).toEqual([
      { kind: 'conflict', base: [], ours: ['x', 'y'], theirs: ['z'], baseStart: 0, oursStart: 0, theirsStart: 0 }
    ])
    expect(merge3([], ['x'], ['x']).map((r) => r.kind)).toEqual(['same'])
  })
  it('tracks start offsets across changes that shift lines', () => {
    const regions = merge3(L('abcdefgh'), L('XXabcdefgh'), L('abcdefgY'))
    expect(regions.map((r) => r.kind)).toEqual(['ours', 'stable', 'theirs'])
    expect(regions[2]).toMatchObject({ baseStart: 7, oursStart: 9, theirsStart: 7, ours: ['h'], theirs: ['Y'] })
  })
})

describe('merge3 ignoreWhitespace', () => {
  const base = ['a', 'b  ', 'c']
  const ours = ['a', 'b', 'c']
  const theirs = ['a', 'B  ', 'c']

  it('conflicts on whitespace changes by default', () => {
    expect(autoMerge(base, ours, theirs).conflicts).toBe(1)
  })
  it('ignores trailing whitespace', () => {
    const r = autoMerge(base, ours, theirs, { ignoreWhitespace: 'trailing' })
    expect(r.conflicts).toBe(0)
    expect(r.lines).toEqual(['a', 'B  ', 'c'])
  })
  it('does not ignore inner whitespace in trailing mode, but does in all mode', () => {
    const b = ['x', 'f(a,b)', 'y']
    const o = ['x', 'f(a, b)', 'y']
    const t = ['x', 'f(a,b)', 'Y']
    expect(autoMerge(b, o, t, { ignoreWhitespace: 'trailing' }).conflicts).toBe(0)
    expect(merge3(b, o, t, { ignoreWhitespace: 'trailing' }).map((r) => r.kind)).toEqual(['stable', 'ours', 'theirs'])
    const all = merge3(b, o, t, { ignoreWhitespace: 'all' })
    expect(all.map((r) => r.kind)).toEqual(['stable', 'theirs'])
    // Real content is kept: the stable region carries ours' actual lines.
    expect(all[0]).toMatchObject({ base: ['x', 'f(a,b)'], ours: ['x', 'f(a, b)'] })
    expect(autoMerge(b, o, t, { ignoreWhitespace: 'all' }).lines).toEqual(['x', 'f(a, b)', 'Y'])
  })
})

describe('autoMerge', () => {
  it('merges non-conflicting changes from both sides', () => {
    const base = ['one', 'two', 'three', 'four', 'five']
    const ours = ['one', 'TWO', 'three', 'four', 'five']
    const theirs = ['one', 'two', 'three', 'four', 'five', 'six']
    expect(autoMerge(base, ours, theirs)).toMatchObject({
      lines: ['one', 'TWO', 'three', 'four', 'five', 'six'],
      conflicts: 0
    })
  })
  it('keeps base lines for conflicting regions', () => {
    const r = autoMerge(L('abcXe'), L('abQXe'), L('abRXE'))
    expect(r.conflicts).toBe(1)
    expect(r.lines.join('')).toBe('abcXE')
  })
  it('counts every conflict region', () => {
    expect(autoMerge(L('abcdefg'), L('aXcdeYg'), L('aZcdeWg')).conflicts).toBe(2)
  })
})

describe('autoMerge randomized consistency', () => {
  it('one-sided changes are applied exactly and identical sides merge to themselves', () => {
    const rand = rng(7)
    for (let t = 0; t < 1000; t++) {
      const base = Array.from({ length: Math.floor(rand() * 10) }, () => 'abcde'[Math.floor(rand() * 5)] as string)
      const edited = randomEdit(base, rand)
      const oursOnly = autoMerge(base, edited, base)
      expect(oursOnly.conflicts).toBe(0)
      expect(oursOnly.lines).toEqual(edited)
      const theirsOnly = autoMerge(base, base, edited)
      expect(theirsOnly.conflicts).toBe(0)
      expect(theirsOnly.lines).toEqual(edited)
      const both = autoMerge(base, edited, edited)
      expect(both.conflicts).toBe(0)
      expect(both.lines).toEqual(edited)
    }
  })
  it('region slices always reassemble each version', () => {
    const rand = rng(99)
    for (let t = 0; t < 1000; t++) {
      const base = Array.from({ length: Math.floor(rand() * 10) }, () => 'abcde'[Math.floor(rand() * 5)] as string)
      const ours = randomEdit(base, rand)
      const theirs = randomEdit(base, rand)
      const regions = merge3(base, ours, theirs)
      expect(regions.flatMap((r) => r.base)).toEqual(base)
      expect(regions.flatMap((r) => r.ours)).toEqual(ours)
      expect(regions.flatMap((r) => r.theirs)).toEqual(theirs)
      let [b, o, th] = [0, 0, 0]
      for (const r of regions) {
        expect([r.baseStart, r.oursStart, r.theirsStart]).toEqual([b, o, th])
        b += r.base.length
        o += r.ours.length
        th += r.theirs.length
      }
    }
  })
})

describe('mergeTexts', () => {
  it('preserves CRLF line endings', () => {
    const r = mergeTexts('a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nC\r\n')
    expect(r).toEqual({ text: 'A\r\nb\r\nC\r\n', conflicts: 0, info: { eol: '\r\n', finalNewline: true } })
  })
  it('preserves a missing final newline', () => {
    expect(mergeTexts('a\nb\nc', 'A\nb\nc', 'a\nb\nC').text).toBe('A\nb\nC')
  })
  it('returns null text on conflicts', () => {
    expect(mergeTexts('a\nb\n', 'X\nb\n', 'Y\nb\n')).toMatchObject({ text: null, conflicts: 1 })
  })
  it('falls back to theirs for text info when ours is empty', () => {
    const r = mergeTexts('', '', 'x\r\n')
    expect(r.info).toEqual({ eol: '\r\n', finalNewline: true })
    expect(r.text).toBe('x\r\n')
  })
})

describe('renderWithMarkers', () => {
  it('renders diff3-style markers for conflicts and resolved content elsewhere', () => {
    const regions = merge3(L('abcd'), L('aXcD'), L('aYcd'))
    expect(renderWithMarkers(regions, 'HEAD', 'feature')).toEqual([
      'a',
      '<<<<<<< HEAD',
      'X',
      '||||||| base',
      'b',
      '=======',
      'Y',
      '>>>>>>> feature',
      'c',
      'D'
    ])
  })
  it('renders no markers when there is no conflict', () => {
    const lines = renderWithMarkers(merge3(L('abc'), L('aBc'), L('abC')), 'o', 't')
    expect(lines).toEqual(['a', 'B', 'C'])
    expect(hasConflictMarkers(lines.join('\n'))).toBe(false)
  })
})

describe('hasConflictMarkers', () => {
  it('detects markers at line start', () => {
    expect(hasConflictMarkers('a\n<<<<<<< HEAD\nb\n')).toBe(true)
    expect(hasConflictMarkers('a\n=======\nb')).toBe(true)
    expect(hasConflictMarkers('a\r\n=======\r\nb')).toBe(true)
    expect(hasConflictMarkers('a\n>>>>>>> branch')).toBe(true)
    expect(hasConflictMarkers('>>>>>>>')).toBe(true)
  })
  it('ignores marker-like text elsewhere', () => {
    expect(hasConflictMarkers('')).toBe(false)
    expect(hasConflictMarkers('x ======= y')).toBe(false)
    expect(hasConflictMarkers('  =======')).toBe(false)
    expect(hasConflictMarkers('========')).toBe(false)
    expect(hasConflictMarkers('<<<<<<<HEAD')).toBe(false)
    expect(hasConflictMarkers('<<<<<< HEAD')).toBe(false)
  })
})

describe('wordDiff', () => {
  it('returns no ranges for identical lines', () => {
    expect(wordDiff('const x = 1', 'const x = 1')).toEqual({ a: [], b: [] })
  })
  it('highlights changed words', () => {
    const a = 'const value = oldName(1)'
    const b = 'const value = newName(1)'
    const r = wordDiff(a, b)
    expect(r.a.map(([s, e]) => a.slice(s, e))).toEqual(['oldName'])
    expect(r.b.map(([s, e]) => b.slice(s, e))).toEqual(['newName'])
  })
  it('reports pure insertions only on the new side', () => {
    const a = 'f(a)'
    const b = 'f(a, b)'
    const r = wordDiff(a, b)
    expect(r.a).toEqual([])
    expect(r.b.map(([s, e]) => b.slice(s, e))).toEqual([', b'])
  })
  it('handles empty strings', () => {
    expect(wordDiff('', 'abc')).toEqual({ a: [], b: [[0, 3]] })
    expect(wordDiff('abc', '')).toEqual({ a: [[0, 3]], b: [] })
  })
})
