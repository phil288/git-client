import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, GitMerge } from 'lucide-react'
import { api } from '@/lib/api'
import { outcomeActions, reportOutcome } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { useEpoch } from '@/stores/repoEpoch'
import { confirm } from '@/stores/dialogs'
import { Button } from '@/components/ui/button'
import { editMessage } from '../rewrite/MessageDialog'

export function useOperationState(root: string) {
  const epoch = useEpoch(root)
  return useQuery({ queryKey: ['repo', root, 'opState', epoch], queryFn: () => api.op.state(root) })
}

/**
 * Persistent banner while git is in the middle of something:
 * "Rebasing feature/x onto main — 3 conflicted files (step 2/5)" + actions.
 */
export function OperationBanner({ root }: { root: string }) {
  const q = useOperationState(root)
  const st = q.data
  if (!st || (!st.operation && st.conflicted.length === 0)) return null

  const n = st.conflicted.length
  const title = st.operation ? st.title : 'Conflicts from applying a stash'
  const doContinue = async () => {
    try {
      let message: string | null = null
      if (st.operation === 'merge') {
        message = await editMessage({ title: 'Commit Merge', initial: st.preparedMessage ?? `Merge ${st.mergeName ?? ''}`, confirmLabel: 'Commit' })
        if (message === null) return
      }
      reportOutcome(root, await api.op.continue(root, message))
    } catch (err) {
      notifyError(err, 'Continue failed')
    }
  }
  const doAbort = async () => {
    const ok = await confirm({
      title: `Abort ${st.operation ?? 'stash application'}`,
      message: st.operation
        ? `Abort the ${st.operation} and return to the state before it started? Conflict resolutions made so far are discarded.`
        : 'Discard the conflicted stash changes and restore the files to their state before the stash was applied? The stash entry is kept.',
      confirmLabel: 'Abort',
      destructive: true
    })
    if (!ok) return
    try {
      reportOutcome(root, await api.op.abort(root))
    } catch (err) {
      notifyError(err, 'Abort failed')
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/15 px-3 py-1.5 text-[13px]" data-testid="operation-banner">
      {n > 0 ? <AlertTriangle className="size-4 shrink-0 text-warning" /> : <GitMerge className="size-4 shrink-0 text-warning" />}
      <span className="min-w-0 truncate">
        <span className="font-medium">{title}</span>
        {n > 0 && (
          <span>
            {' '}
            — {n} conflicted file{n === 1 ? '' : 's'}
          </span>
        )}
        {st.step && st.total && (
          <span className="text-muted">
            {' '}
            (step {st.step}/{st.total})
          </span>
        )}
        {st.currentSubject && st.operation !== 'merge' && <span className="text-muted"> · “{st.currentSubject}”</span>}
      </span>
      <div className="ml-auto flex shrink-0 gap-1">
        {n > 0 && outcomeActions.resolveConflicts && (
          <Button size="sm" onClick={() => outcomeActions.resolveConflicts?.(root)} data-testid="banner-resolve">
            Resolve Conflicts…
          </Button>
        )}
        {st.operation && st.operation !== 'bisect' && (
          <Button size="sm" variant={n > 0 ? 'secondary' : 'default'} disabled={n > 0} onClick={() => void doContinue()} data-testid="banner-continue">
            Continue
          </Button>
        )}
        {st.canSkip && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                reportOutcome(root, await api.op.skip(root))
              } catch (err) {
                notifyError(err, 'Skip failed')
              }
            }}
          >
            Skip
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => void doAbort()} data-testid="banner-abort">
          Abort
        </Button>
      </div>
    </div>
  )
}
