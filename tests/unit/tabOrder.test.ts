import { describe, expect, it } from 'vitest'
import { moveTab, normalizeOrder, pinnedCount, setPinned, type Orderable } from '@shared/tabOrder'

const tabs = (spec: string): Orderable[] =>
  // "Ab c" = pinned A, pinned B... upper case = pinned.
  spec
    .replace(/\s/g, '')
    .split('')
    .map((c) => ({ id: c.toLowerCase(), pinned: c === c.toUpperCase() }))
const ids = (list: Orderable[]) => list.map((t) => (t.pinned ? t.id.toUpperCase() : t.id)).join('')

describe('tab ordering', () => {
  it('counts the leading pinned group', () => {
    expect(pinnedCount(tabs('ABcd'))).toBe(2)
    expect(pinnedCount(tabs('abc'))).toBe(0)
  })

  it('moves a tab before the target index', () => {
    expect(ids(moveTab(tabs('abcd'), 'a', 3))).toBe('bcad')
    expect(ids(moveTab(tabs('abcd'), 'a', 4))).toBe('bcda')
    expect(ids(moveTab(tabs('abcd'), 'd', 0))).toBe('dabc')
    expect(ids(moveTab(tabs('abcd'), 'c', 1))).toBe('acbd')
  })

  it('returns the same array for a no-op move', () => {
    const list = tabs('abcd')
    expect(moveTab(list, 'b', 1)).toBe(list)
    expect(moveTab(list, 'b', 2)).toBe(list)
    expect(moveTab(list, 'zz', 0)).toBe(list)
  })

  it('keeps unpinned tabs out of the pinned group and vice versa', () => {
    expect(ids(moveTab(tabs('ABcd'), 'd', 0))).toBe('ABdc')
    expect(ids(moveTab(tabs('ABcd'), 'a', 4))).toBe('BAcd')
    expect(ids(moveTab(tabs('ABcd'), 'b', 0))).toBe('BAcd')
  })

  it('pins at the end of the pinned group and unpins at the start of the rest', () => {
    expect(ids(setPinned(tabs('Abcd'), 'c', true))).toBe('ACbd')
    expect(ids(setPinned(tabs('ABCd'), 'a', false))).toBe('BCad')
    const list = tabs('Ab')
    expect(setPinned(list, 'a', true)).toBe(list)
  })

  it('normalizes a mixed order, stable within each group', () => {
    expect(ids(normalizeOrder(tabs('aBcD')))).toBe('BDac')
  })
})
