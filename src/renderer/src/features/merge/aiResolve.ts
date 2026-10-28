import { create } from 'zustand'
import { toast } from 'sonner'
import { api, errorInfo } from '@/lib/api'
import type { AiResolveResult } from '@shared/types'
import { outcomeActions, refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { newId } from '@/lib/utils'

type AiRunKind = 'resolve' | 'rebase'

/**
 * The running "Resolve with AI" or Auto Rebase per repository: the banner and the
 * conflicts dialog share it, and only one may touch the conflicted files at a time.
 */
const useAiResolveStore = create<{ running: Record<string, { opId: string; kind: AiRunKind }> }>(() => ({ running: {} }))

export const useAiResolveOp = (root: string): string | undefined => useAiResolveStore((s) => s.running[root]?.opId)
export const useAiRunKind = (root: string): AiRunKind | undefined => useAiResolveStore((s) => s.running[root]?.kind)

/** Runs `fn` as this repository's AI operation; a call while one runs cancels it instead. */
async function exclusive(root: string, kind: AiRunKind, fn: (opId: string) => Promise<void>): Promise<void> {
  const current = useAiResolveStore.getState().running[root]
  if (current) {
    void api.ops.cancel(current.opId)
    return
  }
  const opId = newId()
  useAiResolveStore.setState((s) => ({ running: { ...s.running, [root]: { opId, kind } } }))
  try {
    await fn(opId)
  } finally {
    useAiResolveStore.setState((s) => {
      const running = { ...s.running }
      delete running[root]
      return { running }
    })
    refreshRepo(root)
  }
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const resolvedLines = (r: Pick<AiResolveResult, 'unionResolved' | 'aiResolved'>): string[] =>
  [
    r.unionResolved.length ? `Markdown kept from both sides: ${r.unionResolved.join(', ')}` : '',
    r.aiResolved.length ? `Resolved by AI (worth a review): ${r.aiResolved.join(', ')}` : ''
  ].filter(Boolean)

/**
 * Runs Auto Merge's conflict step on the open operation (Markdown keeps both
 * sides, the rest goes to the AI CLI); a second call while it runs cancels it.
 * Resolved files are staged; continuing the operation stays with the user.
 */
export async function aiResolveConflicts(root: string): Promise<void> {
  await exclusive(root, 'resolve', async (opId) => {
    try {
      const r = await api.conflicts.aiResolve(root, opId)
      const resolved = resolvedLines(r)
      const n = r.unionResolved.length + r.aiResolved.length
      if (r.unresolved.length === 0) {
        toast.success(n ? `Resolved ${plural(n, 'conflict')}` : 'No conflicts left', {
          description: resolved.join('\n') || undefined,
          duration: r.aiResolved.length ? 30_000 : 8_000
        })
      } else {
        toast.warning(`${plural(r.unresolved.length, 'conflict')} left to resolve${n ? `, ${n} resolved` : ''}`, {
          description: [...resolved, ...r.reasons].join('\n'),
          duration: 30_000
        })
      }
    } catch (err) {
      if (errorInfo(err).code !== 'CANCELLED') notifyError(err, 'Could not resolve conflicts')
    }
  })
}

/**
 * Rebases (onto != null) or resumes the open rebase (onto == null), resolving
 * each step's conflicts like aiResolveConflicts and continuing until done; a
 * second call while it runs cancels it. What it cannot resolve stays open.
 */
export async function autoRebaseFlow(root: string, onto: string | null, branch: string | null, ontoLabel?: string): Promise<void> {
  await exclusive(root, 'rebase', async (opId) => {
    try {
      const r = await api.branch.autoRebase(root, opId, onto, branch)
      const resolved = resolvedLines(r)
      if (r.status === 'done') {
        const steps = r.resolvedSteps ? ` (${plural(r.resolvedSteps, 'step')} with conflicts resolved)` : ''
        toast.success(`${r.message}${steps}`, {
          description: resolved.join('\n') || undefined,
          duration: r.aiResolved.length ? 30_000 : 8_000,
          action: r.started && outcomeActions.undo ? { label: 'Undo', onClick: () => outcomeActions.undo?.(root) } : undefined
        })
      } else {
        toast.warning(r.message, {
          description: [...resolved, ...r.reasons].join('\n') || undefined,
          duration: 30_000,
          action: r.unresolved.length && outcomeActions.resolveConflicts ? { label: 'Resolve…', onClick: () => outcomeActions.resolveConflicts?.(root) } : undefined
        })
      }
    } catch (err) {
      if (errorInfo(err).code === 'CANCELLED') toast.info('Auto Rebase cancelled. The rebase stays open: continue or abort it from the banner.')
      else notifyError(err, ontoLabel ? `Could not rebase onto ${ontoLabel}` : 'Auto Rebase failed')
    }
  })
}
