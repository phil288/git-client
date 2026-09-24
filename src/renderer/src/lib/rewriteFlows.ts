import { toast } from 'sonner'
import type { Commit, RebaseTodoItem, RewritePlan } from '@shared/types'
import { choose, confirm } from '@/stores/dialogs'
import { openModal } from '@/stores/modals'
import { editMessage } from '@/features/rewrite/MessageDialog'
import { api, ApiError, errorInfo } from './api'
import { checkoutFlow, outcomeActions, refreshRepo, reportOutcome } from './gitOps'
import { notifyError } from './notify'

export type RangeCommit = Commit & { message: string }

/** Oldest = last in log order (the log lists newest first). */
export function oldestOf(commits: Commit[]): Commit {
  return commits[commits.length - 1]!
}

interface Preflight {
  autostash: boolean
  rebaseMerges: boolean
}

/**
 * Warnings before rewriting: already-pushed commits (force push needed),
 * merge commits in range (--rebase-merges), dirty working tree (stash and
 * continue). Returns null when the user cancels.
 */
export async function preflight(root: string, base: string | null, hashes: string[], opts: { reorders: boolean }): Promise<Preflight | null> {
  const check = await api.rewrite.check(root, base, hashes)
  if (check.pushed) {
    const ok = await confirm({
      title: 'Commits already pushed',
      message: `Some of these commits are already on ${check.upstream}. After rewriting them you will need to force push (GitClient uses --force-with-lease), and anyone who pulled them will have to reconcile their copies.`,
      confirmLabel: 'Rewrite Anyway'
    })
    if (!ok) return null
  }
  let rebaseMerges = false
  if (check.containsMerges) {
    if (opts.reorders) {
      notifyError(new Error('The range contains merge commits. Reordering, squashing across or dropping commits around merges is not supported; rebase from a commit after the last merge.'))
      return null
    }
    const ok = await confirm({
      title: 'Merge commits in range',
      message: 'The commits to rewrite have merge commits after them. GitClient can keep the merges with git rebase --rebase-merges (actions on individual commits only, no reordering).',
      confirmLabel: 'Use --rebase-merges'
    })
    if (!ok) return null
    rebaseMerges = true
  }
  let autostash = false
  if (check.dirty) {
    const c = await choose({
      title: 'Uncommitted changes',
      message: 'Your working tree has uncommitted changes. History can only be rewritten on a clean tree.',
      choices: [
        { id: 'stash', label: 'Stash and Continue', description: 'stash the changes, rewrite, then restore them automatically' },
        { id: 'cancel', label: 'Cancel', variant: 'secondary' }
      ]
    })
    if (c !== 'stash') return null
    autostash = true
  }
  return { autostash, rebaseMerges }
}

/** Loads base..HEAD and builds a pick-everything plan (merges excluded — they are kept by git). */
export async function loadRange(root: string, base: string | null): Promise<RangeCommit[]> {
  return api.rewrite.commits(root, base)
}

export async function runPlan(root: string, plan: RewritePlan, operation: string): Promise<void> {
  try {
    const out = await api.rewrite.run(root, plan, operation)
    reportOutcome(root, out, { undoable: true })
  } catch (err) {
    notifyError(err, 'Rewrite failed')
    refreshRepo(root)
  }
}

async function transform(
  root: string,
  selected: Commit[],
  operation: string,
  opts: { reorders: boolean; base?: string | null },
  edit: (items: RebaseTodoItem[], commits: RangeCommit[]) => RebaseTodoItem[] | null
): Promise<void> {
  try {
    const base = opts.base !== undefined ? opts.base : oldestOf(selected).parents[0] ?? null
    const range = await loadRange(root, base)
    const pre = await preflight(root, base, selected.map((c) => c.hash), opts)
    if (!pre) return
    const picks = range.filter((c) => !pre.rebaseMerges || c.parents.length < 2)
    const items = edit(
      picks.map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject })),
      range
    )
    if (!items) return
    await runPlan(root, { base, items, ...pre }, operation)
  } catch (err) {
    notifyError(err)
  }
}

export async function rewordFlow(root: string, commit: Commit, headSha: string | null): Promise<void> {
  const details = await api.repo.commitDetails(root, commit.hash)
  const message = await editMessage({ title: 'Edit Commit Message', description: `${commit.hash.slice(0, 8)} — ${commit.subject}`, initial: details.message, confirmLabel: 'Reword' })
  if (message === null || message.trim() === details.message.trim()) return
  if (commit.hash === headSha) {
    try {
      await api.rewrite.amendHead(root, message)
      reportOutcome(root, { status: 'ok', message: 'Commit message updated' }, { undoable: true })
    } catch (err) {
      notifyError(err, 'Reword failed')
    }
    return
  }
  await transform(root, [commit], 'reword', { reorders: false }, (items) => items.map((i) => (i.hash === commit.hash ? { ...i, action: 'reword', message } : i)))
}

/** Squash several selected commits into the oldest one, with an editable combined message. */
export async function squashSelectedFlow(root: string, selected: Commit[]): Promise<void> {
  if (selected.length < 2) return
  const oldest = oldestOf(selected)
  const range = await loadRange(root, oldest.parents[0] ?? null)
  const sel = new Set(selected.map((c) => c.hash))
  const combined = range
    .filter((c) => sel.has(c.hash))
    .map((c) => c.message)
    .join('\n\n')
  const message = await editMessage({ title: `Squash ${selected.length} Commits`, initial: combined, confirmLabel: 'Squash' })
  if (message === null) return
  // Non-adjacent selections move commits next to each other: that is a reorder.
  const idx = range.map((c, i) => (sel.has(c.hash) ? i : -1)).filter((i) => i >= 0)
  const reorders = idx.length > 0 && idx[idx.length - 1]! - idx[0]! + 1 !== idx.length
  await transform(root, selected, 'squash', { reorders }, (items) => {
    const first = items.find((i) => sel.has(i.hash))!
    const others = items.filter((i) => sel.has(i.hash) && i !== first).map((i) => ({ ...i, action: 'squash' as const }))
    const rest = items.filter((i) => !sel.has(i.hash))
    const idx = items.indexOf(first)
    const before = rest.filter((i) => items.indexOf(i) < idx)
    const after = rest.filter((i) => items.indexOf(i) > idx)
    if (others.length) others[others.length - 1] = { ...others[others.length - 1]!, message }
    return [...before, first, ...others, ...after]
  })
}

/**
 * Fixup / Squash selected commits into `target`. `oldest` is the oldest of
 * target and selection (the caller knows the log order).
 */
export async function fixupIntoFlow(root: string, selected: Commit[], target: Commit, mode: 'fixup' | 'squash', oldest: Commit): Promise<void> {
  const sel = new Set(selected.map((c) => c.hash))
  if (sel.has(target.hash)) return
  const all = [...selected, target]
  let message: string | undefined
  if (mode === 'squash') {
    const msgs = await Promise.all([target, ...selected].map((c) => api.repo.commitDetails(root, c.hash).then((d) => d.message)))
    const m = await editMessage({ title: 'Squash Into', initial: msgs.join('\n\n'), confirmLabel: 'Squash' })
    if (m === null) return
    message = m
  }
  await transform(root, all, mode, { reorders: true, base: oldest.parents[0] ?? null }, (items) => {
    const moved = items.filter((i) => sel.has(i.hash)).map((i) => ({ ...i, action: mode }))
    if (message !== undefined && moved.length) moved[moved.length - 1] = { ...moved[moved.length - 1]!, message }
    const out: RebaseTodoItem[] = []
    for (const i of items) {
      if (sel.has(i.hash)) continue
      out.push(i)
      if (i.hash === target.hash) out.push(...moved)
    }
    return out
  })
}

export async function dropFlow(root: string, selected: Commit[]): Promise<void> {
  const ok = await confirm({
    title: `Drop ${selected.length} commit${selected.length === 1 ? '' : 's'}`,
    message: `Remove ${selected.map((c) => `“${c.subject}”`).join(', ')} from the history of the current branch? A backup is kept: use Undo Last Operation to restore.`,
    confirmLabel: 'Drop',
    destructive: true
  })
  if (!ok) return
  const sel = new Set(selected.map((c) => c.hash))
  await transform(root, selected, 'drop', { reorders: false }, (items) => items.map((i) => (sel.has(i.hash) ? { ...i, action: 'drop' } : i)))
}

export async function undoLastFlow(root: string): Promise<void> {
  try {
    const r = await api.rewrite.undoLast(root, false)
    refreshRepo(root)
    toast.success(`Undid ${r.operation.replace(/-/g, ' ')}`)
  } catch (err) {
    if (!(err instanceof ApiError) || err.info.code !== 'DIRTY') return notifyError(err, 'Undo failed')
    const ok = await confirm({
      title: 'Undo would overwrite local changes',
      message: 'Undoing needs a hard reset, which discards your uncommitted changes in the affected files.',
      confirmLabel: 'Hard Reset and Undo',
      destructive: true
    })
    if (!ok) return
    try {
      const r = await api.rewrite.undoLast(root, true)
      refreshRepo(root)
      toast.success(`Undid ${r.operation.replace(/-/g, ' ')}`)
    } catch (e) {
      notifyError(e, 'Undo failed')
    }
  }
}
outcomeActions.undo = (root) => void undoLastFlow(root)

export async function cherryPickFlow(root: string, selected: Commit[]): Promise<void> {
  try {
    reportOutcome(root, await api.rewrite.cherryPick(root, [...selected].reverse().map((c) => c.hash)), { undoable: true })
  } catch (err) {
    notifyError(err, 'Cherry-pick failed')
  }
}

export async function revertFlow(root: string, selected: Commit[]): Promise<void> {
  try {
    reportOutcome(root, await api.rewrite.revert(root, selected.map((c) => c.hash)), { undoable: true })
  } catch (err) {
    notifyError(err, 'Revert failed')
  }
}

export async function patchFlow(root: string, selected: Commit[]): Promise<void> {
  try {
    const text = await api.rewrite.patch(root, [...selected].reverse().map((c) => c.hash))
    const name = selected.length === 1 ? `${selected[0]!.subject.replace(/[^\w.-]+/g, '-').slice(0, 60)}.patch` : `${selected.length}-commits.patch`
    const path = await api.dialog.saveText('Save Patch', name, text)
    if (path) toast.success(`Patch saved to ${path}`)
  } catch (err) {
    notifyError(err, 'Could not create the patch')
  }
}

export async function undoCommitFlow(root: string): Promise<void> {
  try {
    await api.rewrite.undoCommit(root)
    reportOutcome(root, { status: 'ok', message: 'Commit undone; its changes are staged' }, { undoable: true })
  } catch (err) {
    notifyError(err, 'Undo commit failed')
  }
}

export function checkoutRevisionFlow(root: string, c: Commit): Promise<void> {
  return checkoutFlow(root, { kind: 'commit', name: c.hash, label: `${c.hash.slice(0, 8)} “${c.subject}”` })
}

export function interactiveRebaseFlow(root: string, from: Commit): void {
  openModal({ kind: 'interactiveRebase', root, base: from.parents[0] ?? null, fromLabel: `${from.hash.slice(0, 8)} ${from.subject}` })
}

export { errorInfo }
