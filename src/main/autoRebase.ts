import type { AutoRebaseResult, OpOutcome } from '@shared/types'
import { rebase } from './git/branches'
import { AppError } from './git/errors'
import type { GitRunner } from './git/runner'
import { continueOperation, operationState, skipOperation } from './git/sequencer'
import { resolveConflictsAuto, type ResolveConflictsDeps } from './resolveConflicts'

export interface AutoRebaseOptions {
  signal?: AbortSignal
  progress?: (message: string) => void
  /** Per-file AI timeout (tests). */
  aiTimeoutMs?: number
}

/** Upper bound on loop turns: every turn advances the rebase by one step, so this only stops a stuck loop. */
const MAX_TURNS = 10_000

/**
 * Continue after the step's conflicts were resolved. Older git refuses to
 * continue when the resolution left nothing to commit (the change is already
 * upstream); that step is skipped, as newer git does on its own.
 */
async function continueStep(runner: GitRunner, root: string): Promise<OpOutcome> {
  try {
    return await continueOperation(runner, root)
  } catch (err) {
    const st = await operationState(runner, root)
    if (st.operation !== 'rebase' || st.conflicted.length > 0) throw err
    const staged = await runner.run(['diff', '--cached', '--quiet'], { cwd: root, okExitCodes: [0, 1] })
    if (staged.exitCode !== 0) throw err
    return skipOperation(runner, root)
  }
}

/**
 * Rebase that resolves its own conflicts: starts `git rebase onto [branch]`
 * (backup ref first), or resumes the rebase in progress when `onto` is null,
 * then for every step that stops on conflicts runs Resolve with AI's rules
 * (Markdown keeps both sides, other text files go to the AI CLI) and continues.
 * Anything it cannot resolve, a stop without conflicts (edit / exec) or a
 * cancel leaves the rebase open for the user, with the resolved files staged.
 */
export async function autoRebase(
  deps: ResolveConflictsDeps,
  root: string,
  onto: string | null,
  branch: string | null,
  opts: AutoRebaseOptions = {}
): Promise<AutoRebaseResult> {
  const { runner } = deps
  const step = (message: string) => opts.progress?.(message)
  const checkCancel = () => {
    if (opts.signal?.aborted) throw new AppError('Operation cancelled', 'CANCELLED')
  }
  const union = new Set<string>()
  const ai = new Set<string>()
  let resolvedSteps = 0
  const result = (status: AutoRebaseResult['status'], message: string, left: Pick<AutoRebaseResult, 'unresolved' | 'reasons'> = { unresolved: [], reasons: [] }): AutoRebaseResult => ({
    status,
    message,
    started: onto !== null,
    resolvedSteps,
    unionResolved: [...union],
    aiResolved: [...ai],
    ...left
  })

  const before = await operationState(runner, root)
  if (onto !== null) {
    if (before.operation || before.conflicted.length > 0) {
      throw new AppError(`${before.title || 'An operation with conflicts'} is in progress. Finish or abort it first.`, 'DIRTY')
    }
    step(`Rebasing ${branch ?? 'the current branch'} onto ${onto}…`)
    const out = await rebase(runner, root, onto, branch ?? undefined)
    if (out.status === 'ok') return result('done', out.message)
  } else if (before.operation !== 'rebase') {
    throw new AppError('No rebase in progress.', 'INVALID_ARGUMENT')
  }

  let headName = before.headName ?? branch
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    checkCancel()
    const st = await operationState(runner, root)
    if (st.operation !== 'rebase') return result('done', `Rebase of ${headName ?? 'HEAD'} finished`)
    headName = st.headName ?? headName
    const where = `${st.step && st.total ? `Step ${st.step}/${st.total}` : 'Rebase'}${st.currentSubject ? ` “${st.currentSubject}”` : ''}`
    if (st.conflicted.length > 0) {
      const res = await resolveConflictsAuto(deps, root, { signal: opts.signal, progress: (m) => step(`${where}: ${m}`), aiTimeoutMs: opts.aiTimeoutMs })
      for (const p of res.unionResolved) union.add(p)
      for (const p of res.aiResolved) ai.add(p)
      if (res.unresolved.length > 0) {
        const n = res.unresolved.length
        return result('stopped', `${st.title}: ${where} has ${n} conflict${n === 1 ? '' : 's'} that could not be resolved automatically.`, {
          unresolved: res.unresolved,
          reasons: res.reasons
        })
      }
      resolvedSteps++
    }
    checkCancel()
    step(`${where}: continuing…`)
    const out = await continueStep(runner, root)
    // A stop without conflicts (edit, break, failed exec) waits for the user.
    if (out.status === 'stopped') return result('stopped', out.message)
  }
  throw new AppError('The rebase did not advance.', 'GIT_FAILED')
}
