import { describe, expect, it } from 'vitest'
import { merge3, splitLines } from '@shared/merge3'
import { anchors, applyAction, buildChunks, counts, isResolved, layoutResult, mapLine, resetChunks } from '@shared/mergeModel'

const L = (s: string) => splitLines(s)

describe('merge editor model', () => {
  const base = L('a\nb\nc\nd\ne\n')
  const ours = L('a\nB-ours\nc\nd\ne\nf-ours\n')
  const theirs = L('a\nB-theirs\nc\nD-theirs\ne\n')
  const regions = merge3(base, ours, theirs)
  const chunks = buildChunks(regions)

  it('pre-applies non-conflicting changes and keeps base for conflicts', () => {
    expect(chunks.map((c) => c.kind)).toEqual(['conflict', 'theirs', 'ours'])
    const r = layoutResult(regions, chunks)
    expect(r.lines).toEqual(['a', 'b', 'c', 'D-theirs', 'e', 'f-ours'])
    expect(r.starts).toEqual([1, 3, 5])
    expect(counts(chunks)).toEqual({ conflicts: 1, changes: 0 })
  })

  it('applies left then right (accept both), in order, and resolves', () => {
    let c = applyAction(chunks[0]!, 'applyLeft')
    expect(isResolved(c)).toBe(false)
    c = applyAction(c, 'applyRight')
    expect(isResolved(c)).toBe(true)
    const next = [c, chunks[1]!, chunks[2]!]
    expect(layoutResult(regions, next).lines.slice(1, 3)).toEqual(['B-ours', 'B-theirs'])
    expect(layoutResult(regions, [applyAction(chunks[0]!, 'bothRL'), chunks[1]!, chunks[2]!]).lines.slice(1, 3)).toEqual(['B-theirs', 'B-ours'])
  })

  it('ignore marks a side handled without changing content', () => {
    const c = applyAction(applyAction(chunks[0]!, 'applyRight'), 'ignoreLeft')
    expect(isResolved(c)).toBe(true)
    expect(layoutResult(regions, [c, chunks[1]!, chunks[2]!]).lines[1]).toBe('B-theirs')
  })

  it('remove drops an applied side and keeps the other', () => {
    const both = applyAction(chunks[0]!, 'bothLR')
    const c = applyAction(both, 'removeLeft')
    expect(c.left).toBe('ignored')
    expect(isResolved(c)).toBe(true)
    expect(layoutResult(regions, [c, chunks[1]!, chunks[2]!]).lines[1]).toBe('B-theirs')
    // Removing both sides leaves the base text; re-adding appends after the kept side.
    const none = applyAction(c, 'removeRight')
    expect(layoutResult(regions, [none, chunks[1]!, chunks[2]!]).lines[1]).toBe('b')
    expect(applyAction(applyAction(none, 'applyRight'), 'applyLeft').order).toEqual(['R', 'L'])
    // A pre-applied non-conflicting change can be dropped too.
    const dropped = applyAction(chunks[2]!, 'removeLeft')
    expect(layoutResult(regions, [chunks[0]!, chunks[1]!, dropped]).lines).toEqual(['a', 'b', 'c', 'D-theirs', 'e'])
  })

  it('take Yours / take Theirs for every chunk reproduces that whole version', () => {
    expect(layoutResult(regions, chunks.map((c) => applyAction(c, 'takeLeft'))).lines).toEqual(ours)
    expect(layoutResult(regions, chunks.map((c) => applyAction(c, 'takeRight'))).lines).toEqual(theirs)
    expect(counts(chunks.map((c) => applyAction(c, 'takeLeft')))).toEqual({ conflicts: 0, changes: 0 })
  })

  it('reset makes the result equal to base with every change pending', () => {
    const reset = resetChunks(chunks)
    expect(layoutResult(regions, reset).lines).toEqual(base)
    expect(counts(reset)).toEqual({ conflicts: 1, changes: 2 })
  })

  it('maps lines between panes through chunk boundaries', () => {
    const r = layoutResult(regions, chunks)
    const a = anchors(chunks, r.starts, r.lengths)
    expect(mapLine(a, 0, 1, 0)).toBe(0)
    expect(mapLine(a, 0, 1, 2)).toBe(2) // "c" in ours -> "c" in result
    expect(mapLine(a, 1, 2, 4)).toBe(4) // "e"
    expect(mapLine(a, 0, 2, 100)).toBeGreaterThan(90)
  })
})
