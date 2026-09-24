import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, FolderOpen, FolderTree, GitMerge, Lock, LockOpen, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import type { PendingMerge, WorktreeEntry } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo, reportOutcome } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { openRepoPath } from '@/lib/repoActions'
import { cn } from '@/lib/utils'
import { confirm, prompt } from '@/stores/dialogs'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useDefaultBranch, usePendingMerges, useWorktrees } from './WorktreeDialogs'
import { pendingMergeOf, removeWorktreeFlow, samePath } from './worktreeFlows'

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'warning' | 'danger' }) {
  return (
    <span
      className={cn(
        'rounded px-1 text-[10px] uppercase leading-4',
        tone === 'muted' && 'bg-hover text-muted',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger'
      )}
    >
      {children}
    </span>
  )
}

const lockFlow = (root: string, w: WorktreeEntry) =>
  run(async () => {
    if (w.locked) {
      await api.worktree.unlock(root, w.path)
      toast.success('Worktree unlocked')
    } else {
      const reason = await prompt({ title: 'Lock Worktree', label: 'Reason (optional)', confirmLabel: 'Lock' })
      if (reason === null) return
      await api.worktree.lock(root, w.path, reason)
      toast.success('Worktree locked: it cannot be pruned or removed without -f -f')
    }
    refreshRepo(root)
  })

const pruneFlow = (root: string, count: number) =>
  run(async () => {
    await api.worktree.prune(root)
    refreshRepo(root)
    toast.success(`Pruned ${count} missing worktree${count === 1 ? '' : 's'}`)
  })

const forceRemoveFlow = async (root: string, w: WorktreeEntry) => {
  const ok = await confirm({
    title: 'Force remove worktree',
    message: `Run “git worktree remove -f -f” on ${w.path}? Uncommitted and untracked files there are discarded and a lock is ignored. The branch ${w.branch ?? ''} is kept.`,
    confirmLabel: 'Force Remove',
    destructive: true
  })
  if (ok) await removeWorktreeFlow(root, w.path, 2, false)
}

const abortMergeFlow = async (root: string, p: PendingMerge) => {
  const ok = await confirm({
    title: 'Abort merge',
    message: `Abort the merge into ${p.into ?? 'HEAD'} in ${p.path}? Conflict resolutions made there are discarded; both branches stay as they were before the merge.`,
    confirmLabel: 'Abort Merge',
    destructive: true
  })
  if (!ok) return
  run(async () => {
    reportOutcome(p.path, await api.op.abort(p.path))
    refreshRepo(root)
  })
}

/** Actions for one worktree; shared by the row buttons and its context menu. While its branch is being merged, merge/remove are withheld. */
function useActions(root: string, w: WorktreeEntry, def: string | null | undefined, pending: PendingMerge | undefined) {
  const canMerge = !!w.branch && !w.prunable && !pending && (def ? w.branch !== def : true)
  return {
    open: () => void openRepoPath(w.path, 'new-tab'),
    merge: canMerge ? () => openModal({ kind: 'mergeWorktree', root, worktree: w }) : null,
    remove: w.isMain || pending ? null : w.prunable ? () => pruneFlow(root, 1) : () => openModal({ kind: 'removeWorktree', root, worktree: w }),
    lock: w.isMain || w.prunable ? null : () => lockFlow(root, w),
    resolve: pending ? () => openModal({ kind: 'conflicts', root: pending.path }) : null
  }
}

function WorktreeRow({ root, w, def, pending }: { root: string; w: WorktreeEntry; def: string | null | undefined; pending: PendingMerge | undefined }) {
  const a = useActions(root, w, def, pending)
  const current = samePath(w.path, root)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid="worktree-row"
          data-path={w.path}
          onDoubleClick={() => !w.prunable && a.open()}
          className={cn('group flex items-center gap-2 border-b border-border px-3 py-1.5 hover:bg-hover', current && 'bg-selected')}
        >
          <FolderTree className={cn('size-4 shrink-0', w.prunable ? 'text-danger' : 'text-muted')} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{w.branch ?? (w.bare ? '(bare)' : `detached ${w.head?.slice(0, 8) ?? ''}`)}</span>
              {w.isMain && <Badge>main worktree</Badge>}
              {current && <Badge tone="accent">this tab</Badge>}
              {w.locked && (
                <span title={w.lockReason ?? undefined}>
                  <Badge tone="warning">locked</Badge>
                </span>
              )}
              {w.prunable && <Badge tone="danger">missing</Badge>}
              {pending && (
                <span title={`Unfinished merge into ${pending.into ?? 'HEAD'} in ${pending.path}`}>
                  <Badge tone="danger">merge into {pending.into ?? 'HEAD'} unfinished</Badge>
                </span>
              )}
            </div>
            <div className="truncate font-mono text-xs text-muted" title={w.path}>
              {w.path}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
            {!w.prunable && !current && (
              <Button size="icon-sm" variant="ghost" title="Open in new tab" onClick={a.open} data-testid="wt-open">
                <ExternalLink />
              </Button>
            )}
            {a.resolve && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={a.resolve} data-testid="wt-resolve">
                <AlertTriangle /> Resolve…
              </Button>
            )}
            {a.merge && (
              <Button size="sm" variant="ghost" title={`Merge ${w.branch} into ${def ?? 'another branch'}…`} onClick={a.merge} data-testid="wt-merge">
                <GitMerge /> Merge into {def ?? '…'}
              </Button>
            )}
            {a.lock && (
              <Button size="icon-sm" variant="ghost" title={w.locked ? 'Unlock' : 'Lock…'} onClick={a.lock}>
                {w.locked ? <LockOpen /> : <Lock />}
              </Button>
            )}
            {a.remove && (
              <Button size="icon-sm" variant="ghost" className="text-danger" title={w.prunable ? 'Prune (folder is gone)' : 'Remove…'} onClick={a.remove} data-testid="wt-remove">
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!w.prunable && <ContextMenuItem onSelect={a.open}>Open in New Tab</ContextMenuItem>}
        {a.merge && <ContextMenuItem onSelect={a.merge}>Merge ‘{w.branch}’ into {def ?? '…'}…</ContextMenuItem>}
        {!w.prunable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => run(() => api.shell.openInFileManager(w.path))}>Open in File Manager</ContextMenuItem>
            <ContextMenuItem onSelect={() => run(() => api.shell.openInTerminal(w.path))}>Open in Terminal</ContextMenuItem>
          </>
        )}
        <ContextMenuItem onSelect={() => run(() => api.shell.copyText(w.path))}>Copy Path</ContextMenuItem>
        {(a.lock || a.remove) && <ContextMenuSeparator />}
        {a.lock && <ContextMenuItem onSelect={a.lock}>{w.locked ? 'Unlock' : 'Lock…'}</ContextMenuItem>}
        {a.remove && <ContextMenuItem onSelect={a.remove}>{w.prunable ? 'Prune' : 'Remove…'}</ContextMenuItem>}
        {!w.isMain && !w.prunable && !pending && (
          <ContextMenuItem onSelect={() => void forceRemoveFlow(root, w)}>Force Remove (-f -f)…</ContextMenuItem>
        )}
        {pending && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => openModal({ kind: 'conflicts', root: pending.path })}>Resolve Merge Conflicts…</ContextMenuItem>
            <ContextMenuItem onSelect={() => void abortMergeFlow(root, pending)}>Abort Merge into {pending.into ?? 'HEAD'}…</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Strip shown on top of a linked worktree's tab: merge it back or remove it without leaving the tab. */
export function LinkedWorktreeBar({ root }: { root: string }) {
  const list = useWorktrees(root).data
  const def = useDefaultBranch(root).data
  const pendingAll = usePendingMerges(root).data
  const w = list?.find((x) => samePath(x.path, root))
  const main = list?.find((x) => x.isMain)
  if (!w || w.isMain) return null
  const pending = pendingMergeOf(pendingAll, w.branch)
  if (pending) {
    return (
      <div className="flex items-center gap-2 border-b border-border-strong bg-warning/15 px-3 py-1 text-xs" data-testid="linked-worktree-bar" data-pending="true">
        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0">
          Merge of <span className="font-medium">{w.branch}</span> into <span className="font-medium">{pending.into ?? 'HEAD'}</span> is unfinished in{' '}
          <span className="font-mono">{pending.path}</span>. In the conflict tool “Theirs” is {w.branch} (this worktree), “Yours” is {pending.into ?? 'HEAD'}.
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => openModal({ kind: 'conflicts', root: pending.path })} data-testid="bar-resolve">
          Resolve Conflicts…
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void openRepoPath(pending.path, 'new-tab')}>
          Open {pending.into ?? 'target'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void abortMergeFlow(root, pending)} data-testid="bar-abort">
          Abort Merge…
        </Button>
      </div>
    )
  }
  const canMerge = !!w.branch && w.branch !== def
  return (
    <div className="flex items-center gap-2 border-b border-border-strong bg-panel px-3 py-1 text-xs" data-testid="linked-worktree-bar">
      <FolderTree className="size-3.5 text-muted" />
      <span>
        Linked worktree{w.branch ? <> on <span className="font-medium">{w.branch}</span></> : null}
      </span>
      {main && (
        <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => void openRepoPath(main.path, 'new-tab')}>
          main worktree <ExternalLink className="size-3" />
        </button>
      )}
      <div className="flex-1" />
      {canMerge && (
        <Button size="sm" variant="secondary" onClick={() => openModal({ kind: 'mergeWorktree', root, worktree: w })} data-testid="bar-merge">
          <GitMerge /> Merge into {def ?? '…'}…
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => openModal({ kind: 'removeWorktree', root, worktree: w })} data-testid="bar-remove">
        <Trash2 /> Remove…
      </Button>
    </div>
  )
}

/** Worktrees tool window: every checkout of this repository, with one-click open / merge / remove. */
export function WorktreesView({ tab }: { tab: TabRef }) {
  const root = tab.path
  const q = useWorktrees(root)
  const def = useDefaultBranch(root).data
  const pendingAll = usePendingMerges(root).data
  const list = q.data ?? []
  const prunable = list.filter((w) => w.prunable).length

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="worktrees-view">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2">
        <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'addWorktree', root })} data-testid="wt-add">
          <Plus /> New Worktree…
        </Button>
        {prunable > 0 && (
          <Button size="sm" variant="ghost" onClick={() => pruneFlow(root, prunable)}>
            Prune {prunable} missing
          </Button>
        )}
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" title="Refresh" onClick={() => void q.refetch()}>
          <RefreshCw />
        </Button>
        <Button size="icon-sm" variant="ghost" title="Open in File Manager" onClick={() => run(() => api.shell.openInFileManager(root))}>
          <FolderOpen />
        </Button>
        <Button size="icon-sm" variant="ghost" title="Open in Terminal" onClick={() => run(() => api.shell.openInTerminal(root))}>
          <Terminal />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {q.isError && <div className="p-6 text-center text-danger">{q.error.message}</div>}
        {list.length === 0 && !q.isError && <div className="p-6 text-center text-muted">{q.isLoading ? 'Loading…' : 'No worktrees'}</div>}
        {list.map((w) => (
          <WorktreeRow key={w.path} root={root} w={w} def={def} pending={pendingMergeOf(pendingAll, w.branch)} />
        ))}
        {list.length === 1 && (
          <div className="p-6 text-center text-xs text-muted">
            Only the main worktree exists. Create one to work on another branch in parallel without stashing.
          </div>
        )}
      </div>
    </div>
  )
}
