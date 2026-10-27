import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { AUTO_MERGE_STEPS, autoMergeStepOf } from '@shared/autoMerge'
import type { AutoMergeResult, WorktreeEntry } from '@shared/types'
import { api, errorInfo } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { openRepoPath } from '@/lib/repoActions'
import { cn, newId } from '@/lib/utils'
import { closeModal, openModal } from '@/stores/modals'
import { useOpsStore } from '@/stores/ops'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ProgressBar } from '../status/ProgressBar'
import { closeTabsFor, mainWorktree } from './worktreeFlows'

type Blocked = Extract<AutoMergeResult, { status: 'blocked' }>
type Stopped = Extract<AutoMergeResult, { status: 'stopped' }>
type Phase = { kind: 'running' } | { kind: 'blocked'; r: Blocked } | { kind: 'stopped'; r: Stopped } | { kind: 'error'; message: string }

const POLL_MS = 2500

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function FileList({ files, testId }: { files: string[]; testId: string }) {
  return (
    <ul className="max-h-40 overflow-auto rounded border border-border bg-panel-2 px-2 py-1 font-mono text-xs" data-testid={testId}>
      {files.map((f) => (
        <li key={f} className="truncate" title={f}>
          {f}
        </li>
      ))}
    </ul>
  )
}

async function finish(root: string, w: WorktreeEntry, r: Extract<AutoMergeResult, { status: 'done' }>): Promise<void> {
  const fallback = r.mergedIn ?? (await mainWorktree(root).catch(() => root))
  if (r.mergedIn) refreshRepo(r.mergedIn)
  refreshRepo(fallback)
  if (r.worktreeRemoved) closeTabsFor(w.path, fallback)
  else refreshRepo(root)
  const what = r.merged > 0 ? `Merged ${plural(r.merged, 'commit')} of ${w.branch} into ${r.target}` : `Nothing left to merge from ${w.branch}`
  const resolved = [
    r.unionResolved.length ? `Markdown kept from both sides: ${r.unionResolved.join(', ')}` : '',
    r.aiResolved.length ? `Resolved by AI (worth a review): ${r.aiResolved.join(', ')}` : ''
  ].filter(Boolean)
  toast.success(`${what}${r.worktreeRemoved ? '; worktree removed' : ''}${r.branchDeleted ? ` and ${w.branch} deleted` : ''}`, {
    description: resolved.join('\n') || undefined,
    duration: r.aiResolved.length ? 30_000 : 8_000
  })
  if (r.warning) toast.warning(r.warning, { duration: 30_000 })
}

/**
 * One-click Auto Merge of a linked worktree: starts on open, shows the steps
 * from the operation's progress, and handles the two pauses — the target's
 * worktree is dirty (resumes by itself once it is clean) and conflicts the AI
 * could not resolve (hands over to the conflict tool, merge left open).
 */
export function AutoMergeDialog({ root, worktree: w }: { root: string; worktree: WorktreeEntry }) {
  const [opId, setOpId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'running' })
  const progress = useOpsStore((s) => (opId ? s.last[opId] : undefined))
  const started = useRef(false)
  const runningRef = useRef(false)

  const start = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    const id = newId()
    setOpId(id)
    setPhase({ kind: 'running' })
    try {
      const r = await api.worktree.autoMerge(root, id, w.path)
      if (r.status === 'done') {
        closeModal()
        await finish(root, w, r)
      } else {
        refreshRepo(root)
        refreshRepo(r.host)
        setPhase(r.status === 'blocked' ? { kind: 'blocked', r } : { kind: 'stopped', r })
      }
    } catch (err) {
      const e = errorInfo(err)
      refreshRepo(root)
      setPhase({ kind: 'error', message: e.code === 'CANCELLED' ? 'Cancelled. Anything already done (commit, open merge) was kept.' : e.message })
    } finally {
      runningRef.current = false
    }
  }, [root, w])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void start()
  }, [start])

  // Blocked on a dirty target: resume once it was seen dirty and then clean (an
  // operation in progress alone is not visible here: Retry handles that).
  const blockedHost = phase.kind === 'blocked' ? phase.r.host : null
  useEffect(() => {
    if (!blockedHost) return
    let armed = false
    let stop = false
    const check = async () => {
      const s = await api.repo.quickStatus(blockedHost).catch(() => null)
      if (stop || !s) return
      if (s.dirty) armed = true
      else if (armed) {
        stop = true
        void start()
      }
    }
    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    const off = api.on('repo:changed', ({ root: r }) => {
      if (r === blockedHost) void check()
    })
    return () => {
      stop = true
      clearInterval(timer)
      off()
    }
  }, [blockedHost, start])

  const running = phase.kind === 'running'
  const current = running ? autoMergeStepOf(progress?.percent ?? null) : 0
  const onOpenChange = (o: boolean) => {
    if (o) return
    if (running && opId) void api.ops.cancel(opId)
    closeModal()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="auto-merge-dialog" data-phase={phase.kind}>
        <DialogHeader>
          <DialogTitle>Auto Merge ‘{w.branch}’</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{w.path}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-[13px]">
          {running && (
            <>
              <ol className="flex flex-col gap-1" data-testid="auto-merge-steps">
                {AUTO_MERGE_STEPS.map((label, i) => {
                  const n = i + 1
                  const state = n < current ? 'done' : n === current ? 'active' : 'todo'
                  return (
                    <li key={label} className={cn('flex items-center gap-2', state === 'todo' && 'text-muted')} data-state={state}>
                      {state === 'done' ? (
                        <CheckCircle2 className="size-4 text-success" />
                      ) : state === 'active' ? (
                        <Loader2 className="size-4 animate-spin text-accent" />
                      ) : (
                        <Circle className="size-4" />
                      )}
                      {label}
                    </li>
                  )
                })}
              </ol>
              <ProgressBar percent={progress?.percent ?? null} />
              <div className="truncate text-xs text-muted" data-testid="auto-merge-message" title={progress?.message}>
                {progress?.message ?? 'Starting…'}
              </div>
            </>
          )}
          {phase.kind === 'blocked' && (
            <div className="flex flex-col gap-2" data-testid="auto-merge-blocked">
              <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  ‘{phase.r.target}’ in <span className="font-mono">{phase.r.host}</span> is not clean, so nothing was merged
                  {phase.r.committed ? ' (the worktree’s changes were committed)' : ''}. Commit, stash or discard these changes there; the merge resumes by itself
                  once it is clean.
                </span>
              </div>
              <FileList files={phase.r.dirty} testId="auto-merge-dirty" />
            </div>
          )}
          {phase.kind === 'stopped' && (
            <div className="flex flex-col gap-2" data-testid="auto-merge-stopped">
              <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-xs">
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span className="whitespace-pre-wrap">{phase.r.message}</span>
              </div>
              <FileList files={phase.r.unresolved} testId="auto-merge-unresolved" />
              {(phase.r.aiResolved.length > 0 || phase.r.unionResolved.length > 0) && (
                <div className="text-xs text-muted">
                  Already resolved and staged: {[...phase.r.unionResolved, ...phase.r.aiResolved].join(', ')}. Run Auto Merge again after resolving the rest to finish
                  and clean up.
                </div>
              )}
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-xs" data-testid="auto-merge-error">
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
              <span className="whitespace-pre-wrap">{phase.message}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          {running ? (
            <Button variant="secondary" onClick={() => opId && void api.ops.cancel(opId)} data-testid="auto-merge-cancel">
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeModal}>
                Close
              </Button>
              {phase.kind === 'blocked' && (
                <Button variant="secondary" onClick={() => void openRepoPath(phase.r.host, 'new-tab')}>
                  Open {phase.r.target}
                </Button>
              )}
              {phase.kind === 'stopped' ? (
                <Button onClick={() => openModal({ kind: 'conflicts', root: phase.r.host })} data-testid="auto-merge-resolve">
                  Resolve…
                </Button>
              ) : (
                <Button onClick={() => void start()} data-testid="auto-merge-retry">
                  Retry
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
