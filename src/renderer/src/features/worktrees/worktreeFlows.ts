import { toast } from 'sonner'
import type { MergeMode, PendingMerge, WorktreeEntry, WorktreeForce } from '@shared/types'
import { api, ApiError } from '@/lib/api'
import { deleteBranchFlow, refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { openRepoPath } from '@/lib/repoActions'
import { queryClient } from '@/lib/queryClient'
import { choose } from '@/stores/dialogs'
import { openModal } from '@/stores/modals'
import { useTabsStore } from '@/stores/tabs'

const key = (p: string) => (api.platform() === 'win32' ? p.replace(/\//g, '\\').toLowerCase() : p)
export const samePath = (a: string, b: string): boolean => key(a) === key(b)

/** The main worktree of `root`'s repository: survives any linked-worktree removal, so later calls run there. */
async function mainWorktree(root: string): Promise<string> {
  const list = await api.worktree.list(root)
  return list.find((w) => w.isMain && !w.bare)?.path ?? list.find((w) => !w.prunable && !w.bare)?.path ?? root
}

/** Closes tabs showing a removed worktree; if the active one was closed, opens `fallback` in its place. */
function closeTabsFor(path: string, fallback: string): void {
  const s = useTabsStore.getState()
  const hits = s.tabs.filter((t) => samePath(t.path, path))
  const wasActive = hits.some((t) => t.id === s.activeId)
  for (const t of hits) s.close(t.id)
  queryClient.removeQueries({ queryKey: ['repo', path] })
  void api.recents.remove([path]).catch(() => undefined)
  if (wasActive) void openRepoPath(fallback, 'new-tab')
}

/**
 * Removes a worktree. force 0 first; when git refuses (dirty / locked) and
 * `askForce` is set, the user can escalate to `-f -f` in one click.
 * Returns the main worktree path on success (for follow-up calls), null otherwise.
 */
export async function removeWorktreeFlow(root: string, path: string, force: WorktreeForce, askForce = true): Promise<string | null> {
  let base: string
  try {
    base = await mainWorktree(root)
  } catch (err) {
    notifyError(err, 'Could not remove the worktree')
    return null
  }
  try {
    await api.worktree.remove(base, path, force)
  } catch (err) {
    const code = err instanceof ApiError ? err.info.code : null
    if (!askForce || (code !== 'DIRTY' && code !== 'LOCKED')) {
      notifyError(err, 'Could not remove the worktree')
      return null
    }
    const c = await choose({
      title: code === 'LOCKED' ? 'Worktree is locked' : 'Worktree has local changes',
      message:
        code === 'LOCKED'
          ? `“${path}” is locked. Force removal (git worktree remove -f -f) ignores the lock and discards any uncommitted changes.`
          : `“${path}” has uncommitted or untracked files. Force removal (git worktree remove -f -f) discards them permanently.`,
      choices: [
        { id: 'force', label: 'Force Remove (-f -f)', variant: 'danger' },
        { id: 'cancel', label: 'Cancel', variant: 'secondary' }
      ]
    })
    if (c !== 'force') return null
    try {
      await api.worktree.remove(base, path, 2)
    } catch (e) {
      notifyError(e, 'Could not remove the worktree')
      return null
    }
  }
  refreshRepo(base)
  refreshRepo(root)
  closeTabsFor(path, base)
  toast.success(`Removed worktree ${path}`)
  return base
}

/** Remove + optional branch delete (safe delete, force only after confirmation, with Restore). */
export async function removeWorktreeAndBranchFlow(root: string, w: WorktreeEntry, force: WorktreeForce, deleteBranch: boolean): Promise<void> {
  if (w.branch && (await blockedByPendingMerge(root, w.branch))) return
  const base = await removeWorktreeFlow(root, w.path, force)
  if (base && deleteBranch && w.branch) await deleteBranchFlow(base, w.branch)
}

/** The unfinished merge (in any worktree) that still needs `branch`, if any. */
export function pendingMergeOf(merges: PendingMerge[] | undefined, branch: string | null): PendingMerge | undefined {
  return branch ? merges?.find((m) => m.branches.includes(branch)) : undefined
}

/** Shows why and returns true when `branch` is part of an unfinished merge (removing/deleting now can lose commits). */
async function blockedByPendingMerge(root: string, branch: string): Promise<boolean> {
  let p: PendingMerge | undefined
  try {
    p = pendingMergeOf(await api.worktree.pendingMerges(root), branch)
  } catch (err) {
    notifyError(err, 'Could not check for merges in progress')
    return true
  }
  if (!p) return false
  const where = p.path
  toast.error(`${branch} is being merged into ${p.into ?? 'HEAD'} in ${where} and that merge is not finished. Commit or abort it first.`, {
    duration: 20_000,
    action: { label: 'Resolve…', onClick: () => openModal({ kind: 'conflicts', root: where }) }
  })
  return true
}

/**
 * Merges a worktree's branch into `target` (usually main) — in the worktree
 * where `target` is checked out — then optionally removes the worktree and
 * deletes the merged branch.
 */
export async function mergeWorktreeFlow(root: string, w: WorktreeEntry, target: string, mode: MergeMode, cleanup: boolean): Promise<void> {
  const source = w.branch
  if (!source) return
  let res
  try {
    res = await api.worktree.mergeInto(root, source, target, mode)
  } catch (err) {
    notifyError(err, `Could not merge ${source} into ${target}`)
    return
  }
  const where = res.mergedIn ?? root
  refreshRepo(root)
  if (res.mergedIn) refreshRepo(res.mergedIn)
  if (res.outcome.status !== 'ok') {
    // Nothing is removed or deleted: the merge is unfinished and still needs the branch.
    toast.warning(
      `Merging ${source} into ${target} stopped with conflicts in ${where}. The worktree and branch were kept. ` +
        `In the conflict tool, “Theirs” is ${source} (your worktree) and “Yours” is ${target}.`,
      { duration: 30_000, action: { label: 'Resolve…', onClick: () => openModal({ kind: 'conflicts', root: where }) } }
    )
    return
  }
  const changed = await api.repo
    .quickStatus(w.path)
    .then((s) => s.changedCount)
    .catch(() => 0)
  const uncommitted = changed > 0 ? ` ${changed} uncommitted change${changed === 1 ? '' : 's'} in ${w.path} ${changed === 1 ? 'was' : 'were'} not merged: only commits are merged. Commit them, then merge again.` : ''
  if (res.merged === 0) {
    // "Already up to date": nothing moved, so there is nothing to clean up either.
    toast.warning(`${res.outcome.message}${uncommitted}`, { duration: 30_000 })
    return
  }
  toast.success(res.outcome.message)
  if (changed > 0) {
    // Cleanup never discards work: a dirty worktree is kept (removing it would need -f -f).
    toast.warning(`The worktree was kept.${uncommitted}`, { duration: 30_000 })
    return
  }
  if (!cleanup || w.isMain) return
  const base = await removeWorktreeFlow(root, w.path, 0, false)
  if (!base) return
  try {
    // Merged into target, so a safe delete succeeds when run where target is checked out.
    await api.branch.delete(res.mergedIn ?? base, source, false)
    refreshRepo(base)
    toast.success(`Deleted branch ${source}`)
  } catch (err) {
    notifyError(err, `Worktree removed, but ${source} was not deleted`)
  }
}
