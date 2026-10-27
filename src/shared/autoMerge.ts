/** Pure helpers of the worktree Auto Merge (main/autoMerge.ts): file classification and the AI answer check. */

/** Conflicts in these files are resolved by keeping both sides, without asking the AI. */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

const MARKER_RE = /^(?:<{7}|\|{7}|={7}|>{7})(?: |\r?$)/m

/** A line starting with a git conflict marker (diff3 base marker included). */
export function hasMergeMarkers(text: string): boolean {
  return MARKER_RE.test(text)
}

/**
 * The AI answer as file content: drops one code fence wrapping the whole answer
 * (CLIs add them despite the prompt) and blank lines around it. Line endings
 * and the final newline are restored by the caller from the original file.
 */
export function cleanMergeAnswer(raw: string): string {
  let lines = raw.replace(/\r\n/g, '\n').split('\n')
  const blank = (l: string | undefined) => l !== undefined && l.trim() === ''
  while (blank(lines[0])) lines.shift()
  while (blank(lines[lines.length - 1])) lines.pop()
  if (lines.length >= 2 && /^\s*(`{3,}|~{3,})[\w.+-]*\s*$/.test(lines[0]!) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]!)) {
    lines = lines.slice(1, -1)
  }
  return lines.join('\n')
}

/** Steps of the pipeline, in order; progress percent = step number (1-based) / count. */
export const AUTO_MERGE_STEPS = ['Commit worktree changes', 'Check the target is clean', 'Merge', 'Resolve conflicts', 'Commit the merge', 'Remove worktree and branch'] as const

export function autoMergePercent(step: number): number {
  return Math.round((step * 100) / AUTO_MERGE_STEPS.length)
}

/** 1-based step for a progress percent from autoMergePercent; 0 before the first step. */
export function autoMergeStepOf(percent: number | null): number {
  return percent === null ? 0 : Math.round((percent * AUTO_MERGE_STEPS.length) / 100)
}
