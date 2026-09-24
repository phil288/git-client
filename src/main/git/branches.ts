import type { CompareResult, MergeMode, OpOutcome, PullMode, PushOptions, Remote } from '@shared/types'
import { createBackup } from './backup'
import { editorEnv } from './editors'
import { AppError } from './errors'
import { LOG_FORMAT, takeLogRecords } from './parsers'
import { changedFiles } from './repoData'
import type { GitRunner, RunOptions } from './runner'

/** Progress callback for network operations (clone/fetch/pull/push). */
export type Progress = (line: string, percent: number | null) => void

export function progressPercent(line: string): number | null {
  const m = /(\d+)%/.exec(line)
  return m ? Number(m[1]) : null
}

function assertName(name: string, what = 'name'): string {
  const n = name.trim()
  if (n === '' || n.startsWith('-')) throw new AppError(`Invalid ${what}: ${name}`, 'INVALID_ARGUMENT')
  return n
}

/** Unmerged paths after a merge/rebase/pull/stash that stopped. */
export async function hasConflicts(runner: GitRunner, root: string): Promise<boolean> {
  const r = await runner.run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root })
  return r.stdout.length > 0
}

/**
 * Runs a command that may stop on conflicts. Conflicts are an expected outcome
 * (the UI switches to conflict mode), not an error.
 */
export async function runMayConflict(runner: GitRunner, root: string, args: string[], opts: RunOptions, okMessage: string): Promise<OpOutcome> {
  try {
    await runner.run(args, { cwd: root, ...opts, env: { ...editorEnv().base, ...opts.env } })
    return { status: 'ok', message: okMessage }
  } catch (err) {
    if (await hasConflicts(runner, root)) {
      return { status: 'conflicts', message: 'Stopped with conflicts. Resolve them, then continue or abort.' }
    }
    throw err
  }
}

export async function checkRefFormat(runner: GitRunner, root: string, name: string): Promise<boolean> {
  if (name.trim() === '' || name.startsWith('-')) return false
  const r = await runner.run(['check-ref-format', '--branch', name], { cwd: root, okExitCodes: [0, 1, 128] })
  return r.exitCode === 0
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

function isLocalChangesError(err: unknown): boolean {
  return err instanceof AppError && /would be overwritten by checkout|Please commit your changes or stash them/i.test(err.extra.stderr ?? '')
}

/**
 * Checks out a local branch or a commit. Local changes that would be
 * overwritten raise LOCAL_CHANGES so the UI can offer Smart / Force checkout.
 */
export async function checkout(runner: GitRunner, root: string, target: string, opts: { force?: boolean; detach?: boolean } = {}): Promise<void> {
  const t = assertName(target, 'revision')
  const args = ['checkout']
  if (opts.force) args.push('--force')
  if (opts.detach) args.push('--detach')
  args.push(t, '--')
  try {
    await runner.run(args, { cwd: root })
  } catch (err) {
    if (isLocalChangesError(err)) {
      throw new AppError('Your local changes would be overwritten by checkout.', 'LOCAL_CHANGES', (err as AppError).extra)
    }
    throw err
  }
}

/** Stash local changes, check out, re-apply them (JetBrains "Smart Checkout"). */
export async function smartCheckout(runner: GitRunner, root: string, target: string, opts: { detach?: boolean } = {}): Promise<OpOutcome> {
  const t = assertName(target, 'revision')
  const before = await runner.run(['stash', 'list', '--format=%H'], { cwd: root })
  await runner.run(['stash', 'push', '-m', `GitClient smart checkout to ${t}`], { cwd: root })
  const after = await runner.run(['stash', 'list', '--format=%H'], { cwd: root })
  const stashed = after.stdout.split('\n')[0] !== before.stdout.split('\n')[0]
  try {
    await checkout(runner, root, t, opts)
  } catch (err) {
    if (stashed) await runner.run(['stash', 'pop'], { cwd: root, okExitCodes: [0, 1] })
    throw err
  }
  if (!stashed) return { status: 'ok', message: `Checked out ${t}` }
  const pop = await runMayConflict(runner, root, ['stash', 'pop'], {}, `Checked out ${t} and restored your changes`)
  if (pop.status === 'conflicts') {
    return { status: 'conflicts', message: `Checked out ${t}. Re-applying your changes produced conflicts; the stash is kept until they are resolved.` }
  }
  return pop
}

/** origin/foo → checks out local foo (creating it to track origin/foo if needed). */
export async function checkoutRemote(runner: GitRunner, root: string, remoteBranch: string, localName: string, opts: { force?: boolean } = {}): Promise<void> {
  const rb = assertName(remoteBranch, 'branch')
  const local = assertName(localName, 'branch')
  const exists = await runner.run(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], { cwd: root, okExitCodes: [0, 1] })
  if (exists.exitCode === 0) return checkout(runner, root, local, opts)
  const args = ['checkout', ...(opts.force ? ['--force'] : []), '--track', '-b', local, rb, '--']
  try {
    await runner.run(args, { cwd: root })
  } catch (err) {
    if (isLocalChangesError(err)) throw new AppError('Your local changes would be overwritten by checkout.', 'LOCAL_CHANGES', (err as AppError).extra)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Create / rename / delete / upstream
// ---------------------------------------------------------------------------

export async function createBranch(runner: GitRunner, root: string, name: string, start: string, checkoutAfter: boolean): Promise<void> {
  const n = assertName(name, 'branch name')
  if (!(await checkRefFormat(runner, root, n))) throw new AppError(`“${n}” is not a valid branch name.`, 'INVALID_ARGUMENT')
  const s = assertName(start, 'start point')
  if (checkoutAfter) {
    try {
      await runner.run(['checkout', '--no-track', '-b', n, s, '--'], { cwd: root })
    } catch (err) {
      if (isLocalChangesError(err)) throw new AppError('Your local changes would be overwritten by checkout.', 'LOCAL_CHANGES', (err as AppError).extra)
      throw err
    }
  } else {
    await runner.run(['branch', '--no-track', n, s], { cwd: root })
  }
}

async function upstreamOf(runner: GitRunner, root: string, branch: string): Promise<{ remote: string; merge: string } | null> {
  const r = await runner.run(['config', '--get', `branch.${branch}.remote`], { cwd: root, okExitCodes: [0, 1] })
  const m = await runner.run(['config', '--get', `branch.${branch}.merge`], { cwd: root, okExitCodes: [0, 1] })
  if (r.exitCode !== 0 || m.exitCode !== 0) return null
  return { remote: r.stdout.trim(), merge: m.stdout.trim().replace(/^refs\/heads\//, '') }
}

/** Renames a local branch; optionally also on its remote (push new, delete old, re-point upstream). */
export async function renameBranch(runner: GitRunner, root: string, oldName: string, newName: string, renameRemote: boolean, progress?: Progress): Promise<void> {
  const o = assertName(oldName, 'branch')
  const n = assertName(newName, 'branch name')
  if (!(await checkRefFormat(runner, root, n))) throw new AppError(`“${n}” is not a valid branch name.`, 'INVALID_ARGUMENT')
  const up = renameRemote ? await upstreamOf(runner, root, o) : null
  await runner.run(['branch', '-m', o, n], { cwd: root })
  if (up && up.remote !== '.') {
    const onLine = (l: string) => progress?.(l, progressPercent(l))
    await runner.run(['push', '--progress', '--set-upstream', up.remote, `refs/heads/${n}:refs/heads/${n}`], { cwd: root, onStderrLine: onLine })
    await runner.run(['push', '--progress', up.remote, '--delete', `refs/heads/${up.merge}`], { cwd: root, onStderrLine: onLine })
  }
}

/** Safe delete; returns the SHA for the "Restore" toast. NOT_MERGED when -d refuses. */
export async function deleteBranch(runner: GitRunner, root: string, name: string, force: boolean): Promise<string> {
  const n = assertName(name, 'branch')
  const sha = (await runner.run(['rev-parse', '--verify', `refs/heads/${n}`], { cwd: root })).stdout.trim()
  try {
    await runner.run(['branch', force ? '-D' : '-d', n], { cwd: root })
  } catch (err) {
    if (err instanceof AppError && /not fully merged/i.test(err.extra.stderr ?? '')) {
      throw new AppError(`The branch “${n}” is not fully merged.`, 'NOT_MERGED', err.extra)
    }
    throw err
  }
  return sha
}

export async function restoreBranch(runner: GitRunner, root: string, name: string, sha: string): Promise<void> {
  await runner.run(['branch', assertName(name, 'branch'), assertName(sha, 'commit')], { cwd: root })
}

export async function deleteRemoteBranch(runner: GitRunner, root: string, remote: string, branch: string, progress?: Progress): Promise<void> {
  await runner.run(['push', '--progress', assertName(remote, 'remote'), '--delete', `refs/heads/${assertName(branch, 'branch')}`], {
    cwd: root,
    onStderrLine: (l) => progress?.(l, progressPercent(l))
  })
}

export async function setUpstream(runner: GitRunner, root: string, branch: string, upstream: string | null): Promise<void> {
  const b = assertName(branch, 'branch')
  if (upstream === null) await runner.run(['branch', '--unset-upstream', b], { cwd: root })
  else await runner.run(['branch', `--set-upstream-to=${assertName(upstream, 'upstream')}`, b], { cwd: root })
}

// ---------------------------------------------------------------------------
// Merge / rebase / compare
// ---------------------------------------------------------------------------

export async function merge(runner: GitRunner, root: string, ref: string, mode: MergeMode): Promise<OpOutcome> {
  const r = assertName(ref, 'revision')
  await createBackup(runner, root, 'merge')
  const args = ['merge', '--no-edit']
  if (mode === 'no-ff') args.push('--no-ff')
  if (mode === 'ff-only') args.push('--ff-only')
  if (mode === 'squash') args.push('--squash')
  args.push(r)
  const out = await runMayConflict(runner, root, args, {}, mode === 'squash' ? `Squashed ${r}; commit the staged result` : `Merged ${r}`)
  return out
}

/** `git rebase <onto> [<branch>]` (branch given: check it out first, then rebase it). */
export async function rebase(runner: GitRunner, root: string, onto: string, branch?: string): Promise<OpOutcome> {
  const o = assertName(onto, 'revision')
  const args = ['rebase', o]
  if (branch) args.push(assertName(branch, 'branch'))
  await createBackup(runner, root, 'rebase', branch)
  return runMayConflict(runner, root, args, {}, branch ? `Rebased ${branch} onto ${o}` : `Rebased onto ${o}`)
}

async function logRange(runner: GitRunner, root: string, range: string): Promise<CompareResult['onlyA']> {
  const r = await runner.run(['log', '--date-order', `--format=${LOG_FORMAT}`, '-n', '1000', '--end-of-options', range, '--'], { cwd: root })
  return takeLogRecords(r.stdout, true).records.map((c) => ({ ...c, onCurrentBranch: false }))
}

export async function compare(runner: GitRunner, root: string, a: string, b: string): Promise<CompareResult> {
  const ra = assertName(a, 'revision')
  const rb = assertName(b, 'revision')
  const [onlyA, onlyB, files, counts, base] = await Promise.all([
    logRange(runner, root, `${rb}..${ra}`),
    logRange(runner, root, `${ra}..${rb}`),
    changedFiles(runner, root, rb, ra),
    runner.run(['rev-list', '--left-right', '--count', '--end-of-options', `${ra}...${rb}`, '--'], { cwd: root }),
    runner.run(['merge-base', '--end-of-options', ra, rb], { cwd: root, okExitCodes: [0, 1] })
  ])
  const [countA = 0, countB = 0] = counts.stdout.trim().split(/\s+/).map(Number)
  return { onlyA, onlyB, countA, countB, mergeBase: base.stdout.trim() || null, files }
}

// ---------------------------------------------------------------------------
// Network: fetch / pull / push
// ---------------------------------------------------------------------------

export async function fetch(runner: GitRunner, root: string, remote: string | null, prune: boolean, signal?: AbortSignal, progress?: Progress): Promise<void> {
  const args = ['fetch', '--progress']
  if (prune) args.push('--prune')
  if (remote) args.push(assertName(remote, 'remote'))
  else args.push('--all')
  await runner.run(args, { cwd: root, signal, onStderrLine: (l) => progress?.(l, progressPercent(l)) })
}

export async function pull(runner: GitRunner, root: string, mode: PullMode, signal?: AbortSignal, progress?: Progress): Promise<OpOutcome> {
  await createBackup(runner, root, 'pull')
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase'
  return runMayConflict(
    runner,
    root,
    ['pull', '--progress', flag],
    { signal, onStderrLine: (l) => progress?.(l, progressPercent(l)) },
    'Pulled'
  )
}

export async function push(runner: GitRunner, root: string, o: PushOptions, signal?: AbortSignal, progress?: Progress): Promise<void> {
  const args = ['push', '--progress', '--porcelain']
  if (o.setUpstream) args.push('--set-upstream')
  // Only --force-with-lease is ever used: it refuses to overwrite commits we have not seen.
  if (o.forceWithLease) args.push('--force-with-lease')
  if (o.tags) args.push('--follow-tags')
  args.push(assertName(o.remote, 'remote'), `refs/heads/${assertName(o.branch, 'branch')}:refs/heads/${assertName(o.remoteBranch, 'branch')}`)
  await runner.run(args, { cwd: root, signal, onStderrLine: (l) => progress?.(l, progressPercent(l)) })
}

export async function listRemotes(runner: GitRunner, root: string): Promise<Remote[]> {
  const names = (await runner.run(['remote'], { cwd: root })).stdout.split('\n').filter(Boolean)
  const cfg = await runner.run(['config', '-z', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'], { cwd: root, okExitCodes: [0, 1] })
  const urls = new Map<string, { url?: string; push?: string }>()
  for (const entry of cfg.stdout.split('\0')) {
    if (!entry) continue
    const nl = entry.indexOf('\n')
    const key = entry.slice(0, nl)
    const value = entry.slice(nl + 1)
    const m = /^remote\.(.+)\.(url|pushurl)$/.exec(key)
    if (!m) continue
    const e = urls.get(m[1]!) ?? {}
    if (m[2] === 'url') e.url = value
    else e.push = value
    urls.set(m[1]!, e)
  }
  return names.map((name) => {
    const u = urls.get(name) ?? {}
    return { name, fetchUrl: u.url ?? '', pushUrl: u.push ?? u.url ?? '' }
  })
}

/** Branches from the HEAD reflog ("checkout: moving from A to B"), most recent first. */
export async function recentBranches(runner: GitRunner, root: string, limit = 8): Promise<string[]> {
  const r = await runner.run(['reflog', 'show', '--format=%gs', '-n', '500', 'HEAD', '--'], { cwd: root, okExitCodes: [0, 128] })
  const out: string[] = []
  for (const line of r.stdout.split('\n')) {
    const m = /^checkout: moving from .+ to (.+)$/.exec(line)
    const name = m?.[1]
    if (name && !/^[0-9a-f]{7,64}$/.test(name) && !out.includes(name)) out.push(name)
    if (out.length >= limit) break
  }
  return out
}

/** Creates local `localName` tracking `remoteBranch` if it does not exist yet. */
export async function ensureTrackingBranch(runner: GitRunner, root: string, remoteBranch: string, localName: string): Promise<void> {
  const local = assertName(localName, 'branch')
  const exists = await runner.run(['show-ref', '--verify', '--quiet', `refs/heads/${local}`], { cwd: root, okExitCodes: [0, 1] })
  if (exists.exitCode !== 0) await runner.run(['branch', '--track', local, assertName(remoteBranch, 'branch')], { cwd: root })
}

/**
 * Commits `branch` would push to `remote/remoteBranch`. Without that remote
 * branch: everything not on any branch of that remote.
 */
export async function outgoing(runner: GitRunner, root: string, branch: string, remote: string, remoteBranch: string): Promise<CompareResult['onlyA']> {
  const b = assertName(branch, 'branch')
  const target = `refs/remotes/${assertName(remote, 'remote')}/${assertName(remoteBranch, 'branch')}`
  const exists = await runner.run(['show-ref', '--verify', '--quiet', target], { cwd: root, okExitCodes: [0, 1] })
  const args = ['log', '--date-order', `--format=${LOG_FORMAT}`, '-n', '500', '--end-of-options']
  if (exists.exitCode === 0) args.push(`${target}..refs/heads/${b}`)
  else args.push(`refs/heads/${b}`, '--not', `--remotes=${remote}`)
  const r = await runner.run([...args, '--'], { cwd: root })
  return takeLogRecords(r.stdout, true).records.map((c) => ({ ...c, onCurrentBranch: true }))
}

/** Deletes several branches on one remote with a single push. */
export async function deleteRemoteBranches(runner: GitRunner, root: string, remote: string, branches: string[], progress?: Progress): Promise<void> {
  if (branches.length === 0) return
  await runner.run(['push', '--progress', assertName(remote, 'remote'), '--delete', ...branches.map((b) => `refs/heads/${assertName(b, 'branch')}`)], {
    cwd: root,
    onStderrLine: (l) => progress?.(l, progressPercent(l))
  })
}
