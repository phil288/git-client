import { toast } from 'sonner'
import type { MergeMode, WorktreeEntry, WorktreeForce } from '@shared/types'
import { api, ApiError } from '@/lib/api'
import { deleteBranchFlow, refreshRepo, reportOutcome } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { openRepoPath } from '@/lib/repoActions'
import { queryClient } from '@/lib/queryClient'
import { choose } from '@/stores/dialogs'
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
  const base = await removeWorktreeFlow(root, w.path, force)
  if (base && deleteBranch && w.branch) await deleteBranchFlow(base, w.branch)
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
    reportOutcome(where, res.outcome)
    if (res.mergedIn && !samePath(res.mergedIn, root)) {
      toast.info(`The merge is in progress in ${res.mergedIn}.`, {
        duration: 15_000,
        action: { label: `Open ${target}`, onClick: () => void openRepoPath(res.mergedIn!, 'new-tab') }
      })
    }
    return
  }
  toast.success(res.outcome.message)
  if (!cleanup || w.isMain) return
  const base = await removeWorktreeFlow(root, w.path, 0)
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
