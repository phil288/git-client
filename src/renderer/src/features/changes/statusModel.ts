import type { StatusEntry } from '@shared/types'

export type StageState = boolean | 'indeterminate'

export function isStaged(e: StatusEntry): boolean {
  return !e.untracked && !e.conflicted && e.index !== '.'
}

export function isUnstaged(e: StatusEntry): boolean {
  return e.untracked || e.conflicted || e.worktree !== '.'
}

/** Checkbox state: fully staged / partially staged / not staged. */
export function stageState(e: StatusEntry): StageState {
  const s = isStaged(e)
  const u = isUnstaged(e)
  if (s && !u) return true
  if (s && u) return 'indeterminate'
  return false
}

/** Single status letter for the tree (A/M/D/R/?/U). */
export function displayStatus(e: StatusEntry): string {
  if (e.conflicted) return 'U'
  if (e.untracked) return '?'
  if (e.index === 'R' || e.index === 'C') return 'R'
  if (e.index !== '.') return e.index === 'T' ? 'M' : e.index
  return e.worktree === 'T' ? 'M' : e.worktree
}

export function aggregate(states: StageState[]): StageState {
  if (states.length === 0) return false
  if (states.every((s) => s === true)) return true
  if (states.every((s) => s === false)) return false
  return 'indeterminate'
}
