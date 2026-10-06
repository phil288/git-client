import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, History, RefreshCw, Undo2 } from 'lucide-react'
import type { StatusEntry } from '@shared/types'
import { INDEX, WORKTREE } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { notifyError, run } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useTabUi } from '@/hooks/useTabUi'
import { confirm } from '@/stores/dialogs'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { SplitPane } from '@/components/SplitPane'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CommitMessageEditor } from '../common/CommitMessageEditor'
import { FileTree, type TreeFile } from '../common/FileTree'
import { DiffViewer } from '../diff/LazyDiffViewer'
import { BranchPicker } from '../branches/BranchPicker'
import { usePrefs } from '../branches/BranchesPanel'
import { HunkView } from './HunkView'
import { aggregate, displayStatus, isStaged, stageState } from './statusModel'

export function useWorkingStatus(root: string, poll = true) {
  return useQuery({
    queryKey: ['repo', root, 'status'],
    queryFn: () => api.wt.status(root),
    // No working-tree file watcher (inotify limits on big repos): poll while visible, refresh on focus.
    refetchInterval: poll ? 3000 : false,
    refetchOnWindowFocus: true,
    staleTime: 1000
  })
}

/** Items contributed by later features (file history / annotate: M7, conflicts: M8). */
export const changesMenuExtras: { items: ((root: string, e: StatusEntry) => React.ReactNode)[] } = { items: [] }

function RollbackDialog({ root, entries, onClose }: { root: string; entries: StatusEntry[]; onClose(): void }) {
  const [sel, setSel] = useState(() => new Set(entries.map((e) => e.path)))
  const go = async () => {
    const ok = await confirm({
      title: 'Rollback changes',
      message: `Discard all changes in ${sel.size} file${sel.size === 1 ? '' : 's'}? Modified files go back to HEAD, added files are removed, untracked files are deleted. This cannot be undone.`,
      confirmLabel: 'Rollback',
      destructive: true
    })
    if (!ok) return
    try {
      await api.wt.discard(root, [...sel])
      refreshRepo(root)
      onClose()
      toast.success(`Rolled back ${sel.size} file${sel.size === 1 ? '' : 's'}`)
    } catch (err) {
      notifyError(err, 'Rollback failed')
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl" data-testid="rollback-dialog">
        <DialogHeader>
          <DialogTitle>Rollback Changes</DialogTitle>
          <DialogDescription>Choose the files to restore to their last committed state.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded border border-border-strong bg-bg p-1">
          {entries.map((e) => (
            <label key={e.path} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
              <Checkbox
                checked={sel.has(e.path)}
                onCheckedChange={(c) => {
                  const next = new Set(sel)
                  if (c === true) next.add(e.path)
                  else next.delete(e.path)
                  setSel(next)
                }}
              />
              <span className="w-3 font-mono text-xs">{displayStatus(e)}</span>
              <span className="truncate">{e.path}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={sel.size === 0} onClick={() => void go()}>
            Rollback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Commit tool window: changes tree with staging checkboxes, hunks/diff, message and commit. */
export function ChangesView({ tab }: { tab: TabRef }) {
  const root = tab.path
  const status = useWorkingStatus(root)
  const prefs = usePrefs(root)
  const [selected, setSelected] = useTabUi<string | null>(tab.id, 'changesSelected', null)
  const [rightMode, setRightMode] = useTabUi<'hunks' | 'diff'>(tab.id, 'changesRightMode', 'hunks')
  const [leftW, setLeftW] = useTabUi(tab.id, 'changesLeftWidth', 420)
  const [msgH, setMsgH] = useTabUi(tab.id, 'changesMessageHeight', 220)
  const [message, setMessage] = useTabUi(tab.id, 'commitMessage', '')
  const [amend, setAmend] = useState(false)
  const [signOff, setSignOff] = useTabUi(tab.id, 'commitSignOff', false)
  const [busy, setBusy] = useState(false)
  const [rollback, setRollback] = useState(false)
  const [menuFile, setMenuFile] = useState<StatusEntry | null>(null)
  const beforeAmend = useRef<string>('')

  const entries = useMemo(() => status.data?.entries ?? [], [status.data])
  const tracked = entries.filter((e) => !e.untracked)
  const untracked = entries.filter((e) => e.untracked)
  const byPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries])
  const current = selected ? byPath.get(selected) : undefined
  const stagedCount = entries.filter(isStaged).length
  const stageable = entries.filter((e) => !e.conflicted)
  const allStaged = aggregate(stageable.map(stageState))

  useEffect(() => {
    if (selected && !byPath.has(selected) && status.data) setSelected(null)
  }, [selected, byPath, status.data, setSelected])

  const toTree = (list: StatusEntry[]): TreeFile[] => list.map((e) => ({ path: e.path, oldPath: e.origPath, status: displayStatus(e) }))

  const setStaged = (paths: string[], stage: boolean) =>
    run(async () => {
      if (paths.length === 0) return
      if (stage) await api.wt.stage(root, paths)
      else await api.wt.unstage(root, paths)
      refreshRepo(root)
    }, 'Could not update the index')

  const checkbox = (e: StatusEntry) => (
    <span onClick={(ev) => ev.stopPropagation()} className="flex">
      <Checkbox checked={stageState(e)} disabled={e.conflicted} onCheckedChange={() => setStaged([e.path], stageState(e) !== true)} aria-label={`Stage ${e.path}`} />
    </span>
  )

  const section = (title: string, list: StatusEntry[], testId: string) => {
    const agg = aggregate(list.map(stageState))
    return (
      <div data-testid={testId}>
        <div className="flex h-6 items-center gap-2 px-2 text-xs font-semibold text-muted">
          <Checkbox
            checked={agg}
            disabled={list.length === 0}
            onCheckedChange={() => setStaged(list.filter((e) => !e.conflicted).map((e) => e.path), agg !== true)}
            aria-label={`Stage all ${title}`}
          />
          {title} <span className="font-normal">{list.length}</span>
        </div>
        <FileTree
          files={toTree(list)}
          selected={selected}
          onSelect={(f) => setSelected(f.path)}
          onDoubleClick={(f) => {
            setSelected(f.path)
            setRightMode('diff')
          }}
          onContextMenu={(f) => {
            setSelected(f.path)
            setMenuFile(byPath.get(f.path) ?? null)
          }}
          renderPrefix={(f) => {
            const e = byPath.get(f.path)
            return e ? checkbox(e) : null
          }}
          renderSuffix={(f) => (byPath.get(f.path)?.conflicted ? <span className="text-danger">conflict</span> : null)}
        />
      </div>
    )
  }

  const doCommit = async (andPush: boolean) => {
    if (!message.trim()) return
    setBusy(true)
    try {
      const hash = await api.wt.commit(root, message, { amend, signOff })
      toast.success(`${amend ? 'Amended' : 'Committed'} ${hash.slice(0, 8)}`)
      setMessage('')
      setAmend(false)
      refreshRepo(root)
      void prefs.refetch()
      if (andPush) openModal({ kind: 'push', root })
    } catch (err) {
      notifyError(err, 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleAmend = async (on: boolean) => {
    setAmend(on)
    if (on) {
      beforeAmend.current = message
      const last = await api.wt.lastMessage(root).catch(() => '')
      if (!message.trim()) setMessage(last)
      else if (message.trim() !== last.trim()) {
        const replace = await confirm({ title: 'Amend', message: 'Replace the current message with the message of the last commit?', confirmLabel: 'Replace' })
        if (replace) setMessage(last)
      }
    } else if (beforeAmend.current !== undefined) {
      setMessage(beforeAmend.current)
    }
  }

  const left = (
    <SplitPane direction="vertical" size={msgH} onSizeChange={setMsgH} sizeSecond minSecond={150}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2">
          <span className="flex px-1" title="Stage all changes, including unversioned files (git add -A)">
            <Checkbox
              checked={allStaged}
              disabled={stageable.length === 0}
              onCheckedChange={() => setStaged(stageable.map((e) => e.path), allStaged !== true)}
              aria-label="Stage all files"
              data-testid="stage-all"
            />
          </span>
          <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Refresh" onClick={() => void status.refetch()}>
            <RefreshCw className={cn('size-3.5', status.isFetching && 'animate-spin')} />
          </button>
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            disabled={entries.length === 0}
            onClick={() => setRollback(true)}
            title="Rollback changes"
            data-testid="rollback-button"
          >
            <Undo2 className="size-3.5" /> Rollback…
          </button>
          <BranchPicker root={root} />
          <span className="ml-auto shrink-0 text-xs text-muted">
            {stagedCount} of {entries.length} staged
          </span>
        </div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1 overflow-auto py-1" data-testid="changes-tree">
              {status.isLoading && <div className="p-3 text-muted">Loading…</div>}
              {status.data && entries.length === 0 && <div className="p-6 text-center text-muted">No local changes</div>}
              {tracked.length > 0 && section('Changes', tracked, 'section-changes')}
              {untracked.length > 0 && section('Unversioned Files', untracked, 'section-unversioned')}
            </div>
          </ContextMenuTrigger>
          {menuFile && (
            <ContextMenuContent className="min-w-56">
              <ContextMenuItem onSelect={() => setRightMode('diff')}>Show Diff</ContextMenuItem>
              {stageState(menuFile) !== true && !menuFile.conflicted && <ContextMenuItem onSelect={() => setStaged([menuFile.path], true)}>Stage</ContextMenuItem>}
              {stageState(menuFile) !== false && <ContextMenuItem onSelect={() => setStaged([menuFile.path], false)}>Unstage</ContextMenuItem>}
              <ContextMenuItem
                onSelect={() =>
                  run(async () => {
                    const ok = await confirm({
                      title: 'Rollback file',
                      message: `Discard all changes to ${menuFile.path}?${menuFile.untracked ? ' The untracked file will be deleted.' : ''}`,
                      confirmLabel: 'Rollback',
                      destructive: true
                    })
                    if (!ok) return
                    await api.wt.discard(root, [menuFile.path])
                    refreshRepo(root)
                  }, 'Rollback failed')
                }
              >
                Rollback…
              </ContextMenuItem>
              <ContextMenuSeparator />
              {changesMenuExtras.items.map((render, i) => (
                <span key={i}>{render(root, menuFile)}</span>
              ))}
              <ContextMenuItem onSelect={() => run(() => api.shell.openInEditor(joinPath(root, menuFile.path)))}>Open in Editor</ContextMenuItem>
              <ContextMenuItem onSelect={() => run(() => api.shell.copyText(menuFile.path))}>Copy Path</ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>
      </div>
      <div className="flex h-full min-h-0 flex-col gap-1 border-t border-border-strong bg-panel p-2" data-testid="commit-panel">
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={amend} onCheckedChange={(c) => void toggleAmend(c === true)} data-testid="amend-checkbox" /> Amend
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox checked={signOff} onCheckedChange={(c) => setSignOff(c === true)} /> Sign-off
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-auto flex items-center gap-1 rounded px-1 text-muted hover:bg-hover hover:text-fg" disabled={!prefs.data?.recentMessages.length}>
                <History className="size-3.5" /> Recent <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-md">
              {prefs.data?.recentMessages.map((m, i) => (
                <DropdownMenuItem key={i} onSelect={() => setMessage(m)}>
                  <span className="truncate">{m.split('\n')[0]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CommitMessageEditor
          className="min-h-0 flex-1"
          value={message}
          onValueChange={setMessage}
          placeholder="Commit message (Ctrl+Enter to commit)"
          data-testid="commit-message"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void doCommit(e.shiftKey)
            }
          }}
        />
        <div className="flex gap-2">
          <Button disabled={busy || !message.trim() || (stagedCount === 0 && !amend)} onClick={() => void doCommit(false)} data-testid="commit-button">
            {amend ? 'Amend Commit' : 'Commit'}
          </Button>
          <Button variant="secondary" disabled={busy || !message.trim() || (stagedCount === 0 && !amend)} onClick={() => void doCommit(true)}>
            {amend ? 'Amend and Push…' : 'Commit and Push…'}
          </Button>
          {stagedCount === 0 && !amend && entries.length > 0 && <span className="self-center text-xs text-muted">Tick files or hunks to include them.</span>}
        </div>
      </div>
    </SplitPane>
  )

  const right = current ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2 text-xs">
        <span className="truncate font-medium">{current.path}</span>
        <div className="ml-auto flex">
          {(['hunks', 'diff'] as const).map((m) => (
            <button key={m} className={cn('rounded px-2 py-0.5', rightMode === m ? 'bg-hover text-fg' : 'text-muted hover:bg-hover')} onClick={() => setRightMode(m)}>
              {m === 'hunks' ? 'Stage hunks' : 'Diff'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {rightMode === 'hunks' && !current.untracked && !current.conflicted ? (
          <HunkView root={root} path={current.path} />
        ) : (
          <DiffViewer
            root={root}
            left={{ rev: current.untracked || current.index === 'A' ? null : 'HEAD', path: current.origPath ?? current.path, label: 'HEAD' }}
            right={{ rev: current.worktree === 'D' ? (current.index === 'D' ? null : INDEX) : WORKTREE, path: current.path, label: 'Working tree' }}
          />
        )}
      </div>
    </div>
  ) : (
    <div className="flex h-full items-center justify-center text-muted">Select a file to see its changes</div>
  )

  return (
    <>
      <SplitPane direction="horizontal" size={leftW} onSizeChange={setLeftW} minFirst={280}>
        {left}
        {right}
      </SplitPane>
      {rollback && <RollbackDialog root={root} entries={entries} onClose={() => setRollback(false)} />}
    </>
  )
}

export function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]$/, '') + sep + rel.split('/').join(sep)
}
