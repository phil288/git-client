import type { BackupEntry } from '@shared/types'
import type { GitRunner } from './runner'

/**
 * Before anything that rewrites history (rebase, reword, squash, reset, merge)
 * the current HEAD is saved as refs/gitclient-backup/<branch>/<unix-ms>-<op>,
 * so "Undo last operation" can always go back. The newest 20 per branch are kept.
 */
export const BACKUP_PREFIX = 'refs/gitclient-backup/'
const KEEP_PER_BRANCH = 20

async function currentBranch(runner: GitRunner, root: string): Promise<string> {
  const r = await runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] })
  return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : 'detached'
}

/** Backs up HEAD, or the given local branch when an operation targets another branch. */
export async function createBackup(runner: GitRunner, root: string, operation: string, targetBranch?: string): Promise<BackupEntry | null> {
  const rev = targetBranch ? `refs/heads/${targetBranch}` : 'HEAD'
  const head = await runner.run(['rev-parse', '-q', '--verify', `${rev}^{commit}`], { cwd: root, okExitCodes: [0, 1] })
  if (head.exitCode !== 0) return null // unborn: nothing to back up
  const hash = head.stdout.trim()
  const branch = targetBranch ?? (await currentBranch(runner, root))
  const op = operation.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const time = Date.now()
  const ref = `${BACKUP_PREFIX}${branch}/${time}-${op}`
  await runner.run(['update-ref', ref, hash], { cwd: root })
  await prune(runner, root, branch)
  return { ref, branch, hash, time, operation: op }
}

export async function listBackups(runner: GitRunner, root: string): Promise<BackupEntry[]> {
  const r = await runner.run(['for-each-ref', '--format=%(refname)%00%(objectname)', BACKUP_PREFIX], { cwd: root })
  const out: BackupEntry[] = []
  for (const line of r.stdout.split('\n')) {
    const [ref = '', hash = ''] = line.split('\0')
    const m = /^refs\/gitclient-backup\/(.+)\/(\d+)-([a-z0-9-]+)$/.exec(ref)
    if (m) out.push({ ref, branch: m[1]!, time: Number(m[2]), operation: m[3]!, hash })
  }
  return out.sort((a, b) => b.time - a.time)
}

async function prune(runner: GitRunner, root: string, branch: string): Promise<void> {
  const mine = (await listBackups(runner, root)).filter((b) => b.branch === branch)
  for (const old of mine.slice(KEEP_PER_BRANCH)) await runner.run(['update-ref', '-d', old.ref], { cwd: root })
}

export async function deleteBackup(runner: GitRunner, root: string, ref: string): Promise<void> {
  if (!ref.startsWith(BACKUP_PREFIX)) throw new Error('Not a backup ref')
  await runner.run(['update-ref', '-d', ref], { cwd: root })
}
