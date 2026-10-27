import { describe, expect, it } from 'vitest'
import { AUTO_MERGE_STEPS, autoMergePercent, autoMergeStepOf, cleanMergeAnswer, hasMergeMarkers, isMarkdownPath } from '../../src/shared/autoMerge'
import { unionMerge } from '../../src/shared/mergeModel'
import { buildMergePrompt } from '../../src/main/ai/resolveConflict'

describe('unionMerge', () => {
  it('keeps both sides of a conflict, ours first, and applies one-sided changes', () => {
    const base = ['# Title', 'intro', 'a', 'end']
    const ours = ['# Title', 'intro from main', 'a', 'end']
    const theirs = ['# Title', 'intro from feat', 'a', 'end', 'appendix']
    expect(unionMerge(base, ours, theirs)).toEqual(['# Title', 'intro from main', 'intro from feat', 'a', 'end', 'appendix'])
  })

  it('concatenates add/add files (no base)', () => {
    expect(unionMerge([], ['one'], ['two'])).toEqual(['one', 'two'])
  })

  it('does not duplicate identical changes', () => {
    expect(unionMerge(['x'], ['y'], ['y'])).toEqual(['y'])
  })
})

describe('isMarkdownPath', () => {
  it('matches .md and .markdown, case-insensitively, anywhere in the tree', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/tasks/X.MD')).toBe(true)
    expect(isMarkdownPath('a/b.markdown')).toBe(true)
    expect(isMarkdownPath('src/md.ts')).toBe(false)
    expect(isMarkdownPath('notes.mdx')).toBe(false)
  })
})

describe('cleanMergeAnswer / hasMergeMarkers', () => {
  it('strips one wrapping fence and surrounding blank lines', () => {
    expect(cleanMergeAnswer('\n```ts\r\nconst a = 1\r\n\r\nconst b = 2\r\n```\n\n')).toBe('const a = 1\n\nconst b = 2')
    expect(cleanMergeAnswer('plain\ntext\n')).toBe('plain\ntext')
  })

  it('keeps fences that are part of the file', () => {
    expect(cleanMergeAnswer('# Doc\n```\ncode\n```\nafter')).toBe('# Doc\n```\ncode\n```\nafter')
  })

  it('detects every diff3 marker, not look-alikes', () => {
    expect(hasMergeMarkers('a\n<<<<<<< main\nb')).toBe(true)
    expect(hasMergeMarkers('a\n||||||| base\nb')).toBe(true)
    expect(hasMergeMarkers('a\n=======\nb')).toBe(true)
    expect(hasMergeMarkers('a\n>>>>>>> feat\r\nb')).toBe(true)
    expect(hasMergeMarkers('a\n========\nx <<<<<<< y')).toBe(false)
  })
})

describe('step progress', () => {
  it('round-trips every step through the percent', () => {
    AUTO_MERGE_STEPS.forEach((_, i) => expect(autoMergeStepOf(autoMergePercent(i + 1))).toBe(i + 1))
    expect(autoMergeStepOf(null)).toBe(0)
  })
})

describe('buildMergePrompt', () => {
  const input = { path: 'src/a.ts', oursLabel: 'main', theirsLabel: 'feat', oursSubjects: ['fix: x'], theirsSubjects: ['feat: y'], marked: '<<<<<<< main\n1\n=======\n2\n>>>>>>> feat\n' }

  it('puts the instructions and data guard first, then labels, intent and the file', () => {
    const p = buildMergePrompt(input)
    expect(p.startsWith('Resolve the git merge conflicts')).toBe(true)
    expect(p).toContain('Do not use tools')
    expect(p).toContain('File: src/a.ts')
    expect(p).toContain('Recent commits on main:\n- fix: x')
    expect(p).toContain('Recent commits on feat:\n- feat: y')
    expect(p.indexOf('--- BEGIN FILE ---')).toBeLessThan(p.indexOf('<<<<<<< main'))
  })

  it('custom instructions replace the default block but not the data guard', () => {
    const p = buildMergePrompt({ ...input, instructions: 'Prefer feat.' })
    expect(p.startsWith('Prefer feat.')).toBe(true)
    expect(p).not.toContain('Resolve the git merge conflicts')
    expect(p).toContain('Do not use tools')
  })
})
