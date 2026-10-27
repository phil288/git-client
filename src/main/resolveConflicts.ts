import { isMarkdownPath } from '@shared/autoMerge'
import { joinLines, splitLines } from '@shared/merge3'
import { unionMerge } from '@shared/mergeModel'
import type { AiResolveResult, AiToolInfo, Settings } from '@shared/types'
import { pickTool, type PickedTool } from './ai/pickTool'
import { resolveConflictWithAi } from './ai/resolveConflict'
import { acceptSide, conflictState, conflictVersions, resolveDelete, saveResolution } from './git/conflicts'
import { AppError } from './git/errors'
import type { GitRunner } from './git/runner'
import { operationState } from './git/sequencer'

export interface ResolveConflictsDeps {
  runner: GitRunner
  settings: () => Settings
  detectTools: () => AiToolInfo[]
}

export interface ResolveConflictsOptions {
  signal?: AbortSignal
  progress?: (message: string) => void
  /** Side names in the prompt's markers; default: the conflict state's Yours / Theirs names. */
  oursLabel?: string
  theirsLabel?: string
  /** Per-file AI timeout (tests). */
  aiTimeoutMs?: number
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Recent subjects of each side as intent hints: commit ranges for a merge, the replayed commit otherwise. */
async function sideSubjects(runner: GitRunner, root: string): Promise<{ ours: string[]; theirs: string[] }> {
  const op = await operationState(runner, root)
  if (op.operation === 'merge') {
    const subjects = async (range: string) =>
      (await runner.run(['log', '-10', '--no-merges', '--format=%s', range], { cwd: root, okExitCodes: [0, 128] })).stdout.split('\n').filter(Boolean)
    return { ours: await subjects('MERGE_HEAD..HEAD'), theirs: await subjects('HEAD..MERGE_HEAD') }
  }
  return { ours: [], theirs: op.currentSubject ? [op.currentSubject] : [] }
}

/**
 * The conflict step of Auto Merge, for any operation with conflicts (merge,
 * rebase, cherry-pick, revert, stash): Markdown keeps both sides, other text
 * conflicts go to the AI CLI, the rest is left for the user. Resolved files
 * are staged; the operation itself is never continued or aborted.
 */
export async function resolveConflictsAuto(deps: ResolveConflictsDeps, root: string, opts: ResolveConflictsOptions = {}): Promise<AiResolveResult> {
  const { runner } = deps
  const step = (message: string) => opts.progress?.(message)
  const checkCancel = () => {
    if (opts.signal?.aborted) throw new AppError('Operation cancelled', 'CANCELLED')
  }
  const unresolved: string[] = []
  const reasons: string[] = []
  const unionResolved: string[] = []
  const aiResolved: string[] = []
  const state = await conflictState(runner, root)
  const forAi: string[] = []
  if (state.files.length > 0) step(`Resolving ${state.files.length} conflict${state.files.length === 1 ? '' : 's'}…`)
  for (const f of state.files) {
    checkCancel()
    if (f.type === 'both-deleted') {
      await resolveDelete(runner, root, [f.path])
      continue
    }
    const md = isMarkdownPath(f.path)
    if (f.submodule || f.binary) {
      unresolved.push(f.path)
      reasons.push(`${f.path}: ${f.submodule ? 'submodule' : 'binary file'}`)
    } else if (f.type === 'content' || f.type === 'add-add') {
      if (!md) {
        forAi.push(f.path)
        continue
      }
      const v = await conflictVersions(runner, root, f.path)
      const lines = unionMerge(splitLines(v.base.text), splitLines(v.yours.text), splitLines(v.theirs.text))
      await saveResolution(runner, root, f.path, joinLines(lines, { eol: v.eol, finalNewline: v.finalNewline }), v.yours.exists ? v.yours.encoding : v.theirs.encoding)
      unionResolved.push(f.path)
    } else if (md) {
      // Deleted on one side, changed or renamed on the other: keep the side that still has the file.
      await acceptSide(runner, root, [f.path], f.yours === 'deleted' ? 'theirs' : 'yours')
      unionResolved.push(f.path)
    } else {
      unresolved.push(f.path)
      reasons.push(`${f.path}: ${f.type.replace(/-/g, ' ')} needs a decision`)
    }
  }

  if (forAi.length > 0) {
    const settings = deps.settings()
    let tool: (PickedTool & { model?: string }) | null = null
    try {
      const t = pickTool(settings.aiMergeTool === 'same' ? settings.aiCommitTool : settings.aiMergeTool, deps.detectTools())
      tool = { ...t, model: settings.aiModels?.[t.id] }
    } catch (e) {
      unresolved.push(...forAi)
      reasons.push(errMessage(e))
    }
    if (tool) {
      const subjects = await sideSubjects(runner, root)
      for (const [i, p] of forAi.entries()) {
        checkCancel()
        step(`Resolving ${p} (${i + 1}/${forAi.length})…`)
        try {
          const v = await conflictVersions(runner, root, p)
          const text = await resolveConflictWithAi({
            tool,
            root,
            versions: v,
            oursLabel: opts.oursLabel ?? state.yours.name,
            theirsLabel: opts.theirsLabel ?? state.theirs.name,
            oursSubjects: subjects.ours,
            theirsSubjects: subjects.theirs,
            instructions: settings.aiMergeInstructions,
            signal: opts.signal,
            timeoutMs: opts.aiTimeoutMs
          })
          await saveResolution(runner, root, p, text, v.yours.exists ? v.yours.encoding : v.theirs.encoding)
          aiResolved.push(p)
        } catch (e) {
          if (e instanceof AppError && e.code === 'CANCELLED') throw e
          unresolved.push(p)
          reasons.push(`${p}: ${errMessage(e)}`)
        }
      }
    }
  }
  return { unionResolved, aiResolved, unresolved, reasons }
}
