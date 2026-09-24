import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import type { MergeMode, WorktreeEntry } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { openRepoPath } from '@/lib/repoActions'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { useRefs } from '../log/LogView'
import { mergeWorktreeFlow, removeWorktreeAndBranchFlow } from './worktreeFlows'

const select = 'h-7 rounded-md border border-border-strong bg-bg px-2 text-[13px]'

function useOpen() {
  return { open: true, onOpenChange: (o: boolean) => !o && closeModal() }
}

export function useWorktrees(root: string) {
  return useQuery({ queryKey: ['repo', root, 'worktrees'], queryFn: () => api.worktree.list(root) })
}

export function useDefaultBranch(root: string) {
  return useQuery({ queryKey: ['repo', root, 'defaultBranch'], queryFn: () => api.worktree.defaultBranch(root), staleTime: 60_000 })
}

/** Uncommitted-change count of another worktree (quick status works on any path). */
function useChangedCount(path: string) {
  return useQuery({ queryKey: ['quickStatus', path, 'worktree'], queryFn: () => api.repo.quickStatus(path) }).data?.changedCount ?? null
}

export function AddWorktreeDialog({ root, start }: { root: string; start?: string }) {
  const refs = useRefs(root)
  const wts = useWorktrees(root)
  const info = useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) })
  const locals = (refs.data ?? []).filter((r) => r.kind === 'local').map((r) => r.short)
  const checkedOut = new Set((wts.data ?? []).map((w) => w.branch).filter(Boolean))
  const free = locals.filter((b) => !checkedOut.has(b))

  const [mode, setMode] = useState<'new' | 'existing'>(start && !checkedOut.has(start) && locals.includes(start) ? 'existing' : 'new')
  const [name, setName] = useState('')
  const [base, setBase] = useState(start ?? '')
  const [existing, setExisting] = useState(start && locals.includes(start) ? start : '')
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  const [valid, setValid] = useState<boolean | null>(null)
  const [openTab, setOpenTab] = useState(true)
  const [busy, setBusy] = useState(false)

  const baseRef = base || info.data?.branch || 'HEAD'
  const existingRef = existing || free[0] || ''
  const branchForPath = mode === 'new' ? name.trim() : existingRef

  useEffect(() => {
    if (mode !== 'new' || !name.trim()) return setValid(null)
    const t = setTimeout(() => void api.branch.checkName(root, name.trim()).then(setValid), 200)
    return () => clearTimeout(t)
  }, [name, root, mode])

  useEffect(() => {
    if (pathEdited || !branchForPath) return
    const t = setTimeout(() => void api.worktree.suggestPath(root, branchForPath).then(setPath).catch(() => undefined), 150)
    return () => clearTimeout(t)
  }, [branchForPath, pathEdited, root])

  const canSubmit = !busy && path.trim() !== '' && (mode === 'new' ? valid === true : existingRef !== '')

  const submit = async () => {
    setBusy(true)
    try {
      const created = await api.worktree.add(root, path.trim(), mode === 'new' ? baseRef : existingRef, mode === 'new' ? name.trim() : null)
      closeModal()
      refreshRepo(root)
      toast.success(`Created worktree ${created}`)
      if (openTab) await openRepoPath(created, 'new-tab')
    } catch (err) {
      notifyError(err, 'Could not create the worktree')
    } finally {
      setBusy(false)
    }
  }

  const browse = async () => {
    const dir = await api.dialog.pickFolder('Worktree location', path || undefined)
    if (dir) {
      setPath(dir)
      setPathEdited(true)
    }
  }

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-lg" data-testid="add-worktree-dialog">
        <DialogHeader>
          <DialogTitle>New Worktree</DialogTitle>
          <DialogDescription>A separate folder with its own checkout, sharing this repository’s history.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) void submit()
          }}
        >
          <div className="flex gap-3 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> New branch
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={free.length === 0} /> Existing branch
            </label>
          </div>
          {mode === 'new' ? (
            <>
              <Label htmlFor="wt-name">Branch name</Label>
              <Input id="wt-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feat/my-change" data-testid="wt-branch-name" />
              {valid === false && <div className="text-xs text-danger">Not a valid branch name.</div>}
              <Label htmlFor="wt-base">Based on</Label>
              <select id="wt-base" className={select} value={baseRef} onChange={(e) => setBase(e.target.value)}>
                {!locals.includes(baseRef) && <option value={baseRef}>{baseRef}</option>}
                {locals.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <Label htmlFor="wt-existing">Branch (not checked out elsewhere)</Label>
              <select id="wt-existing" className={select} value={existingRef} onChange={(e) => setExisting(e.target.value)}>
                {free.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </>
          )}
          <Label htmlFor="wt-path">Folder</Label>
          <div className="flex gap-1">
            <Input
              id="wt-path"
              className="flex-1 font-mono text-xs"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setPathEdited(true)
              }}
              data-testid="wt-path"
            />
            <Button type="button" variant="secondary" size="icon" title="Browse…" onClick={() => void browse()}>
              <FolderOpen />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={openTab} onCheckedChange={(c) => setOpenTab(c === true)} /> Open in a new tab
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="wt-create">
              Create Worktree
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveWorktreeDialog({ root, worktree: w }: { root: string; worktree: WorktreeEntry }) {
  const changed = useChangedCount(w.path)
  const def = useDefaultBranch(root).data
  const dirty = (changed ?? 0) > 0
  const needsForce = dirty || w.locked
  const [force, setForce] = useState(false)
  const [delBranch, setDelBranch] = useState(w.branch !== null && w.branch !== def)
  useEffect(() => setDelBranch(w.branch !== null && w.branch !== def), [def, w.branch])

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-lg" data-testid="remove-worktree-dialog">
        <DialogHeader>
          <DialogTitle>Remove Worktree</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{w.path}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-[13px]">
          {needsForce && (
            <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>
                {w.locked && <>This worktree is locked{w.lockReason ? ` (“${w.lockReason}”)` : ''}. </>}
                {dirty && <>It has {changed} uncommitted or untracked change{changed === 1 ? '' : 's'} that will be lost. </>}
                Removal needs force.
              </span>
            </div>
          )}
          <label className="flex items-start gap-2">
            <Checkbox className="mt-0.5" checked={force} onCheckedChange={(c) => setForce(c === true)} data-testid="wt-force" />
            <span>
              Force <span className="font-mono text-xs">git worktree remove -f -f</span>
              <span className="block text-xs text-muted">Discards uncommitted and untracked files and ignores a lock.</span>
            </span>
          </label>
          {w.branch && (
            <label className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={delBranch} onCheckedChange={(c) => setDelBranch(c === true)} data-testid="wt-delete-branch" />
              <span>
                Also delete branch ‘{w.branch}’
                <span className="block text-xs text-muted">Safe delete; if it is not fully merged you are asked before force-deleting. Restorable for 10 s.</span>
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={needsForce && !force}
            data-testid="wt-remove-confirm"
            onClick={() => {
              closeModal()
              void removeWorktreeAndBranchFlow(root, w, force ? 2 : 0, delBranch)
            }}
          >
            {force ? 'Force Remove' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MODES: { mode: MergeMode; label: string; help: string }[] = [
  { mode: 'default', label: 'Default', help: 'Fast-forward when possible, otherwise create a merge commit.' },
  { mode: 'no-ff', label: '--no-ff', help: 'Always create a merge commit.' },
  { mode: 'ff-only', label: '--ff-only', help: 'Only fast-forward; refuse when histories diverged.' }
]

export function MergeWorktreeDialog({ root, worktree: w }: { root: string; worktree: WorktreeEntry }) {
  const refs = useRefs(root)
  const wts = useWorktrees(root)
  const def = useDefaultBranch(root).data
  const changed = useChangedCount(w.path)
  const locals = (refs.data ?? []).filter((r) => r.kind === 'local' && r.short !== w.branch).map((r) => r.short)
  const [target, setTarget] = useState<string | null>(null)
  const [mode, setMode] = useState<MergeMode>('default')
  const [cleanup, setCleanup] = useState(!w.isMain)
  const t = target ?? (def && def !== w.branch ? def : (locals[0] ?? ''))
  const host = (wts.data ?? []).find((x) => x.branch === t && !x.prunable)

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-lg" data-testid="merge-worktree-dialog">
        <DialogHeader>
          <DialogTitle>
            Merge ‘{w.branch}’ into ‘{t || '…'}’
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{w.path}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-[13px]">
          <Label htmlFor="wt-target">Target branch</Label>
          <select id="wt-target" className={select} value={t} onChange={(e) => setTarget(e.target.value)} data-testid="wt-merge-target">
            {locals.map((b) => (
              <option key={b} value={b}>
                {b}
                {b === def ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <div className="text-xs text-muted">
            {host ? (
              <>
                Runs in the worktree where ‘{t}’ is checked out: <span className="font-mono">{host.path}</span>
              </>
            ) : (
              <>‘{t}’ is not checked out anywhere: only a fast-forward is possible.</>
            )}
          </div>
          {MODES.map((o) => (
            <label key={o.mode} className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-hover">
              <input type="radio" className="mt-1" checked={mode === o.mode} onChange={() => setMode(o.mode)} />
              <span>
                <span className="font-mono text-[13px]">{o.label}</span>
                <span className="block text-xs text-muted">{o.help}</span>
              </span>
            </label>
          ))}
          {(changed ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              This worktree has {changed} uncommitted change{changed === 1 ? '' : 's'}; only committed work is merged.
            </div>
          )}
          {!w.isMain && (
            <label className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={cleanup} onCheckedChange={(c) => setCleanup(c === true)} data-testid="wt-merge-cleanup" />
              <span>
                Then remove this worktree and delete ‘{w.branch}’
                <span className="block text-xs text-muted">Only after a clean merge. You are asked before forcing anything.</span>
              </span>
            </label>
          )}
          <div className="text-xs text-muted">A backup of ‘{t}’ is saved first; you can undo the merge from the target worktree.</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            disabled={!t}
            data-testid="wt-merge-confirm"
            onClick={() => {
              closeModal()
              void mergeWorktreeFlow(root, w, t, mode, cleanup)
            }}
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
