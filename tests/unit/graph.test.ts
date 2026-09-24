import { describe, expect, it } from 'vitest'
import { createGraphState, layoutGraph, type GraphCommitInput, type GraphRow } from '@shared/graph'

const c = (hash: string, ...parents: string[]): GraphCommitInput => ({ hash, parents })
const lanes = (rows: GraphRow[]) => rows.map((r) => r.lane)
const edges = (e: { from: number; to: number }[]) => e.map((x) => `${x.from}>${x.to}`).sort()

describe('layoutGraph', () => {
  it('linear history stays in lane 0', () => {
    const rows = layoutGraph(createGraphState(), [c('c', 'b'), c('b', 'a'), c('a')])
    expect(lanes(rows)).toEqual([0, 0, 0])
    expect(rows[0]!.isTip).toBe(true)
    expect(rows[0]!.up).toEqual([])
    expect(edges(rows[1]!.up)).toEqual(['0>0'])
    expect(rows[2]!.down).toEqual([]) // root
    expect(rows.every((r) => r.width === 1)).toBe(true)
  })

  it('branch and merge: second parent opens a lane that converges at the fork point', () => {
    //   m (merge of b1 and f1)
    //   |\
    //   | f1
    //   b1 |
    //   |/
    //   a
    const rows = layoutGraph(createGraphState(), [c('m', 'b1', 'f1'), c('f1', 'a'), c('b1', 'a'), c('a')])
    expect(lanes(rows)).toEqual([0, 1, 0, 0])
    expect(edges(rows[0]!.down)).toEqual(['0>0', '0>1'])
    expect(edges(rows[1]!.up)).toEqual(['0>0', '1>1'])
    // b1 and f1 both wait for a in lanes 0 and 1: they converge into lane 0.
    expect(edges(rows[3]!.up)).toEqual(['0>0', '1>0'])
    expect(rows[3]!.width).toBe(2)
    // Colours: the merged-in branch gets its own colour.
    expect(rows[1]!.color).not.toBe(rows[0]!.color)
  })

  it('two branch tips side by side', () => {
    const rows = layoutGraph(createGraphState(), [c('x', 'a'), c('y', 'a'), c('a')])
    expect(lanes(rows)).toEqual([0, 1, 0])
    expect(rows[1]!.isTip).toBe(true)
    expect(edges(rows[1]!.up)).toEqual(['0>0'])
    expect(edges(rows[2]!.up)).toEqual(['0>0', '1>0'])
  })

  it('octopus merge opens one lane per extra parent', () => {
    const rows = layoutGraph(createGraphState(), [c('o', 'p1', 'p2', 'p3'), c('p3', 'r'), c('p2', 'r'), c('p1', 'r'), c('r')])
    expect(edges(rows[0]!.down)).toEqual(['0>0', '0>1', '0>2'])
    expect(rows[0]!.width).toBe(3)
    expect(lanes(rows)).toEqual([0, 2, 1, 0, 0])
    expect(edges(rows[4]!.up)).toEqual(['0>0', '1>0', '2>0'])
  })

  it('merge whose second parent is already awaited joins that lane (crossing)', () => {
    // t1 and t2 are tips; t2 is the parent of both m (second parent) and nothing else.
    const rows = layoutGraph(createGraphState(), [c('t', 'x'), c('m', 'a', 'x'), c('x', 'a'), c('a')])
    // m opens in lane 1 and joins lane 0 (waiting for x) with a crossing edge.
    expect(rows[1]!.lane).toBe(1)
    expect(edges(rows[1]!.down)).toEqual(['0>0', '1>0', '1>1'])
  })

  it('reuses freed lanes', () => {
    const rows = layoutGraph(createGraphState(), [c('a1', 'base'), c('b1', 'b0'), c('b0'), c('c1', 'base'), c('base')])
    expect(lanes(rows)).toEqual([0, 1, 1, 1, 0])
  })

  it('is incremental across pages', () => {
    const commits = [c('m', 'b1', 'f1'), c('f1', 'a'), c('b1', 'a'), c('a')]
    const whole = layoutGraph(createGraphState(), commits)
    const st = createGraphState()
    const paged = [...layoutGraph(st, commits.slice(0, 2)), ...layoutGraph(st, commits.slice(2))]
    expect(paged).toEqual(whole)
  })

  it('handles missing parents (shallow clone) without throwing', () => {
    const rows = layoutGraph(createGraphState(), [c('b', 'a-not-loaded')])
    expect(rows[0]!.down).toEqual([{ from: 0, to: 0, color: 0 }])
  })

  it('lays out 100k commits quickly', () => {
    const commits: GraphCommitInput[] = []
    for (let i = 100_000; i > 0; i--) {
      commits.push(i % 50 === 0 ? c(`c${i}`, `c${i - 1}`, `s${i}`) : c(`c${i}`, `c${i - 1}`))
      if (i % 50 === 0) commits.push(c(`s${i}`, `c${i - 3}`))
    }
    const t = performance.now()
    const rows = layoutGraph(createGraphState(), commits)
    expect(rows.length).toBe(commits.length)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
