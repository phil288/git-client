import { create } from 'zustand'
import { toast } from 'sonner'
import { api, errorInfo } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { newId } from '@/lib/utils'

/** opId of the running "Resolve with AI" per repository: the banner and the conflicts dialog share it. */
const useAiResolveStore = create<{ running: Record<string, string> }>(() => ({ running: {} }))

export const useAiResolveOp = (root: string): string | undefined => useAiResolveStore((s) => s.running[root])

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * Runs Auto Merge's conflict step on the open operation (Markdown keeps both
 * sides, the rest goes to the AI CLI); a second call while it runs cancels it.
 * Resolved files are staged; continuing the operation stays with the user.
 */
export async function aiResolveConflicts(root: string): Promise<void> {
  const current = useAiResolveStore.getState().running[root]
  if (current) {
    void api.ops.cancel(current)
    return
  }
  const opId = newId()
  useAiResolveStore.setState((s) => ({ running: { ...s.running, [root]: opId } }))
  try {
    const r = await api.conflicts.aiResolve(root, opId)
    const resolved = [
      r.unionResolved.length ? `Markdown kept from both sides: ${r.unionResolved.join(', ')}` : '',
      r.aiResolved.length ? `Resolved by AI (worth a review): ${r.aiResolved.join(', ')}` : ''
    ].filter(Boolean)
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
  } finally {
    useAiResolveStore.setState((s) => {
      const running = { ...s.running }
      delete running[root]
      return { running }
    })
    refreshRepo(root)
  }
}
