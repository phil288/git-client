import { describe, expect, it } from 'vitest'
import { parseCloneProgress, parseStatusV2 } from '../../src/main/git/parsers'

describe('parseStatusV2', () => {
  it('parses branch headers and counts entries (NUL separated)', () => {
    const out = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -5',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? untracked file.txt',
      ''
    ].join('\0')
    const s = parseStatusV2(out)
    expect(s).toMatchObject({
      branch: 'feature/x',
      detached: false,
      upstream: 'origin/feature/x',
      ahead: 2,
      behind: 5,
      changedCount: 4,
      conflictedCount: 1,
      untrackedCount: 1
    })
  })

  it('handles detached HEAD and unborn branches', () => {
    expect(parseStatusV2('# branch.oid abc\0# branch.head (detached)\0')).toMatchObject({ detached: true, branch: null, oid: 'abc' })
    expect(parseStatusV2('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ oid: null, branch: 'main', changedCount: 0 })
  })

  it('does not miscount a rename whose original path looks like a record', () => {
    // The original path "? tricky" must be skipped, not counted as untracked.
    const out = ['2 R. N... 100644 100644 100644 a b R100 renamed', '? tricky', ''].join('\0')
    expect(parseStatusV2(out)).toMatchObject({ changedCount: 1, untrackedCount: 0 })
  })
})

describe('parseCloneProgress', () => {
  it('maps phases to overall percentages', () => {
    expect(parseCloneProgress('remote: Counting objects: 100% (10/10), done.')?.percent).toBe(5)
    expect(parseCloneProgress('Receiving objects:  50% (5/10)')?.percent).toBe(40)
    expect(parseCloneProgress('Resolving deltas: 100% (3/3), done.')?.percent).toBe(90)
    expect(parseCloneProgress("Cloning into 'x'...")).toBeNull()
  })
})
