import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { MergeMode, WorktreeEntry, WorktreeForce, WorktreeMergeResult } from '@shared/types'
import { normalizeRepoPath, samePath } from '../paths'
import { checkRefFormat, merge } from './branches'
import { AppError } from './errors'
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
 * Merges `source` into `target`. A merge needs a working tree, so it runs in
 * the worktree where `target` is checked out. When `target` is not checked out
 * anywhere, only a fast-forward is possible (done by moving the ref).
 */
export async function mergeInto(runner: GitRunner, root: string, source: string, target: string, mode: MergeMode): Promise<WorktreeMergeResult> {
  const s = assertArg(source, 'source branch')
  const t = assertArg(target, 'target branch')
  if (s === t) throw new AppError('Source and target are the same branch.', 'INVALID_ARGUMENT')
  if (mode === 'squash') throw new AppError('Squash merges are not supported here; use Merge from the target worktree.', 'INVALID_ARGUMENT')
  const host = (await listWorktrees(runner, root)).find((w) => w.branch === t && !w.prunable)
  if (host) return { outcome: await merge(runner, host.path, s, mode), mergedIn: host.path }

  const tSha = (await runner.run(['rev-parse', '--verify', `refs/heads/${t}^{commit}`], { cwd: root })).stdout.trim()
  const sSha = (await runner.run(['rev-parse', '--verify', `refs/heads/${s}^{commit}`], { cwd: root })).stdout.trim()
  if (tSha === sSha) return { outcome: { status: 'ok', message: `${t} is already up to date with ${s}` }, mergedIn: null }
  const ff = await runner.run(['merge-base', '--is-ancestor', tSha, sSha], { cwd: root, okExitCodes: [0, 1] })
  if (ff.exitCode !== 0 || mode === 'no-ff') {
    throw new AppError(
      `“${t}” is not checked out in any worktree and ${mode === 'no-ff' ? 'a merge commit' : 'a fast-forward is not possible'} needs a working tree. Check out “${t}” in a worktree first.`,
      'INVALID_ARGUMENT'
    )
  }
  await runner.run(['update-ref', '-m', `merge ${s}: Fast-forward`, `refs/heads/${t}`, sSha, tSha], { cwd: root })
  return { outcome: { status: 'ok', message: `Fast-forwarded ${t} to ${s}` }, mergedIn: null }
}
