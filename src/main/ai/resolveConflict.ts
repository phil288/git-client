import { AI_MERGE_DATA_GUARD, AI_INSTRUCTIONS_MAX, defaultMergeInstructions } from '@shared/aiTool'
import { cleanMergeAnswer, hasMergeMarkers } from '@shared/autoMerge'
import { joinLines, merge3, renderWithMarkers, splitLines } from '@shared/merge3'
import { AI_TOOL_LABEL, type AiTool, type ConflictVersions } from '@shared/types'
import { AppError } from '../git/errors'
import { runTool } from './commitMessage'

/** Larger sides are not sent: the answer must echo the whole file back, which CLIs truncate. */
export const AI_MERGE_MAX_BYTES = 200 * 1024
const AI_MERGE_TIMEOUT_MS = 300_000

export interface MergePromptInput {
  path: string
  /** Branch names shown in the markers. */
  oursLabel: string
  theirsLabel: string
  /** Recent commit subjects of each side since the merge base (intent hints). */
  oursSubjects: readonly string[]
  theirsSubjects: readonly string[]
  /** The file with diff3-style markers around the conflicting regions only. */
  marked: string
  instructions?: string
}

export function buildMergePrompt(input: MergePromptInput): string {
  const custom = input.instructions?.trim().slice(0, AI_INSTRUCTIONS_MAX)
  const subjects = (label: string, s: readonly string[]) =>
    s.length ? [`Recent commits on ${label}:`, ...s.slice(0, 10).map((x) => `- ${x}`), ''] : []
  return [
    custom || defaultMergeInstructions(),
    AI_MERGE_DATA_GUARD,
    '',
    `File: ${input.path}`,
    `Target branch (first side of each conflict): ${input.oursLabel}`,
    `Incoming branch (second side of each conflict): ${input.theirsLabel}`,
    '',
    ...subjects(input.oursLabel, input.oursSubjects),
    ...subjects(input.theirsLabel, input.theirsSubjects),
    '--- BEGIN FILE ---',
    input.marked,
    '--- END FILE ---'
  ].join('\n')
}

export interface ResolveWithAiOptions {
  tool: { id: AiTool; path: string; model?: string }
  root: string
  versions: ConflictVersions
  oursLabel: string
  theirsLabel: string
  oursSubjects: readonly string[]
  theirsSubjects: readonly string[]
  instructions?: string
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Asks the CLI (read-only, no tools: it never touches the repository) for the
 * resolved content of one text conflict and checks the answer. Returns the text
 * to save; throws AppError with a user-facing reason when it cannot be used.
 */
export async function resolveConflictWithAi(o: ResolveWithAiOptions): Promise<string> {
  const v = o.versions
  const label = AI_TOOL_LABEL[o.tool.id]
  for (const side of [v.base, v.yours, v.theirs]) {
    if (side.binary) throw new AppError(`${v.path} is binary`, 'INVALID_ARGUMENT')
    if (side.tooLarge || side.size > AI_MERGE_MAX_BYTES) throw new AppError(`${v.path} is too large for AI resolution`, 'INVALID_ARGUMENT')
  }
  const info = { eol: v.eol, finalNewline: v.finalNewline }
  const regions = merge3(splitLines(v.base.text), splitLines(v.yours.text), splitLines(v.theirs.text))
  const marked = joinLines(renderWithMarkers(regions, o.oursLabel, o.theirsLabel), { eol: '\n', finalNewline: true })
  const prompt = buildMergePrompt({ ...o, path: v.path, marked })
  const res = await runTool(o.tool.id, o.tool.path, o.root, prompt, {
    signal: o.signal,
    timeoutMs: o.timeoutMs ?? AI_MERGE_TIMEOUT_MS,
    model: o.tool.model
  })
  const answer = cleanMergeAnswer(res.answerFile?.trim() ? res.answerFile : res.stdout)
  const inputsHaveMarkers = [v.base, v.yours, v.theirs].some((s) => hasMergeMarkers(s.text))
  if (answer.trim() === '' && (v.yours.text.trim() !== '' || v.theirs.text.trim() !== '')) {
    throw new AppError(`${label} returned an empty file for ${v.path}`, 'UNKNOWN')
  }
  if (!inputsHaveMarkers && hasMergeMarkers(answer)) throw new AppError(`${label} left conflict markers in ${v.path}`, 'UNKNOWN')
  return joinLines(splitLines(answer), info)
}
