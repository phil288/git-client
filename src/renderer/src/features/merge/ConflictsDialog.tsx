import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import type { ConflictFile, ConflictState, ConflictType, SideAction } from '@shared/types'
import { api, errorInfo } from '@/lib/api'
import { outcomeActions, refreshRepo, reportOutcome } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useEpoch } from '@/stores/repoEpoch'
import { choose } from '@/stores/dialogs'
import { closeModal, openModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { mergePreview } from '../branches/BranchDialogs'
import { changesMenuExtras } from '../changes/ChangesView'
import { CommitMessageEditor } from '../common/CommitMessageEditor'
import { DiffViewer } from '../diff/LazyDiffViewer'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { MergeEditor } from './LazyMergeEditor'

const TYPE_LABEL: Record<ConflictType, string> = {
  content: 'Both modified',
  'add-add': 'Both added',
  'modify-delete': 'Modified by Yours, deleted by Theirs',
  'delete-modify': 'Deleted by Yours, modified by Theirs',
  'both-deleted': 'Both deleted',
  'added-by-us': 'Added by Yours only',
  'added-by-them': 'Added by Theirs only',
  binary: 'Binary file',
  submodule: 'Submodule'
}

const SIDE_CLASS: Record<SideAction, string> = {
  modified: 'text-accent',
  added: 'text-success',
  deleted: 'text-danger',
  renamed: 'text-[var(--ref-remote)]',
  unchanged: 'text-muted'
}

const OP_VERB: Record<string, string> = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' }

export function useConflictState(root: string) {
  const epoch = useEpoch(root)
  return useQuery({ queryKey: ['repo', root, 'conflicts', epoch], queryFn: () => api.conflicts.state(root) })
}

function SideLegend({ st }: { st: ConflictState }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-[13px]" data-testid="conflict-sides">
      <div className="rounded border border-border-strong px-2 py-1">
        <b>Yours:</b> {st.yours.name} <span className="text-muted">({st.yours.detail})</span>
      </div>
      <div className="rounded border border-border-strong px-2 py-1">
        <b>Theirs:</b> {st.theirs.name} <span className="text-muted">({st.theirs.detail})</span>
      </div>
    </div>
  )
}

function ImagePreview({ root, rev, path }: { root: string; rev: string; path: string }) {
  const q = useQuery({ queryKey: ['conflict-b64', root, rev, path], queryFn: () => api.repo.fileBase64(root, rev, path), gcTime: 0 })
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext]
  if (!mime) return null
  if (!q.data) return <div className="text-xs text-muted">{q.isLoading ? 'Loading…' : 'No preview'}</div>
  return <img alt="" src={`data:${mime};base64,${q.data}`} className="max-h-48 max-w-full rounded border border-border-strong object-contain" />
}

/** Binary, submodule and modify/delete conflicts: show both sides, choose one. */
function SpecialPanel({ root, f, st, after }: { root: string; f: ConflictFile; st: ConflictState; after(): void }) {
  const v = useQuery({ queryKey: ['conflict-versions', root, f.path], queryFn: () => api.conflicts.versions(root, f.path), gcTime: 0 })
  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn()
      after()
    } catch (err) {
      notifyError(err)
    }
  }
  if (!v.data) return <div className="p-3 text-muted">Loading…</div>
  const d = v.data
  const side = (label: string, c: typeof d.yours, stage: ':2' | ':3', choose: () => Promise<unknown>, chooseLabel: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded border border-border-strong p-2">
      <div className="text-xs font-semibold">{label}</div>
      {!c.exists ? (
        <div className="text-xs text-danger">deleted</div>
      ) : c.gitlink ? (
        <div className="selectable font-mono text-xs">{c.gitlink}</div>
      ) : (
        <>
          <ImagePreview root={root} rev={stage} path={f.path} />
          <div className="text-xs text-muted">{c.size.toLocaleString()} bytes</div>
        </>
      )}
      <Button size="sm" variant="secondary" onClick={run(choose)}>
        {chooseLabel}
      </Button>
    </div>
  )

  if (f.type === 'modify-delete' || f.type === 'delete-modify') {
    const modifiedStage = f.type === 'modify-delete' ? ':2' : ':3'
    return (
      <div className="flex h-72 flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" onClick={run(() => api.conflicts.acceptSide(root, [f.path], f.type === 'modify-delete' ? 'yours' : 'theirs'))} data-testid="keep-modified">
            Keep modified file
          </Button>
          <Button size="sm" variant="secondary" onClick={run(() => api.conflicts.delete(root, [f.path]))} data-testid="delete-file">
            Delete file
          </Button>
          <span className="self-center text-xs text-muted">Changes made by the side that kept the file:</span>
        </div>
        <div className="min-h-0 flex-1 rounded border border-border-strong">
          <DiffViewer root={root} left={{ rev: ':1', path: f.path, label: 'Base' }} right={{ rev: modifiedStage, path: f.path, label: 'Modified' }} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      {side(`Yours: ${st.yours.name}`, d.yours, ':2', () =>
        f.submodule && d.yours.gitlink ? api.conflicts.resolveSubmodule(root, f.path, d.yours.gitlink) : api.conflicts.acceptSide(root, [f.path], 'yours'), 'Use Yours')}
      {side(`Theirs: ${st.theirs.name}`, d.theirs, ':3', () =>
        f.submodule && d.theirs.gitlink ? api.conflicts.resolveSubmodule(root, f.path, d.theirs.gitlink) : api.conflicts.acceptSide(root, [f.path], 'theirs'), 'Use Theirs')}
    </div>
  )
}

/** Merge conflicts dialog: all conflicted files with correct side labels. */
export function ConflictsDialog({ root }: { root: string }) {
  const q = useConflictState(root)
  const st = q.data
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const files = useMemo(() => st?.files ?? [], [st])
  const selected = files.filter((f) => sel.has(f.path))
  const single = selected.length === 1 ? selected[0]! : null

  useEffect(() => {
    setSel((s) => new Set([...s].filter((p) => files.some((f) => f.path === p))))
  }, [files])
  useEffect(() => {
    if (st && message === null && st.needsMessage) setMessage(st.defaultMessage)
  }, [st, message])

  const refresh = () => {
    refreshRepo(root)
    void q.refetch()
  }
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      refresh()
    } catch (err) {
      notifyError(err)
    } finally {
      setBusy(false)
    }
  }
  const paths = selected.map((f) => f.path)
  const textual = (f: ConflictFile) => f.type === 'content' || f.type === 'add-add'
  const renameCandidates = selected.filter((f) => ['added-by-us', 'added-by-them', 'modify-delete', 'delete-modify'].includes(f.type))

  const autoResolve = () =>
    act(async () => {
      const r = await api.conflicts.autoResolve(root, sel.size ? paths : null)
      const left = r.remaining.reduce((n, x) => n + x.conflicts, 0)
      toast.success(
        `${r.resolved.length} file${r.resolved.length === 1 ? '' : 's'} resolved automatically; ${left} conflict${left === 1 ? '' : 's'} remain${left === 1 ? 's' : ''} in ${r.remaining.length} file${r.remaining.length === 1 ? '' : 's'}.`
      )
    })

  const chooseRenamed = async () => {
    const keep = await choose({
      title: 'Rename conflict',
      message: 'The same file ended up under different paths. Choose the path to keep; the others are removed.',
      choices: [...renameCandidates.map((f) => ({ id: f.path, label: f.path })), { id: '__cancel', label: 'Cancel', variant: 'secondary' as const }]
    })
    if (!keep || keep === '__cancel') return
    await act(async () => {
      const k = renameCandidates.find((f) => f.path === keep)!
      await api.conflicts.acceptSide(root, [k.path], k.yours !== 'deleted' ? 'yours' : 'theirs')
      await api.conflicts.delete(root, renameCandidates.filter((f) => f.path !== keep).map((f) => f.path))
    }, `Kept ${keep}`)
  }

  const doContinue = async () => {
    if (!st) return
    setBusy(true)
    try {
      const out = await api.op.continue(root, st.needsMessage ? (message ?? st.defaultMessage) : null)
      reportOutcome(root, out)
      if (out.status !== 'conflicts') closeModal()
      else {
        setMessage(null)
        void q.refetch()
      }
    } catch (err) {
      notifyError(err, 'Continue failed')
    } finally {
      setBusy(false)
    }
  }

  if (!st) return null
  const allDone = files.length === 0
  const verb = OP_VERB[st.operation]

  return (
    <Dialog open onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col" data-testid="conflicts-dialog">
        <DialogHeader>
          <DialogTitle>
            {allDone ? 'All conflicts resolved' : 'Conflicts'}
            {st.title && <span className="font-normal text-muted"> — {st.title}</span>}
            {st.step && st.totalSteps && (
              <span className="font-normal text-muted">
                {' '}
                (step {st.step}/{st.totalSteps})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {allDone ? 'Every file is resolved.' : `${files.length} conflicted file${files.length === 1 ? '' : 's'}.`}
          </DialogDescription>
        </DialogHeader>
        <SideLegend st={st} />

        {allDone ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="all-resolved">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" /> All conflicts resolved
              {verb ? ` — continue the ${verb}?` : '.'}
            </div>
            {st.needsMessage && (
              <CommitMessageEditor className="min-h-0 flex-1" value={message ?? ''} onValueChange={setMessage} data-testid="continue-message" />
            )}
            {st.operation === 'stash' && <div className="text-[13px] text-muted">The stash entry was kept; drop it from the Stashes view once you are happy with the result.</div>}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border-strong bg-bg">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-panel text-left text-xs text-muted">
                  <tr>
                    <th className="w-8 px-2 py-1">
                      <Checkbox
                        checked={sel.size === 0 ? false : sel.size === files.length ? true : 'indeterminate'}
                        onCheckedChange={(c) => setSel(c === true ? new Set(files.map((f) => f.path)) : new Set())}
                      />
                    </th>
                    <th className="px-2 py-1">File</th>
                    <th className="px-2 py-1">Conflict</th>
                    <th className="px-2 py-1">Yours ({st.yours.name})</th>
                    <th className="px-2 py-1">Theirs ({st.theirs.name})</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr
                      key={f.path}
                      data-testid="conflict-row"
                      className={cn('cursor-default border-t border-border', sel.has(f.path) ? 'bg-selected' : 'hover:bg-hover')}
                      onClick={(e) => setSel(e.ctrlKey || e.metaKey ? new Set([...sel, f.path]) : new Set([f.path]))}
                      onDoubleClick={() => textual(f) && openModal({ kind: 'mergeEditor', root, path: f.path })}
                    >
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={sel.has(f.path)}
                          onCheckedChange={(c) => {
                            const n = new Set(sel)
                            if (c === true) n.add(f.path)
                            else n.delete(f.path)
                            setSel(n)
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 text-danger">
                        {f.path}
                        {f.markersResolved && <span className="ml-2 text-xs text-success">no markers left</span>}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted">{TYPE_LABEL[f.type]}</td>
                      <td className={cn('px-2 py-1 text-xs', SIDE_CLASS[f.yours])}>{f.yours}</td>
                      <td className={cn('px-2 py-1 text-xs', SIDE_CLASS[f.theirs])}>{f.theirs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {single && (single.binary || single.submodule || single.type === 'modify-delete' || single.type === 'delete-modify') && (
              <SpecialPanel key={single.path} root={root} f={single} st={st} after={refresh} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!selected.length || busy} onClick={() => void act(() => api.conflicts.acceptSide(root, paths, 'yours'))} data-testid="accept-yours">
                Accept Yours
              </Button>
              <Button size="sm" disabled={!selected.length || busy} onClick={() => void act(() => api.conflicts.acceptSide(root, paths, 'theirs'))} data-testid="accept-theirs">
                Accept Theirs
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!single || !textual(single) || busy}
                onClick={() => single && openModal({ kind: 'mergeEditor', root, path: single.path })}
                data-testid="merge-button"
              >
                Merge…
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!single || busy}
                onClick={() =>
                  void act(async () => {
                    try {
                      await api.conflicts.mergeTool(root, single!.path)
                    } catch (err) {
                      if (errorInfo(err).code !== 'CANCELLED') throw err
                    }
                  })
                }
              >
                Open in External Tool
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!selected.length || busy || selected.some((f) => textual(f) && !f.markersResolved)}
                title="For files you fixed in another editor (no conflict markers left)"
                onClick={() => void act(() => api.conflicts.markResolved(root, paths), 'Marked as resolved')}
              >
                Mark as Resolved
              </Button>
              {renameCandidates.length >= 2 && (
                <Button size="sm" variant="secondary" onClick={() => void chooseRenamed()}>
                  Rename conflict…
                </Button>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void autoResolve()} data-testid="auto-resolve">
                Resolve simple conflicts automatically
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Close
          </Button>
          {allDone && verb && (
            <Button disabled={busy} onClick={() => void doContinue()} data-testid="continue-op">
              Continue {verb}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MergeEditorModal({ root, path }: { root: string; path: string }) {
  const st = useConflictState(root)
  if (!st.data) return null
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent hideClose className="h-[96vh] max-h-none w-[98vw] max-w-none gap-0 p-0" aria-describedby={undefined} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Merge {path}</DialogTitle>
        <MergeEditor root={root} path={path} state={st.data} onClose={() => openModal({ kind: 'conflicts', root })} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Hooks into earlier features
// ---------------------------------------------------------------------------

outcomeActions.resolveConflicts = (root) => openModal({ kind: 'conflicts', root })

changesMenuExtras.items.push((root, e) =>
  e.conflicted ? <ContextMenuItem onSelect={() => openModal({ kind: 'conflicts', root })}>Resolve Conflicts…</ContextMenuItem> : null
)

/** "Preview conflicts" in the merge dialog (git merge-tree, git ≥ 2.38). */
function MergePreviewBox({ root, ref }: { root: string; ref: string }) {
  const [on, setOn] = useState(false)
  const q = useQuery({ queryKey: ['repo', root, 'preview', ref], queryFn: () => api.conflicts.preview(root, ref), enabled: on })
  if (q.data && !q.data.supported) return <div className="text-xs text-muted">Conflict preview needs git 2.38 or newer.</div>
  return (
    <div className="rounded border border-border-strong p-2 text-xs" data-testid="merge-preview">
      {!on && (
        <button className="text-accent hover:underline" onClick={() => setOn(true)}>
          Preview conflicts
        </button>
      )}
      {on && q.isLoading && <span className="text-muted">Checking…</span>}
      {q.data?.clean && <span className="text-success">No conflicts expected.</span>}
      {q.data && !q.data.clean && (
        <div>
          <div className="text-danger">
            {q.data.conflicts.length} file{q.data.conflicts.length === 1 ? '' : 's'} would conflict:
          </div>
          <ul className="max-h-32 overflow-auto font-mono">
            {q.data.conflicts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {q.isError && <span className="text-danger">{q.error.message}</span>}
    </div>
  )
}
mergePreview.render = ({ root, ref }) => <MergePreviewBox root={root} ref={ref} />
