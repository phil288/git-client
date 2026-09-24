import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CloneRequest, InProgressOp, RepoInfo, RepoQuickStatus, RepoResolution } from '@shared/types'
import { normalizeRepoPath } from '../paths'
import { AppError } from './errors'
import { parseCloneProgress, parseStatusV2, type CloneProgress } from './parsers'
import type { GitRunner } from './runner'

/** Limits concurrent background commands (e.g. status for 50 recent repos). */
class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private readonly max: number) {}

  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

function isNotARepoError(err: unknown): boolean {
  return err instanceof AppError && err.code === 'GIT_FAILED' && /not a git repository/i.test(err.extra.stderr ?? '')
}

/** Reads in-progress operation markers from a (per-worktree) git dir. */
export function detectInProgress(gitDir: string): InProgressOp[] {
  const ops: InProgressOp[] = []
  const has = (name: string): boolean => existsSync(join(gitDir, name))
  // Note: modern git writes rebase-merge/interactive for plain rebases too
  // (the merge backend runs through the sequencer), so we don't distinguish.
  if (has('rebase-merge')) ops.push('rebase')
  if (has('rebase-apply')) ops.push(has(join('rebase-apply', 'applying')) ? 'am' : 'rebase')
  if (has('MERGE_HEAD')) ops.push('merge')
  if (has('CHERRY_PICK_HEAD')) ops.push('cherry-pick')
  if (has('REVERT_HEAD')) ops.push('revert')
  if (has('BISECT_LOG')) ops.push('bisect')
  return ops
}

/**
 * Owns every git invocation. Stateless apart from the runner; each method
 * takes the repository path explicitly so one service serves all tabs.
 */
export class GitService {
  private readonly statusLimiter = new Semaphore(4)

  constructor(readonly runner: GitRunner) {}

  /** Maps any folder (or file) path to its repository root, if any. */
  async resolve(inputPath: string): Promise<RepoResolution> {
    const abs = resolve(inputPath)
    if (!existsSync(abs)) return { kind: 'missing', path: abs }
    const dir = statSync(abs).isDirectory() ? abs : dirname(abs)

    let bare: string
    let insideGitDir: string
    try {
      const r = await this.runner.run(['rev-parse', '--is-bare-repository', '--is-inside-git-dir'], { cwd: dir })
      ;[bare = '', insideGitDir = ''] = r.stdout.trim().split('\n')
    } catch (err) {
      if (isNotARepoError(err)) return { kind: 'not-repo', path: normalizeRepoPath(dir) }
      throw err
    }
    if (bare.trim() === 'true') return { kind: 'bare', path: normalizeRepoPath(dir) }
    if (insideGitDir.trim() === 'true') {
      // Opened ".git" (or something inside it): use the working tree that owns it.
      const r = await this.runner.run(['rev-parse', '--absolute-git-dir'], { cwd: dir })
      const gitDir = r.stdout.trim()
      if (basename(gitDir) === '.git') return this.resolve(dirname(gitDir))
      return { kind: 'not-repo', path: normalizeRepoPath(dir) }
    }
    const top = await this.runner.run(['rev-parse', '--show-toplevel'], { cwd: dir })
    return { kind: 'repo', root: normalizeRepoPath(top.stdout.trim()) }
  }

  async info(root: string): Promise<RepoInfo> {
    const [dirs, superproject, symref, head] = await Promise.all([
      this.runner.run(['rev-parse', '--absolute-git-dir', '--git-common-dir'], { cwd: root }),
      this.runner.run(['rev-parse', '--show-superproject-working-tree'], { cwd: root }),
      this.runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] }),
      this.runner.run(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { cwd: root, okExitCodes: [0, 1] })
    ])
    const [gitDirRaw = '', commonRaw = ''] = dirs.stdout.trim().split('\n')
    const gitDir = normalizeRepoPath(gitDirRaw.trim())
    const commonDir = normalizeRepoPath(isAbsolute(commonRaw.trim()) ? commonRaw.trim() : resolve(root, commonRaw.trim()))
    const branch = symref.exitCode === 0 ? symref.stdout.trim() || null : null
    const headSha = head.exitCode === 0 ? head.stdout.trim() || null : null
    const sp = superproject.stdout.trim()

    return {
      root,
      name: basename(root),
      gitDir,
      commonDir,
      isLinkedWorktree: gitDir !== commonDir,
      superproject: sp ? normalizeRepoPath(sp) : null,
      branch,
      headSha,
      detached: branch === null && headSha !== null,
      unborn: headSha === null,
      inProgress: detectInProgress(gitDir)
    }
  }

  /** Cheap status for the recents list: branch, ahead/behind, dirty. */
  async quickStatus(path: string): Promise<RepoQuickStatus> {
    const base: RepoQuickStatus = {
      path,
      exists: existsSync(path),
      isRepo: false,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      changedCount: 0
    }
    if (!base.exists) return base
    return this.statusLimiter.use(async () => {
      try {
        const r = await this.runner.run(
          ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'],
          { cwd: path }
        )
        const s = parseStatusV2(r.stdout)
        return {
          ...base,
          isRepo: true,
          branch: s.branch,
          detached: s.detached,
          upstream: s.upstream,
          ahead: s.ahead,
          behind: s.behind,
          dirty: s.changedCount > 0,
          changedCount: s.changedCount
        }
      } catch (err) {
        if (isNotARepoError(err)) return base
        throw err
      }
    })
  }

  /** `git init` in an existing folder. */
  async init(path: string): Promise<RepoResolution> {
    const abs = resolve(path)
    if (!existsSync(abs)) throw new AppError(`Folder does not exist: ${abs}`, 'PATH_MISSING')
    await this.runner.run(['init'], { cwd: abs })
    return this.resolve(abs)
  }

  /** `git clone --progress`. Resolves with the normalised repo root. */
  async clone(req: CloneRequest, signal: AbortSignal, onProgress: (p: CloneProgress & { line: string }) => void): Promise<string> {
    const url = req.url.trim()
    const branch = req.branch?.trim() ?? ''
    if (url === '' || url.startsWith('-')) throw new AppError('Invalid repository URL', 'INVALID_ARGUMENT')
    if (branch.startsWith('-')) throw new AppError('Invalid branch name', 'INVALID_ARGUMENT')
    const dest = resolve(req.destination)
    const parent = dirname(dest)
    if (!existsSync(parent)) throw new AppError(`Parent folder does not exist: ${parent}`, 'PATH_MISSING')
    if (existsSync(dest) && readdirSync(dest).length > 0) {
      throw new AppError(`Destination already exists and is not empty: ${dest}`, 'ALREADY_EXISTS')
    }
    const args = ['clone', '--progress']
    if (branch) args.push('--branch', branch)
    args.push('--', url, dest)
    await this.runner.run(args, {
      cwd: parent,
      signal,
      onStderrLine: (line) => {
        const p = parseCloneProgress(line)
        onProgress({ phase: p?.phase ?? line, percent: p?.percent ?? null, line })
      }
    })
    return normalizeRepoPath(dest)
  }
}
