/** Pure prompt building for AI commit messages (unit-tested, no I/O). */

import { AI_DATA_GUARD, defaultCommitInstructions } from '@shared/aiTool'

export const DIFF_BUDGET = 60_000

const CONVENTIONAL_RE = /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style)(\(.+\))?!?:/

/** True when at least half of the recent subjects (and at least one) are Conventional Commits. */
export function usesConventionalCommits(subjects: readonly string[]): boolean {
  const s = subjects.map((x) => x.trim()).filter(Boolean)
  if (s.length === 0) return false
  return s.filter((x) => CONVENTIONAL_RE.test(x)).length * 2 >= s.length
}

/** Splits a unified diff into per-file chunks (each starting at "diff --git"). */
export function splitDiff(patch: string): string[] {
  if (patch === '') return []
  const parts = patch.split(/^(?=diff --git )/m)
  return parts.filter((p) => p !== '')
}

function cutChunk(chunk: string, max: number): string {
  if (chunk.length <= max) return chunk
  let cut = chunk.lastIndexOf('\n', max)
  if (cut <= 0) cut = max
  const kept = chunk.slice(0, cut)
  const dropped = chunk.slice(cut).split('\n').filter(Boolean).length
  return `${kept}\n[truncated: ${dropped} more line${dropped === 1 ? '' : 's'}]\n`
}

/**
 * Fits a diff into `budget` characters, fairly: every file gets an equal share,
 * files smaller than their share are kept whole and the unused room is
 * redistributed, so only the longest files get cut (marked "[truncated…]").
 * The --stat summary is sent separately and always lists every file.
 */
export function truncateDiff(patch: string, budget = DIFF_BUDGET): string {
  if (patch.length <= budget) return patch
  const chunks = splitDiff(patch)
  const order = chunks.map((c, i) => ({ i, len: c.length })).sort((a, b) => a.len - b.len)
  const alloc = new Array<number>(chunks.length).fill(0)
  let remaining = budget
  order.forEach((o, k) => {
    const share = Math.floor(remaining / (order.length - k))
    const n = Math.min(o.len, share)
    alloc[o.i] = n
    remaining -= n
  })
  return chunks.map((c, i) => cutChunk(c, alloc[i] ?? 0)).join('')
}

export interface PromptInput {
  diff: string
  stat: string
  /** Subjects of recent commits (newest first), for style. */
  recentSubjects: readonly string[]
  /** Messages the user recently committed with this app (may repeat subjects). */
  recentMessages?: readonly string[]
  amend: boolean
  /** Current HEAD message when amending. */
  previousMessage?: string
  /** User-defined instruction block (Settings); '' or missing = the built-in one. */
  instructions?: string
}

export function buildPrompt(input: PromptInput): string {
  const subjects = [...input.recentSubjects]
  for (const m of input.recentMessages ?? []) {
    const first = (m.split('\n')[0] ?? '').trim()
    if (first && !subjects.includes(first)) subjects.push(first)
  }
  const style = subjects.slice(0, 15)
  const conventional = usesConventionalCommits(input.recentSubjects.length > 0 ? input.recentSubjects : style)

  const custom = input.instructions?.trim() ?? ''
  const lines: string[] = [custom || defaultCommitInstructions(conventional ? 'conventional' : 'plain'), AI_DATA_GUARD]
  if (style.length > 0) {
    lines.push('', 'Recent commit subjects in this repository (match their style and language):', ...style.map((s) => `- ${s}`))
  }
  if (input.amend) {
    lines.push('', 'This replaces the message of the last commit, which is being amended. Describe the whole commit, including the changes below.')
    if (input.previousMessage?.trim()) lines.push('Current message:', '<<<', input.previousMessage.trim(), '>>>')
  }
  lines.push('', 'Changed files (git diff --stat):', input.stat.trimEnd(), '', 'Diff:', truncateDiff(input.diff).trimEnd(), '')
  return lines.join('\n')
}
