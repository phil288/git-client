import { toast } from 'sonner'
import type { OpOutcome, PullMode, Ref } from '@shared/types'
import { useAppStore } from '@/stores/app'
import { choose, confirm } from '@/stores/dialogs'
import { useRepoEpoch } from '@/stores/repoEpoch'
import { api, ApiError, errorInfo } from './api'
import { notifyError } from './notify'
import { queryClient } from './queryClient'
import { newId } from './utils'

/** Refresh everything shown for a repository (log, refs, status…). */
export function refreshRepo(root: string): void {
  useRepoEpoch.getState().bump(root)
  void queryClient.invalidateQueries({ queryKey: ['repo', root] })
  void queryClient.invalidateQueries({ queryKey: ['quickStatus', root] })
}

/** Hook for later milestones (conflict resolver, undo). */
export const outcomeActions: {
  resolveConflicts?: (root: string) => void
  undo?: (root: string) => void
} = {}

export function reportOutcome(root: string, out: OpOutcome, opts: { undoable?: boolean } = {}): void {
  refreshRepo(root)
  if (out.status === 'conflicts') {
    toast.warning(out.message, {
      duration: 15_000,
      action: outcomeActions.resolveConflicts ? { label: 'Resolve…', onClick: () => outcomeActions.resolveConflicts?.(root) } : undefined
    })
  } else if (out.status === 'stopped') {
    toast.info(out.message, { duration: 10_000 })
  } else {
    toast.success(out.message, {
      action: opts.undoable && outcomeActions.undo ? { label: 'Undo', onClick: () => outcomeActions.undo?.(root) } : undefined
    })
  }
}

/** Runs an action; errors become toasts with git's stderr. */
export async function attempt<T>(fn: () => Promise<T>, errorTitle?: string): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    notifyError(err, errorTitle)
    return undefined
  }
}

const LOCAL_CHANGES_CHOICES = [
  {
    id: 'smart' as const,
    label: 'Smart Checkout',
    description: 'stash your changes, check out, then re-apply them (conflicts are shown if they overlap)'
  },
  { id: 'force' as const, label: 'Force Checkout', variant: 'danger' as const, description: 'discard your local changes to the affected files' },
  { id: 'cancel' as const, label: 'Cancel', variant: 'secondary' as const }
]

async function askLocalChanges(target: string): Promise<'smart' | 'force' | null> {
  const c = await choose({
    title: 'Local changes would be overwritten',
    message: `Checking out “${target}” would overwrite local changes in your working tree.`,
    choices: LOCAL_CHANGES_CHOICES
  })
  return c === 'smart' || c === 'force' ? c : null
}

export type CheckoutTarget =
  | { kind: 'local'; name: string; label?: string }
  | { kind: 'remote'; name: string; remote: string; label?: string }
  | { kind: 'tag' | 'commit'; name: string; label?: string }

export function refToTarget(r: Ref): CheckoutTarget {
  if (r.kind === 'local') return { kind: 'local', name: r.short }
  if (r.kind === 'remote') return { kind: 'remote', name: r.short, remote: r.remote ?? r.short.split('/')[0]! }
  return { kind: 'tag', name: r.short }
}

/** Checkout with the JetBrains flow: detached-HEAD warning, Smart / Force checkout on local changes. */
export async function checkoutFlow(root: string, t: CheckoutTarget): Promise<void> {
  const detached = t.kind === 'tag' || t.kind === 'commit'
  if (detached) {
    const ok = await confirm({
      title: 'Checkout revision',
      message: `Checking out ${t.label ?? t.name} puts the repository in “detached HEAD” state: new commits will not belong to any branch unless you create one.`,
      confirmLabel: 'Checkout'
    })
    if (!ok) return
  }
  const localName = t.kind === 'remote' ? t.name.slice(t.remote.length + 1) : t.name
  const plain = () =>
    t.kind === 'remote'
      ? api.branch.checkoutRemote(root, t.name, localName).then(() => undefined)
      : api.branch.checkout(root, t.name, { detach: detached })
  try {
    await plain()
    refreshRepo(root)
    toast.success(`Checked out ${t.kind === 'remote' ? localName : (t.label ?? t.name)}`)
  } catch (err) {
    if (!(err instanceof ApiError) || err.info.code !== 'LOCAL_CHANGES') return notifyError(err, 'Checkout failed')
    const choice = await askLocalChanges(t.label ?? t.name)
    if (!choice) return
    try {
      if (choice === 'force') {
        if (t.kind === 'remote') await api.branch.checkoutRemote(root, t.name, localName, { force: true })
        else await api.branch.checkout(root, t.name, { force: true, detach: detached })
        refreshRepo(root)
        toast.success(`Checked out ${localName} (local changes discarded)`)
      } else {
        const out = t.kind === 'remote' ? await api.branch.checkoutRemote(root, t.name, localName, { smart: true }) : await api.branch.smartCheckout(root, t.name, { detach: detached })
        reportOutcome(root, out)
      }
    } catch (e) {
      notifyError(e, 'Checkout failed')
    }
  }
}

/** Safe delete; force delete only after an explicit confirmation; Restore toast for 10 s. */
export async function deleteBranchFlow(root: string, name: string): Promise<void> {
  let sha: string
  try {
    sha = await api.branch.delete(root, name, false)
  } catch (err) {
    if (!(err instanceof ApiError) || err.info.code !== 'NOT_MERGED') return notifyError(err, 'Delete failed')
    const ok = await confirm({
      title: 'Branch not fully merged',
      message: `“${name}” has commits that are not merged into the current branch or its upstream. Deleting it can lose those commits (you can restore it right after, or via the reflog).`,
      confirmLabel: 'Force Delete',
      destructive: true
    })
    if (!ok) return
    try {
      sha = await api.branch.delete(root, name, true)
    } catch (e) {
      return notifyError(e, 'Delete failed')
    }
  }
  refreshRepo(root)
  toast.success(`Deleted branch ${name}`, {
    duration: 10_000,
    action: {
      label: 'Restore',
      onClick: () =>
        void api.branch
          .restore(root, name, sha)
          .then(() => {
            refreshRepo(root)
            toast.success(`Restored ${name}`)
          })
          .catch((e) => notifyError(e, 'Restore failed'))
    }
  })
}

export async function deleteRemoteBranchFlow(root: string, remote: string, branch: string): Promise<void> {
  const ok = await confirm({
    title: 'Delete remote branch',
    message: `Delete “${branch}” on the remote “${remote}”? This affects everyone using that remote.`,
    confirmLabel: 'Delete Remote Branch',
    destructive: true
  })
  if (!ok) return
  await attempt(async () => {
    await api.branch.deleteRemote(root, remote, branch, newId())
    refreshRepo(root)
    toast.success(`Deleted ${remote}/${branch}`)
  }, 'Delete failed')
}

export async function fetchFlow(root: string, remote: string | null = null): Promise<void> {
  await attempt(async () => {
    await api.remote.fetch(root, remote, true, newId())
    refreshRepo(root)
    toast.success(remote ? `Fetched ${remote}` : 'Fetched all remotes')
  }, 'Fetch failed')
}

export async function pullFlow(root: string, mode?: PullMode): Promise<void> {
  const m = mode ?? useAppStore.getState().settings.pullMode
  try {
    const out = await api.remote.pull(root, m, newId())
    reportOutcome(root, out, { undoable: true })
  } catch (err) {
    if (errorInfo(err).code !== 'CANCELLED') notifyError(err, 'Pull failed')
  }
}

export async function mergeFlow(root: string, ref: string, mode: Parameters<typeof api.branch.merge>[2]): Promise<void> {
  try {
    reportOutcome(root, await api.branch.merge(root, ref, mode), { undoable: true })
  } catch (err) {
    notifyError(err, 'Merge failed')
  }
}

export async function rebaseFlow(root: string, onto: string, branch: string | null): Promise<void> {
  try {
    reportOutcome(root, await api.branch.rebase(root, onto, branch), { undoable: true })
  } catch (err) {
    notifyError(err, 'Rebase failed')
  }
}
