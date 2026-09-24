import type { FileChange, OpOutcome, StashEntry } from '@shared/types'
import { runMayConflict } from './branches'
import { AppError } from './errors'
import { changedFiles } from './repoData'
import type { GitRunner } from './runner'

const ref = (index: number) => {
  if (!Number.isInteger(index) || index < 0) throw new AppError('Invalid stash index', 'INVALID_ARGUMENT')
  return `stash@{${index}}`
}

export async function listStashes(runner: GitRunner, root: string): Promise<StashEntry[]> {
  const r = await runner.run(['stash', 'list', '--format=%gd%x00%H%x00%ct%x00%gs'], { cwd: root })
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [gd = '', hash = '', ct = '0', gs = ''] = l.split('\0')
      return { index: Number(/\{(\d+)\}/.exec(gd)?.[1] ?? 0), ref: gd, hash, time: Number(ct), message: gs }
    })
}

/** Files of a stash: tracked changes vs its base, plus untracked files (stash^3) if any. */
export async function stashFiles(runner: GitRunner, root: string, index: number): Promise<{ files: FileChange[]; untracked: FileChange[]; base: string; hash: string; untrackedCommit: string | null }> {
  const r = ref(index)
  const [hash, base, u] = await Promise.all([
    runner.run(['rev-parse', r], { cwd: root }),
    runner.run(['rev-parse', `${r}^1`], { cwd: root }),
    runner.run(['rev-parse', '-q', '--verify', `${r}^3`], { cwd: root, okExitCodes: [0, 1] })
  ])
  const h = hash.stdout.trim()
  const b = base.stdout.trim()
  const uc = u.exitCode === 0 ? u.stdout.trim() : null
  return {
    hash: h,
    base: b,
    untrackedCommit: uc,
    files: await changedFiles(runner, root, b, h),
    untracked: uc ? await changedFiles(runner, root, null, uc) : []
  }
}

export async function stashPush(runner: GitRunner, root: string, message: string, includeUntracked: boolean, keepIndex: boolean): Promise<void> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('--include-untracked')
  if (keepIndex) args.push('--keep-index')
  if (message.trim()) args.push('-m', message.trim())
  const before = (await listStashes(runner, root))[0]?.hash
  await runner.run(args, { cwd: root })
  if ((await listStashes(runner, root))[0]?.hash === before) throw new AppError('There were no local changes to stash.', 'INVALID_ARGUMENT')
}

export function stashApply(runner: GitRunner, root: string, index: number, reinstateIndex: boolean): Promise<OpOutcome> {
  return runMayConflict(runner, root, ['stash', 'apply', ...(reinstateIndex ? ['--index'] : []), ref(index)], {}, `Applied ${ref(index)}`)
}

export async function stashPop(runner: GitRunner, root: string, index: number, reinstateIndex: boolean): Promise<OpOutcome> {
  const out = await runMayConflict(runner, root, ['stash', 'pop', ...(reinstateIndex ? ['--index'] : []), ref(index)], {}, `Popped ${ref(index)}`)
  if (out.status === 'conflicts') return { ...out, message: 'The stash applied with conflicts and was kept. Resolve them, then drop it.' }
  return out
}

export async function stashDrop(runner: GitRunner, root: string, index: number): Promise<void> {
  await runner.run(['stash', 'drop', ref(index)], { cwd: root })
}

export async function stashBranch(runner: GitRunner, root: string, name: string, index: number): Promise<void> {
  if (!name.trim() || name.startsWith('-')) throw new AppError('Invalid branch name', 'INVALID_ARGUMENT')
  await runner.run(['stash', 'branch', name.trim(), ref(index)], { cwd: root })
}
