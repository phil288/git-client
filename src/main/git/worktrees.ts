import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { MergeIntoResult, MergeMode, MergePlan, PendingMerge, WorktreeEntry, WorktreeForce, WorktreeMergeResult } from '@shared/types'
import { normalizeRepoPath, samePath } from '../paths'
import { createBackup } from './backup'
import { checkRefFormat, merge } from './branches'
import { AppError } from './errors'
import { operationState } from './sequencer'
import type { GitRunner } from './runner'

function assertArg(v: string, what: string): string {
  const n = v.trim()
  if (n === '' || n.startsWith('-')) throw new AppError(`Invalid ${what}: ${v}`, 'INVALID_ARGUMENT')
  return n
}

/** Parses `git worktree list --porcelain` (records separated by blank lines). */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of out.split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    if (!lines[0]?.startsWith('worktree ')) continue
    const e: WorktreeEntry = {
      path: normalizeRepoPath(lines[0].slice('worktree '.length)),
      head: null,
      branch: null,
      detached: false,
      bare: false,
      isMain: entries.length === 0,
      locked: false,
      lockReason: null,
      prunable: false
    }
    for (const l of lines.slice(1)) {
      const sp = l.indexOf(' ')
      const key = sp < 0 ? l : l.slice(0, sp)
      const val = sp < 0 ? '' : l.slice(sp + 1)
      if (key === 'HEAD') e.head = /^0+$/.test(val) ? null : val
      else if (key === 'branch') e.branch = val.replace(/^refs\/heads\//, '')
      else if (key === 'detached') e.detached = true
      else if (key === 'bare') e.bare = true
      else if (key === 'locked') {
        e.locked = true
        e.lockReason = val || null
      } else if (key === 'prunable') e.prunable = true
    }
    entries.push(e)
  }
  return entries
}

export async function listWorktrees(runner: GitRunner, root: string): Promise<WorktreeEntry[]> {
  const r = await runner.run(['worktree', 'list', '--porcelain'], { cwd: root })
  return parseWorktreeList(r.stdout).map((e) => (e.prunable || e.bare || existsSync(e.path) ? e : { ...e, prunable: true }))
}

/** Default location for a new worktree: a sibling folder `<repo>-<slug>` next to the main worktree. */
export async function suggestWorktreePath(runner: GitRunner, root: string, name: string): Promise<string> {
  const main = (await listWorktrees(runner, root))[0]?.path ?? root
  const slug = name.trim().replace(/^.*\//, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
  const base = join(dirname(main), `${basename(main)}-${slug}`)
  let p = base
  for (let i = 2; existsSync(p); i++) p = `${base}-${i}`
  return p
}

/**
 * `git worktree add`. With `newBranch`, creates that branch at `start`;
 * otherwise checks out `start` (an existing local branch, or detached for any other commit-ish).
 */
export async function addWorktree(runner: GitRunner, root: string, path: string, start: string, newBranch: string | null): Promise<string> {
  const p = assertArg(path, 'path')
  const s = assertArg(start, 'start point')
  const args = ['worktree', 'add']
  if (newBranch !== null) {
    const b = assertArg(newBranch, 'branch name')
    if (!(await checkRefFormat(runner, root, b))) throw new AppError(`“${b}” is not a valid branch name.`, 'INVALID_ARGUMENT')
    args.push('-b', b)
  }
  args.push('--', p, s)
  try {
    await runner.run(args, { cwd: root })
  } catch (err) {
    // stderr starts with "Preparing worktree…"; surface the actual fatal line.
    const fatal = err instanceof AppError ? /^fatal: (.+)$/m.exec(err.extra.stderr ?? '')?.[1] : undefined
    if (fatal && err instanceof AppError) throw new AppError(fatal, err.code, err.extra)
    throw err
  }
  return normalizeRepoPath(p)
}

/**
 * `git worktree remove [-f [-f]]`. force 1 discards uncommitted/untracked
 * changes; force 2 also removes a locked worktree. Refusals map to
 * DIRTY / LOCKED so the UI can offer the matching force level.
 */
export async function removeWorktree(runner: GitRunner, root: string, path: string, force: WorktreeForce): Promise<void> {
  const p = assertArg(path, 'path')
  const list = await listWorktrees(runner, root)
  const target = list.find((w) => samePath(w.path, normalizeRepoPath(p)))
  if (target?.isMain) throw new AppError('The main worktree cannot be removed.', 'INVALID_ARGUMENT')
  // Run from a worktree that stays: git refuses to remove the one it runs in.
  const cwd = list.find((w) => !samePath(w.path, target?.path ?? p) && !w.prunable && !w.bare)?.path ?? list[0]?.path ?? root
  try {
    await runner.run(['worktree', 'remove', ...Array<string>(force).fill('--force'), '--', target?.path ?? p], { cwd })
  } catch (err) {
    const stderr = err instanceof AppError ? (err.extra.stderr ?? '') : ''
    if (/locked working tree/i.test(stderr)) throw new AppError('The worktree is locked.', 'LOCKED', err instanceof AppError ? err.extra : {})
    if (/modified or untracked files/i.test(stderr)) throw new AppError('The worktree has uncommitted or untracked changes.', 'DIRTY', err instanceof AppError ? err.extra : {})
    throw err
  }
}

export async function lockWorktree(runner: GitRunner, root: string, path: string, reason: string | null): Promise<void> {
  const args = ['worktree', 'lock']
  if (reason?.trim()) args.push('--reason', reason.trim())
  await runner.run([...args, '--', assertArg(path, 'path')], { cwd: root })
}

export async function unlockWorktree(runner: GitRunner, root: string, path: string): Promise<void> {
  await runner.run(['worktree', 'unlock', '--', assertArg(path, 'path')], { cwd: root })
}

export async function pruneWorktrees(runner: GitRunner, root: string): Promise<void> {
  await runner.run(['worktree', 'prune'], { cwd: root })
}

/** Default integration branch: origin/HEAD's target, else main, else master, else null. */
export async function defaultBranch(runner: GitRunner, root: string): Promise<string | null> {
  const head = await runner.run(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, okExitCodes: [0, 1, 128] })
  const candidates = [head.exitCode === 0 ? head.stdout.trim().replace(/^origin\//, '') : '', 'main', 'master'].filter(Boolean)
  for (const b of candidates) {
    const r = await runner.run(['rev-parse', '-q', '--verify', `refs/heads/${b}`], { cwd: root, okExitCodes: [0, 1] })
    if (r.exitCode === 0) return b
  }
  return null
}

/**
 * Unfinished merges across all worktrees. While MERGE_HEAD exists the merged
 * commits are referenced only by the source branch (and MERGE_HEAD, which an
 * abort drops), so that branch must not be deleted until the merge is committed.
 */
export async function pendingMerges(runner: GitRunner, root: string): Promise<PendingMerge[]> {
  const list = (await listWorktrees(runner, root)).filter((w) => !w.prunable && !w.bare)
  const out: PendingMerge[] = []
  for (const w of list) {
    const mh = await runner.run(['rev-parse', '-q', '--verify', 'MERGE_HEAD^{commit}'], { cwd: w.path, okExitCodes: [0, 1, 128] })
    if (mh.exitCode !== 0) continue
    const mergeHead = mh.stdout.trim()
    // Branches that contain the merged commit but whose commits are not in the target yet.
    const r = await runner.run(['for-each-ref', '--contains', mergeHead, ...(w.head ? ['--no-merged', w.head] : []), '--format=%(refname:short)', 'refs/heads'], { cwd: w.path })
    out.push({ path: w.path, into: w.branch, mergeHead, branches: r.stdout.split('\n').filter(Boolean) })
  }
  return out
}

/** Refuses to delete a branch that an unfinished merge depends on (force included). */
export async function assertNotBeingMerged(runner: GitRunner, root: string, branch: string): Promise<void> {
  const p = (await pendingMerges(runner, root)).find((m) => m.branches.includes(branch))
  if (!p) return
  throw new AppError(
    `“${branch}” is being merged into ${p.into ?? 'HEAD'} in ${p.path} and that merge is not finished. Commit or abort the merge first: deleting the branch now can lose its commits.`,
    'INVALID_ARGUMENT'
  )
}

/** Short display name of a revision: `refs/heads/x` → `x`, `refs/remotes/o/x` → `o/x`, `refs/tags/v1` → `v1`. */
export function shortRef(rev: string): string {
  return rev.replace(/^refs\/(heads|remotes|tags)\//, '')
}

const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`

/** Where and how merging `source` into local branch `target` would run (dialog preflight, flow dispatch). */
export async function mergePlan(runner: GitRunner, root: string, source: string, target: string): Promise<MergePlan> {
  const s = assertArg(source, 'source')
  const t = assertArg(target, 'target branch')
  const tSha = (await runner.run(['rev-parse', '--verify', '--end-of-options', `refs/heads/${t}^{commit}`], { cwd: root })).stdout.trim()
  const sSha = (await runner.run(['rev-parse', '--verify', '--end-of-options', `${s}^{commit}`], { cwd: root })).stdout.trim()
  const ahead = await commitsToMergeRev(runner, root, s, t)
  const host = (await listWorktrees(runner, root)).find((w) => w.branch === t && !w.prunable) ?? null
  const ff = await runner.run(['merge-base', '--is-ancestor', tSha, sSha], { cwd: root, okExitCodes: [0, 1] })
  return { ahead, host: host?.path ?? null, isCurrent: !!host && samePath(host.path, root), canFastForward: ff.exitCode === 0, sourceSha: sSha, targetSha: tSha }
}

/**
 * Merges any revision (branch, remote branch, tag, commit) into local branch
 * `target`. A merge needs a working tree, so it runs in the worktree where
 * `target` is checked out (the current one included). When `target` is checked
 * out nowhere, only a fast-forward is possible (done by moving the ref); other
 * cases throw NEEDS_CHECKOUT so the renderer can check `target` out first.
 */
export async function mergeRefInto(runner: GitRunner, root: string, source: string, target: string, mode: MergeMode): Promise<MergeIntoResult> {
  const s = assertArg(source, 'source')
  const t = assertArg(target, 'target branch')
  const sName = shortRef(s)
  if (s === t || s === `refs/heads/${t}`) throw new AppError('Source and target are the same branch.', 'INVALID_ARGUMENT')
  const p = await mergePlan(runner, root, s, t)
  if (p.ahead === 0) {
    // git would answer "Already up to date": say so instead of reporting a merge.
    return { outcome: { status: 'ok', message: `Nothing to merge: every commit of ${sName} is already in ${t}.` }, mergedIn: null, merged: 0 }
  }

  if (p.host) {
    // Never stack a merge on an unfinished operation: git's refusal would look like fresh conflicts.
    const st = await operationState(runner, p.host)
    if (st.operation || st.conflicted.length > 0) {
      throw new AppError(`${st.title || 'An operation with conflicts'} is still in progress in ${p.host}. Resolve and commit it, or abort it, first.`, 'DIRTY')
    }
    const outcome = await merge(runner, p.host, s, mode)
    const message =
      mode === 'squash' ? `Squashed ${plural(p.ahead)} of ${sName} into ${t}; commit the staged result` : `Merged ${plural(p.ahead)} of ${sName} into ${t}`
    return { outcome: outcome.status === 'ok' ? { ...outcome, message } : outcome, mergedIn: p.host, merged: p.ahead }
  }

  if (!p.canFastForward || mode === 'no-ff' || mode === 'squash') {
    const why = mode === 'no-ff' ? 'a merge commit' : mode === 'squash' ? 'a squash merge' : 'a fast-forward is not possible and a merge'
    throw new AppError(`“${t}” is not checked out in any worktree and ${why} needs a working tree. Check out “${t}” first.`, 'NEEDS_CHECKOUT')
  }
  await createBackup(runner, root, 'merge', t)
  await runner.run(['update-ref', '-m', `merge ${sName}: Fast-forward`, `refs/heads/${t}`, p.sourceSha, p.targetSha], { cwd: root })
  return { outcome: { status: 'ok', message: `Fast-forwarded ${t} to ${sName} (${plural(p.ahead)})` }, mergedIn: null, merged: p.ahead }
}

/**
 * Merges local branch `source` into `target` (worktree merge): mergeRefInto,
 * except squash is refused — its staged result would sit in another worktree.
 */
export async function mergeInto(runner: GitRunner, root: string, source: string, target: string, mode: MergeMode): Promise<WorktreeMergeResult> {
  const s = assertArg(source, 'source branch')
  const t = assertArg(target, 'target branch')
  if (s === t) throw new AppError('Source and target are the same branch.', 'INVALID_ARGUMENT')
  if (mode === 'squash') throw new AppError('Squash merges are not supported here; use Merge from the target worktree.', 'INVALID_ARGUMENT')
  return mergeRefInto(runner, root, `refs/heads/${s}`, t, mode)
}

/** Number of commits on local branch `source` that `target` does not have yet (what a merge would bring in). */
export async function commitsToMerge(runner: GitRunner, root: string, source: string, target: string): Promise<number> {
  return commitsToMergeRev(runner, root, `refs/heads/${assertArg(source, 'source')}`, target)
}

/** Same, for any revision as source (remote branch, tag, commit). */
export async function commitsToMergeRev(runner: GitRunner, root: string, source: string, target: string): Promise<number> {
  const r = await runner.run(['rev-list', '--count', `refs/heads/${assertArg(target, 'target')}..${assertArg(source, 'source')}`, '--'], { cwd: root })
  return Number(r.stdout.trim()) || 0
}
