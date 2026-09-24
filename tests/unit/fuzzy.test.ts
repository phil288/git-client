import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch } from '@shared/fuzzy'

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('gm', 'git-manager')).not.toBeNull()
    expect(fuzzyMatch('GM', 'git-manager')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'git-manager')).toBeNull()
  })

  it('returns matched positions', () => {
    expect(fuzzyMatch('man', 'git-manager')?.positions).toEqual([4, 5, 6])
  })

  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('ranks substring and word-start matches above scattered ones', () => {
    const substring = fuzzyMatch('back', 'backend')!.score
    const scattered = fuzzyMatch('back', 'big-arc-check')!.score
    expect(substring).toBeGreaterThan(scattered)
    const wordStart = fuzzyMatch('ws', 'web-server')!.score
    const inner = fuzzyMatch('ws', 'lowest')!.score
    expect(wordStart).toBeGreaterThan(inner)
  })
})

describe('fuzzyFilter', () => {
  const items = [
    { name: 'frontend', path: '/home/u/work/frontend' },
    { name: 'backend', path: '/home/u/work/backend' },
    { name: 'dotfiles', path: '/home/u/dotfiles' }
  ]

  it('keeps input order for an empty query', () => {
    expect(fuzzyFilter(items, '', (i) => [i.name, i.path])).toEqual(items)
  })

  it('filters by any field, preferring the first field', () => {
    expect(fuzzyFilter(items, 'work', (i) => [i.name, i.path]).map((i) => i.name).sort()).toEqual(['backend', 'frontend'])
    expect(fuzzyFilter(items, 'back', (i) => [i.name, i.path])[0]!.name).toBe('backend')
  })
})
