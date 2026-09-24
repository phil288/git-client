import { describe, expect, it } from 'vitest'
import * as m from '../../src/main/repos/recentsModel'

const key = (p: string) => p
const winKey = (p: string) => p.toLowerCase()
const empty: m.RecentsData = { repos: [], groups: [] }

describe('recentsModel', () => {
  it('touch adds new entries and bumps existing ones without duplicates', () => {
    let d = m.touch(empty, '/a', 'main', 1, key)
    d = m.touch(d, '/b', null, 2, key)
    d = m.touch(d, '/a', 'dev', 3, key)
    expect(d.repos).toHaveLength(2)
    expect(d.repos.find((r) => r.path === '/a')).toMatchObject({ lastOpened: 3, lastBranch: 'dev' })
  })

  it('dedupes case-insensitively with a Windows key', () => {
    let d = m.touch(empty, 'C:\\Repo', null, 1, winKey)
    d = m.touch(d, 'c:\\repo', null, 2, winKey)
    expect(d.repos).toHaveLength(1)
  })

  it('keeps at most 50 unpinned, ungrouped entries, dropping the oldest', () => {
    let d = empty
    for (let i = 0; i < 55; i++) d = m.touch(d, `/r${i}`, null, i, key)
    expect(d.repos).toHaveLength(50)
    expect(d.repos.some((r) => r.path === '/r0')).toBe(false)
    expect(d.repos.some((r) => r.path === '/r54')).toBe(true)
  })

  it('never prunes pinned or grouped entries', () => {
    let d = m.touch(empty, '/pinned', null, 0, key)
    d = m.setPinned(d, '/pinned', true, key)
    d = m.createGroup(d, 'g1', 'Work')
    d = m.touch(d, '/grouped', null, 0, key)
    d = m.moveToGroup(d, '/grouped', 'g1', key)
    for (let i = 1; i <= 60; i++) d = m.touch(d, `/r${i}`, null, i, key)
    expect(d.repos.some((r) => r.path === '/pinned')).toBe(true)
    expect(d.repos.some((r) => r.path === '/grouped')).toBe(true)
    expect(d.repos).toHaveLength(52)
  })

  it('moveToGroup ignores unknown groups; deleteGroup keeps repos', () => {
    let d = m.touch(empty, '/a', null, 1, key)
    d = m.moveToGroup(d, '/a', 'nope', key)
    expect(d.repos[0]!.groupId).toBeNull()
    d = m.createGroup(d, 'g', 'Personal')
    d = m.moveToGroup(d, '/a', 'g', key)
    expect(d.repos[0]!.groupId).toBe('g')
    d = m.deleteGroup(d, 'g')
    expect(d.groups).toHaveLength(0)
    expect(d.repos[0]!.groupId).toBeNull()
  })

  it('rename trims and empty resets to null', () => {
    let d = m.touch(empty, '/a', null, 1, key)
    d = m.rename(d, '/a', '  Nice  ', key)
    expect(d.repos[0]!.displayName).toBe('Nice')
    d = m.rename(d, '/a', '   ', key)
    expect(d.repos[0]!.displayName).toBeNull()
  })

  it('locate moves an entry and keeps its metadata; merges into an existing entry', () => {
    let d = m.touch(empty, '/old', null, 1, key)
    d = m.setPinned(d, '/old', true, key)
    d = m.rename(d, '/old', 'Mine', key)
    d = m.locate(d, '/old', '/new', key)
    expect(d.repos).toEqual([expect.objectContaining({ path: '/new', pinned: true, displayName: 'Mine' })])

    let e = m.touch(empty, '/old', null, 1, key)
    e = m.setPinned(e, '/old', true, key)
    e = m.touch(e, '/existing', null, 2, key)
    e = m.locate(e, '/old', '/existing', key)
    expect(e.repos).toEqual([expect.objectContaining({ path: '/existing', pinned: true })])
  })

  it('removeMissing and clearRecent', () => {
    let d = m.touch(empty, '/gone', null, 1, key)
    d = m.touch(d, '/here', null, 2, key)
    d = m.touch(d, '/pin', null, 3, key)
    d = m.setPinned(d, '/pin', true, key)
    expect(m.removeMissing(d, (p) => p !== '/gone').repos.map((r) => r.path)).toEqual(['/here', '/pin'])
    expect(m.clearRecent(d).repos.map((r) => r.path)).toEqual(['/pin'])
  })

  it('addMany assigns the group and does not duplicate', () => {
    let d = m.createGroup(m.touch(empty, '/a', null, 1, key), 'g', 'Scan')
    d = m.addMany(d, ['/a', '/b', '/c'], 'g', 100, key)
    expect(d.repos).toHaveLength(3)
    expect(d.repos.every((r) => r.groupId === 'g')).toBe(true)
  })
})
