import type { DiffHunk, FileHunks, WorkingStatus } from '@shared/types'
import { editorEnv } from './editors'
import { AppError } from './errors'
import { buildPatch, parseStatusFull, parseUnifiedDiff } from './parsers'
import type { GitRunner } from './runner'

/** Working tree + index status. `--no-optional-locks` keeps it from taking index.lock. */
export async function workingStatus(runner: GitRunner, root: string): Promise<WorkingStatus> {
  const r = await runner.run(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { cwd: root, quiet: true })
  return parseStatusFull(r.stdout)
}

function checkPaths(paths: string[]): string[] {
  if (paths.length === 0) throw new AppError('No files selected', 'INVALID_ARGUMENT')
  for (const p of paths) if (p.includes('\0') || p === '') throw new AppError('Invalid path', 'INVALID_ARGUMENT')
  return paths
}

/** Paths go through stdin (NUL-separated): no argv length limits, no option injection. */
function pathspecArgs(): string[] {
  return ['--pathspec-from-file=-', '--pathspec-file-nul']
}
const pathInput = (paths: string[]) => paths.join('\0') + '\0'

function chunks<T>(list: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function headExists(runner: GitRunner, root: string): Promise<boolean> {
  const r = await runner.run(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { cwd: root, okExitCodes: [0, 1] })
  return r.exitCode === 0
}

const DIFF_ARGS = ['--no-color', '--no-ext-diff', '--no-renames', '-U3', '--src-prefix=a/', '--dst-prefix=b/']

/** Staged (HEAD→index) and unstaged (index→worktree) hunks of one file. */
export async function fileHunks(runner: GitRunner, root: string, path: string): Promise<FileHunks> {
  checkPaths([path])
  const [staged, unstaged] = await Promise.all([
    runner.run(['diff', '--cached', ...DIFF_ARGS, '--', path], { cwd: root, quiet: true }),
    runner.run(['diff', ...DIFF_ARGS, '--', path], { cwd: root, quiet: true })
  ])
  const s = parseUnifiedDiff(staged.stdout)
  const u = parseUnifiedDiff(unstaged.stdout)
  const tag = (src: 'staged' | 'unstaged', hunks: typeof s.hunks): DiffHunk[] => hunks.map((h, i) => ({ ...h, source: src, id: `${src}:${i}` }))
  return {
    path,
    binary: s.binary || u.binary,
    staged: tag('staged', s.hunks),
    unstaged: tag('unstaged', u.hunks),
    headers: { staged: s.header, unstaged: u.header }
  }
}

export async function stageFiles(runner: GitRunner, root: string, paths: string[]): Promise<void> {
  checkPaths(paths)
  // Skip paths with nothing left to stage: a fully staged deletion (`D.`) is in
  // neither the index nor the worktree, so `git add` fails with "pathspec did not
  // match any files" and aborts the whole batch.
  const st = await workingStatus(runner, root)
  const stageable = new Set(st.entries.filter((e) => e.untracked || e.conflicted || e.worktree !== '.').map((e) => e.path))
  const todo = paths.filter((p) => stageable.has(p))
  if (todo.length === 0) return
  // -A: also stages deletions of the given paths.
  await runner.run(['add', '-A', ...pathspecArgs()], { cwd: root, input: pathInput(todo) })
}

export async function unstageFiles(runner: GitRunner, root: string, paths: string[]): Promise<void> {
  checkPaths(paths)
  if (await headExists(runner, root)) {
    await runner.run(['restore', '--staged', ...pathspecArgs()], { cwd: root, input: pathInput(paths) })
  } else {
    // No commit yet: "unstage" means removing from the index.
    await runner.run(['rm', '--cached', '-r', '-q', '--ignore-unmatch', ...pathspecArgs()], { cwd: root, input: pathInput(paths) })
  }
}

/**
 * Rolls files back to HEAD (index and working tree). Untracked files are
 * deleted; files that are only added are removed. The UI confirms first.
 */
export async function discardFiles(runner: GitRunner, root: string, paths: string[]): Promise<void> {
  checkPaths(paths)
  const st = await workingStatus(runner, root)
  const byPath = new Map(st.entries.map((e) => [e.path, e]))
  const untracked: string[] = []
  const added: string[] = []
  const tracked: string[] = []
  for (const p of paths) {
    const e = byPath.get(p)
    if (!e) continue
    if (e.untracked) untracked.push(p)
    else if (e.index === 'A') added.push(p)
    else {
      tracked.push(p)
      if (e.origPath) tracked.push(e.origPath)
    }
  }
  // clean / rm have no --pathspec-from-file: pass paths after `--`, in batches (Windows argv limit).
  for (const batch of chunks(untracked)) await runner.run(['clean', '-f', '-q', '--', ...batch], { cwd: root })
  for (const batch of chunks(added)) await runner.run(['rm', '-f', '-q', '-r', '--', ...batch], { cwd: root })
  if (tracked.length) await runner.run(['restore', '--source=HEAD', '--staged', '--worktree', ...pathspecArgs()], { cwd: root, input: pathInput(tracked) })
}

async function applyHunks(runner: GitRunner, root: string, path: string, source: 'staged' | 'unstaged', ids: string[], mode: 'stage' | 'unstage' | 'discard'): Promise<void> {
  const fh = await fileHunks(runner, root, path)
  const pool = source === 'staged' ? fh.staged : fh.unstaged
  const chosen = pool.filter((h) => ids.includes(h.id))
  if (chosen.length === 0) throw new AppError('The file changed; refresh and try again.', 'INVALID_ARGUMENT')
  const patch = buildPatch(source === 'staged' ? fh.headers.staged : fh.headers.unstaged, chosen)
  const args = ['apply', '--recount', '--whitespace=nowarn']
  if (mode !== 'discard') args.push('--cached')
  if (mode !== 'stage') args.push('--reverse')
  args.push('-')
  await runner.run(args, { cwd: root, input: patch })
}

/** Partial staging: apply selected unstaged hunks to the index. */
export const stageHunks = (runner: GitRunner, root: string, path: string, ids: string[]) => applyHunks(runner, root, path, 'unstaged', ids, 'stage')
/** Remove selected staged hunks from the index. */
export const unstageHunks = (runner: GitRunner, root: string, path: string, ids: string[]) => applyHunks(runner, root, path, 'staged', ids, 'unstage')
/** Revert selected unstaged hunks in the working tree (UI confirms). */
export const discardHunks = (runner: GitRunner, root: string, path: string, ids: string[]) => applyHunks(runner, root, path, 'unstaged', ids, 'discard')

export interface CommitOptions {
  amend: boolean
  signOff: boolean
}

/** Commits the index. The message goes through stdin (`-F -`). */
export async function commit(runner: GitRunner, root: string, message: string, o: CommitOptions): Promise<string> {
  if (!message.trim()) throw new AppError('The commit message is empty.', 'INVALID_ARGUMENT')
  const args = ['commit', '-F', '-']
  if (o.amend) args.push('--amend')
  if (o.signOff) args.push('--signoff')
  if (!o.amend) {
    const staged = await runner.run(['diff', '--cached', '--quiet'], { cwd: root, okExitCodes: [0, 1] })
    const head = await headExists(runner, root)
    if (staged.exitCode === 0 && head) throw new AppError('Nothing is staged. Tick the files (or hunks) to commit.', 'INVALID_ARGUMENT')
  }
  await runner.run(args, { cwd: root, input: message, env: editorEnv().base })
  return (await runner.run(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
}

export async function lastCommitMessage(runner: GitRunner, root: string): Promise<string> {
  const r = await runner.run(['log', '-1', '--format=%B', '--'], { cwd: root, okExitCodes: [0, 128] })
  return r.exitCode === 0 ? r.stdout.replace(/\n+$/, '') : ''
}
