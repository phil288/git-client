import type { AiResolveResult, AiToolInfo, AutoMergeResult, Settings } from '@shared/types'
import { generateCommitMessage } from './ai/commitMessage'
import { pickTool, type PickedTool } from './ai/pickTool'
import { deleteBranch } from './git/branches'
import { AppError } from './git/errors'
import type { GitRunner } from './git/runner'
import { continueOperation, operationState } from './git/sequencer'
import { commit, stageFiles, workingStatus } from './git/workingTree'
import { defaultBranch, listWorktrees, mergePlan, mergeRefInto, pendingMerges, removeWorktree } from './git/worktrees'
import { normalizeRepoPath, samePath } from './paths'
import { resolveConflictsAuto } from './resolveConflicts'

export interface AutoMergeDeps {
  runner: GitRunner
  settings: () => Settings
  detectTools: () => AiToolInfo[]
  /** Style hints for the commit message (repo prefs). */
  recentMessages?: (root: string) => readonly string[]
  /** Called after the worktree's changes were committed (records the message in repo prefs). */
  onCommitted?: (root: string, message: string) => void
}

export interface AutoMergeOptions {
  signal?: AbortSignal
  /** step is 1-based, see AUTO_MERGE_STEPS. */
  progress?: (step: number, message: string) => void
  /** Per-file AI timeout (tests). */
  aiTimeoutMs?: number
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One-click merge of a linked worktree into the default branch:
 *   1. commit everything in the worktree with an AI-generated message,
 *   2. stop ('blocked') when the target's worktree is not clean,
 *   3. merge (in the worktree where the target is checked out; backup ref first),
 *   4. resolve conflicts: Markdown keeps both sides, the rest goes to the AI CLI,
 *   5. commit the merge,
 *   6. remove the worktree (git deletes the folder) and safe-delete its branch.
 * Re-running after 'blocked' / 'stopped' continues where it stopped: a clean
 * worktree skips 1, an open merge of this branch resumes at 4, nothing left to
 * merge goes straight to 6. Any AI failure leaves the merge open ('stopped').
 */
export async function autoMergeWorktree(deps: AutoMergeDeps, root: string, path: string, opts: AutoMergeOptions = {}): Promise<AutoMergeResult> {
  const { runner } = deps
  const step = (n: number, message: string) => opts.progress?.(n, message)
  const checkCancel = () => {
    if (opts.signal?.aborted) throw new AppError('Operation cancelled', 'CANCELLED')
  }

  // 0. Preflight: nothing is changed until every check passed.
  const list = await listWorktrees(runner, root)
  const w = list.find((x) => samePath(x.path, normalizeRepoPath(path)))
  if (!w) throw new AppError(`${path} is not a worktree of this repository.`, 'INVALID_ARGUMENT')
  if (w.isMain || w.bare) throw new AppError('Auto Merge works on linked worktrees, not on the main one.', 'INVALID_ARGUMENT')
  if (w.prunable) throw new AppError(`The folder of this worktree is missing: ${w.path}`, 'INVALID_ARGUMENT')
  if (w.locked) throw new AppError('The worktree is locked. Unlock it first.', 'LOCKED')
  const branch = w.branch
  if (!branch) throw new AppError('The worktree has no branch checked out (detached HEAD).', 'INVALID_ARGUMENT')
  const target = await defaultBranch(runner, w.path)
  if (!target) throw new AppError('No default branch found (origin/HEAD, main or master).', 'INVALID_ARGUMENT')
  if (target === branch) throw new AppError(`The worktree is on ${target} itself.`, 'INVALID_ARGUMENT')
  const own = await operationState(runner, w.path)
  if (own.operation || own.conflicted.length > 0) {
    throw new AppError(`${own.title || 'An operation with conflicts'} is in progress in the worktree. Finish or abort it first.`, 'DIRTY')
  }
  const mainPath = list.find((x) => x.isMain && !x.bare)?.path ?? root
  const settings = deps.settings()
  const toolFor = (setting: Settings['aiCommitTool']): PickedTool & { model?: string } => {
    const t = pickTool(setting, deps.detectTools())
    return { ...t, model: settings.aiModels?.[t.id] }
  }

  let plan = await mergePlan(runner, w.path, `refs/heads/${branch}`, target)
  // An earlier run stopped on conflicts (or the user is midway): resume, don't merge again.
  const resumeIn = plan.host ? (await pendingMerges(runner, root)).find((m) => samePath(m.path, plan.host!) && m.branches.includes(branch)) : undefined

  let committed: string | null = null
  if (!resumeIn) {
    // 1. Commit the worktree's changes.
    const st = await workingStatus(runner, w.path)
    if (st.entries.length > 0) {
      step(1, `Committing ${st.entries.length} change${st.entries.length === 1 ? '' : 's'} in ${branch}…`)
      const tool = toolFor(settings.aiCommitTool)
      await stageFiles(runner, w.path, st.entries.map((e) => e.path))
      const { message } = await generateCommitMessage(runner, w.path, tool, {
        amend: false,
        signal: opts.signal,
        recentMessages: deps.recentMessages?.(w.path),
        instructions: settings.aiCommitInstructions,
        onProgress: (m) => step(1, m)
      })
      checkCancel()
      committed = await commit(runner, w.path, message, { amend: false, signOff: false })
      deps.onCommitted?.(w.path, message)
      plan = await mergePlan(runner, w.path, `refs/heads/${branch}`, target)
    }

    // 2. The target's worktree must be clean: never mix a merge with someone's work in progress.
    if (plan.host) {
      step(2, `Checking ${target} in ${plan.host}…`)
      const hs = await workingStatus(runner, plan.host)
      const ho = await operationState(runner, plan.host)
      if (hs.entries.length > 0 || ho.operation) {
        const dirty = hs.entries.map((e) => e.path)
        return { status: 'blocked', target, host: plan.host, dirty: dirty.length ? dirty : [ho.title || 'Operation in progress'], committed }
      }
    }
    checkCancel()
  }

  let mergedIn: string | null = resumeIn?.path ?? null
  let merged = plan.ahead
  let resolved: Pick<AiResolveResult, 'unionResolved' | 'aiResolved'> = { unionResolved: [], aiResolved: [] }

  if (!resumeIn && plan.ahead > 0) {
    // 3. Merge (mergeRefInto writes the backup ref in the host first).
    step(3, `Merging ${branch} into ${target}…`)
    const res = await mergeRefInto(runner, w.path, `refs/heads/${branch}`, target, 'default')
    mergedIn = res.mergedIn
    merged = res.merged
  }

  const host = mergedIn
  if (host && (resumeIn || (await operationState(runner, host)).operation === 'merge')) {
    // 4. Resolve conflicts (shared with the conflict tool's "Resolve with AI").
    const res = await resolveConflictsAuto(deps, host, {
      signal: opts.signal,
      progress: (m) => step(4, m),
      oursLabel: target,
      theirsLabel: branch,
      aiTimeoutMs: opts.aiTimeoutMs
    })
    const { unresolved, reasons, unionResolved, aiResolved } = res
    resolved = { unionResolved, aiResolved }
    if (unresolved.length > 0) {
      const message = `The merge of ${branch} into ${target} is open in ${host}: ${unresolved.length} conflict${unresolved.length === 1 ? '' : 's'} could not be resolved automatically.\n${reasons.join('\n')}`
      return { status: 'stopped', target, host, message, unresolved, unionResolved, aiResolved, committed }
    }

    // 5. Commit the merge with git's default message.
    checkCancel()
    step(5, `Committing the merge into ${target}…`)
    await continueOperation(runner, host)
  }

  // 6. Cleanup. The merge is done: problems here are warnings, never a failure.
  step(6, `Removing worktree ${w.path}…`)
  let worktreeRemoved = false
  let branchDeleted = false
  let warning: string | undefined
  const base = host ?? plan.host ?? mainPath
  try {
    // No force: uncommitted work is never discarded.
    await removeWorktree(runner, base, w.path, 0)
    worktreeRemoved = true
  } catch (e) {
    warning = `Merged, but the worktree was kept: ${errMessage(e)}`
  }
  if (worktreeRemoved) {
    try {
      await deleteBranch(runner, base, branch, false)
      branchDeleted = true
    } catch (e) {
      warning = `Merged and removed the worktree, but ${branch} was not deleted: ${errMessage(e)}`
    }
  }
  return { status: 'done', target, mergedIn: host, committed, merged, ...resolved, worktreeRemoved, branchDeleted, warning }
}

