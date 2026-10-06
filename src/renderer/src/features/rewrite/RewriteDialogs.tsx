import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripVertical } from 'lucide-react'
import type { Commit, RebaseAction, RebaseTodoItem, ResetMode } from '@shared/types'
import { api } from '@/lib/api'
import { checkoutFlow, refreshRepo, reportOutcome } from '@/lib/gitOps'
import { formatDate, shortHash } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { fixupIntoFlow, preflight, runPlan, type RangeCommit } from '@/lib/rewriteFlows'
import { cn } from '@/lib/utils'
import { confirm } from '@/stores/dialogs'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommitMessageEditor } from '../common/CommitMessageEditor'

const open = { open: true, onOpenChange: (o: boolean) => !o && closeModal() }

const ACTIONS: { id: RebaseAction; help: string }[] = [
  { id: 'pick', help: 'keep the commit' },
  { id: 'reword', help: 'keep, edit the message' },
  { id: 'edit', help: 'stop after it to amend' },
  { id: 'squash', help: 'meld into the previous commit, edit the combined message' },
  { id: 'fixup', help: 'meld into the previous commit, keep its message' },
  { id: 'drop', help: 'remove the commit' }
]

interface Row extends RebaseTodoItem {
  original: RangeCommit
}

/** Interactive rebase: actions, drag-and-drop order, message editor. */
export function InteractiveRebaseDialog({ root, base, fromLabel }: { root: string; base: string | null; fromLabel: string }) {
  const q = useQuery({ queryKey: ['repo', root, 'irebase', base], queryFn: () => api.rewrite.commits(root, base), staleTime: Infinity })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const hasMerges = (q.data ?? []).some((c) => c.parents.length > 1)

  useEffect(() => {
    if (q.data && !rows) {
      // Newest on top, like the log; merges are kept by git and not listed.
      const list = q.data.filter((c) => c.parents.length < 2).map((c) => ({ action: 'pick' as RebaseAction, hash: c.hash, subject: c.subject, original: c }))
      setRows(list.reverse())
    }
  }, [q.data, rows])

  const oldestFirst = useMemo(() => [...(rows ?? [])].reverse(), [rows])
  const firstKept = oldestFirst.find((r) => r.action !== 'drop')
  const invalid = firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')
  const cur = rows?.[selected]
  const reordered = rows ? oldestFirst.some((r, i) => r.hash !== (q.data ?? []).filter((c) => c.parents.length < 2)[i]?.hash) : false
  const changed = reordered || (rows ?? []).some((r) => r.action !== 'pick')

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  // Default messages: reword = own message; squash = combined group message.
  const defaultMessage = (i: number): string => {
    const r = rows![i]!
    if (r.action !== 'squash') return r.original.message
    const olderFirst = [...rows!].reverse()
    const idx = olderFirst.findIndex((x) => x.hash === r.hash)
    let start = idx
    while (start > 0 && (olderFirst[start]!.action === 'squash' || olderFirst[start]!.action === 'fixup')) start--
    return olderFirst
      .slice(start, idx + 1)
      .filter((x) => x.action !== 'fixup' || x === olderFirst[start])
      .map((x) => x.original.message)
      .join('\n\n')
  }

  const start = async () => {
    if (!rows) return
    setBusy(true)
    try {
      const pre = await preflight(root, base, oldestFirst.map((r) => r.hash), { reorders: reordered || hasMerges && oldestFirst.some((r) => r.action === 'squash' || r.action === 'fixup' || r.action === 'drop') })
      if (!pre) return
      const items: RebaseTodoItem[] = oldestFirst.map((r, i) => ({
        action: r.action,
        hash: r.hash,
        subject: r.subject,
        // Unedited squash rows still carry the combined message (else they would act like fixup).
        message: r.action === 'reword' || r.action === 'squash' ? (r.message ?? defaultMessage(rows.length - 1 - i)) : undefined
      }))
      closeModal()
      await runPlan(root, { base, items, ...pre }, 'interactive-rebase')
    } catch (err) {
      notifyError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog {...open}>
      <DialogContent className="h-[80vh] max-w-5xl" data-testid="irebase-dialog">
        <DialogHeader>
          <DialogTitle>Interactive Rebase</DialogTitle>
          <DialogDescription>
            From {fromLabel} to HEAD. Drag rows to reorder. A backup ref is created; Undo Last Operation restores it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border-strong bg-bg">
            {q.isLoading && <div className="p-3 text-muted">Loading…</div>}
            {rows?.map((r, i) => (
              <div
                key={r.hash}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom === null || dragFrom === i) return
                  setRows((rs) => {
                    const next = [...rs!]
                    const [m] = next.splice(dragFrom, 1)
                    next.splice(i, 0, m!)
                    return next
                  })
                  setSelected(i)
                  setDragFrom(null)
                }}
                onClick={() => setSelected(i)}
                data-testid="irebase-row"
                className={cn('flex h-7 items-center gap-2 border-b border-border px-2 text-[13px]', i === selected ? 'bg-selected' : 'hover:bg-hover', r.action === 'drop' && 'opacity-50')}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted" />
                <select
                  className="h-6 w-20 rounded border border-border-strong bg-bg text-xs"
                  value={r.action}
                  onChange={(e) => {
                    setRow(i, { action: e.target.value as RebaseAction, message: undefined })
                    setSelected(i)
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {ACTIONS.map((a) => (
                    <option key={a.id} value={a.id} title={a.help}>
                      {a.id}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-xs text-muted">{shortHash(r.hash)}</span>
                <span className={cn('truncate', r.action === 'drop' && 'line-through')}>{(r.message ?? r.subject).split('\n')[0]}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">{formatDate(r.original.authorTime)}</span>
              </div>
            ))}
          </div>
          <div className="flex w-96 min-h-0 flex-col gap-2">
            {cur && (cur.action === 'reword' || cur.action === 'squash') ? (
              <>
                <div className="text-xs text-muted">{cur.action === 'squash' ? 'Message of the combined commit' : 'New message'}</div>
                <CommitMessageEditor
                  className="flex-1"
                  value={cur.message ?? defaultMessage(selected)}
                  onValueChange={(v) => setRow(selected, { message: v })}
                />
              </>
            ) : (
              <div className="space-y-1 text-xs text-muted">
                {ACTIONS.map((a) => (
                  <div key={a.id}>
                    <span className="font-mono text-fg">{a.id}</span> — {a.help}
                  </div>
                ))}
                {cur && <pre className="selectable mt-3 whitespace-pre-wrap font-sans text-[13px] text-fg">{cur.original.message}</pre>}
              </div>
            )}
          </div>
        </div>
        {invalid && <div className="text-xs text-danger">The oldest kept commit cannot be squash or fixup.</div>}
        {hasMerges && <div className="text-xs text-warning">Merge commits in this range are kept with --rebase-merges; reordering is not possible.</div>}
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button disabled={!rows || busy || !!invalid || !changed || (hasMerges && reordered)} onClick={() => void start()}>
            Start Rebasing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RESET_MODES: { mode: ResetMode; title: string; help: string; destructive?: boolean }[] = [
  { mode: 'soft', title: 'Soft', help: 'Move the branch; all changes of the removed commits stay staged. Working tree untouched.' },
  { mode: 'mixed', title: 'Mixed', help: 'Move the branch; changes of the removed commits stay in the working tree, unstaged.' },
  { mode: 'hard', title: 'Hard', help: 'Move the branch and make the working tree match it. Uncommitted changes are LOST.', destructive: true },
  { mode: 'keep', title: 'Keep', help: 'Like hard, but refuses to run if a file with local changes would be overwritten; keeps unrelated local changes.' }
]

export function ResetDialog({ root, commit, branch }: { root: string; commit: Commit; branch: string | null }) {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const go = async () => {
    if (mode === 'hard') {
      const ok = await confirm({
        title: 'Hard reset',
        message: `Reset ${branch ?? 'HEAD'} to ${shortHash(commit.hash)} and discard all uncommitted changes? Committed work stays recoverable via Undo Last Operation.`,
        confirmLabel: 'Hard Reset',
        destructive: true
      })
      if (!ok) return
    }
    closeModal()
    try {
      await api.rewrite.reset(root, commit.hash, mode)
      reportOutcome(root, { status: 'ok', message: `Reset ${branch ?? 'HEAD'} to ${shortHash(commit.hash)} (${mode})` }, { undoable: true })
    } catch (err) {
      notifyError(err, 'Reset failed')
    }
  }
  return (
    <Dialog {...open}>
      <DialogContent className="max-w-lg" data-testid="reset-dialog">
        <DialogHeader>
          <DialogTitle>Reset {branch ?? 'HEAD'} to Here</DialogTitle>
          <DialogDescription>
            {shortHash(commit.hash)} “{commit.subject}”
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {RESET_MODES.map((m) => (
            <label key={m.mode} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-hover">
              <input type="radio" className="mt-1" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
              <span>
                <span className={cn('font-medium', m.destructive && 'text-danger')}>{m.title}</span>
                <span className="block text-xs text-muted">{m.help}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant={mode === 'hard' ? 'danger' : 'default'} onClick={() => void go()}>
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FixupTargetDialog({ root, selected, mode, candidates }: { root: string; selected: Commit[]; mode: 'fixup' | 'squash'; candidates: Commit[] }) {
  const [target, setTarget] = useState<Commit | null>(null)
  const sel = new Set(selected.map((c) => c.hash))
  const list = candidates.filter((c) => !sel.has(c.hash) && c.parents.length < 2)
  return (
    <Dialog {...open}>
      <DialogContent className="max-w-2xl" data-testid="fixup-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'fixup' ? 'Fixup' : 'Squash'} Into…</DialogTitle>
          <DialogDescription>
            Choose the commit to {mode === 'fixup' ? 'fix up (its message is kept)' : 'squash into (you edit the combined message)'}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-auto rounded border border-border-strong bg-bg">
          {list.map((c) => (
            <div
              key={c.hash}
              onClick={() => setTarget(c)}
              onDoubleClick={() => setTarget(c)}
              className={cn('flex gap-2 px-2 py-1 text-[13px]', target?.hash === c.hash ? 'bg-selected' : 'hover:bg-hover')}
            >
              <span className="font-mono text-xs text-muted">{shortHash(c.hash)}</span>
              <span className="truncate">{c.subject}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{formatDate(c.authorTime)}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            disabled={!target}
            onClick={() => {
              closeModal()
              const all = [...selected, target!]
              const idx = (c: Commit) => candidates.findIndex((x) => x.hash === c.hash)
              const oldest = all.reduce((a, b) => (idx(a) >= idx(b) ? a : b))
              void fixupIntoFlow(root, selected, target!, mode, oldest)
            }}
          >
            {mode === 'fixup' ? 'Fixup' : 'Squash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReflogDialog({ root }: { root: string }) {
  const q = useQuery({ queryKey: ['repo', root, 'reflog'], queryFn: () => api.rewrite.reflog(root) })
  const backups = useQuery({ queryKey: ['repo', root, 'backups'], queryFn: () => api.rewrite.backups(root) })
  const [tab, setTab] = useState<'reflog' | 'backups'>('reflog')
  return (
    <Dialog {...open}>
      <DialogContent className="h-[75vh] max-w-4xl" data-testid="reflog-dialog">
        <DialogHeader>
          <DialogTitle>Reflog</DialogTitle>
          <DialogDescription>Where HEAD has been. Check out an entry (detached) or create a branch from it to recover lost work.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b border-border-strong">
          {(['reflog', 'backups'] as const).map((t) => (
            <button key={t} className={cn('px-3 py-1 text-[13px]', tab === t ? 'border-b-2 border-accent font-medium' : 'text-muted')} onClick={() => setTab(t)}>
              {t === 'reflog' ? 'HEAD reflog' : `Backup refs (${backups.data?.length ?? '…'})`}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border-strong bg-bg font-mono text-xs">
          {tab === 'reflog' &&
            q.data?.map((e) => (
              <div key={e.selector} className="group flex items-center gap-3 px-2 py-0.5 hover:bg-hover">
                <span className="w-20 shrink-0 text-muted">{e.selector}</span>
                <span className="w-20 shrink-0">{shortHash(e.hash)}</span>
                <span className="min-w-0 flex-1 truncate font-sans text-[13px]">{e.message}</span>
                <span className="shrink-0 font-sans text-muted">{formatDate(e.time)}</span>
                <button
                  className="hidden font-sans text-accent hover:underline group-hover:block"
                  onClick={() => {
                    closeModal()
                    void checkoutFlow(root, { kind: 'commit', name: e.hash, label: e.selector })
                  }}
                >
                  Checkout
                </button>
              </div>
            ))}
          {tab === 'backups' &&
            backups.data?.map((b) => (
              <div key={b.ref} className="flex items-center gap-3 px-2 py-0.5 hover:bg-hover">
                <span className="w-40 shrink-0 truncate">{b.branch}</span>
                <span className="w-20 shrink-0">{shortHash(b.hash)}</span>
                <span className="flex-1 font-sans text-[13px]">before {b.operation.replace(/-/g, ' ')}</span>
                <span className="shrink-0 font-sans text-muted">{new Date(b.time).toLocaleString()}</span>
              </div>
            ))}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              refreshRepo(root)
              closeModal()
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
