import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectTextInfo, hasConflictMarkers, mergeTexts } from '@shared/merge3'
import type { ConflictFile, ConflictState, ConflictType, ConflictVersions, MergePreview, SideAction, SideLabel } from '@shared/types'
import { editorEnv } from './editors'
import { encodeText, type Encoding } from './encoding'
import { AppError } from './errors'
import { compareVersions } from './locate'
import { fileContent } from './repoData'
import type { GitRunner } from './runner'
import { operationState } from './sequencer'

interface StageInfo {
  mode: string
  sha: string
}

/** `git ls-files -u -z`: "<mode> <sha> <stage>\t<path>" per unmerged index entry. */
export async function unmergedStages(runner: GitRunner, root: string): Promise<Map<string, Partial<Record<1 | 2 | 3, StageInfo>>>> {
  const r = await runner.run(['ls-files', '-u', '-z'], { cwd: root })
  const map = new Map<string, Partial<Record<1 | 2 | 3, StageInfo>>>()
  for (const rec of r.stdout.split('\0')) {
    if (!rec) continue
    const tab = rec.indexOf('\t')
    const [mode = '', sha = '', stage = '0'] = rec.slice(0, tab).split(' ')
    const path = rec.slice(tab + 1)
    const entry = map.get(path) ?? {}
    entry[Number(stage) as 1 | 2 | 3] = { mode, sha }
    map.set(path, entry)
  }
  return map
}

function sideAction(base: StageInfo | undefined, side: StageInfo | undefined): SideAction {
  if (!side) return 'deleted'
  if (!base) return 'added'
  return side.sha === base.sha ? 'unchanged' : 'modified'
}

function typeOf(stages: Partial<Record<1 | 2 | 3, StageInfo>>, binary: boolean): ConflictType {
  const b = stages[1]
  const o = stages[2]
  const t = stages[3]
  if ((o && o.mode === '160000') || (t && t.mode === '160000')) return 'submodule'
  if (!o && !t) return 'both-deleted'
  if (o && !t) return b ? 'modify-delete' : 'added-by-us'
  if (!o && t) return b ? 'delete-modify' : 'added-by-them'
  if (binary) return 'binary'
  return b ? 'content' : 'add-add'
}

/**
 * Which side is which, in plain words. git's "ours"/"theirs" are inverted
 * during a rebase: stage 2 ("Yours") is the branch being rebased ONTO and
 * stage 3 ("Theirs") is your commit being replayed. Labels always say so.
 */
export function sideLabels(op: Awaited<ReturnType<typeof operationState>>, squash: boolean): { yours: SideLabel; theirs: SideLabel; kind: ConflictState['operation'] } {
  const subj = (s: string | null) => (s ? `'${s.length > 60 ? s.slice(0, 57) + '…' : s}'` : '')
  switch (op.operation) {
    case 'rebase':
      return {
        kind: 'rebase',
        yours: { role: 'Yours', name: op.ontoName ?? 'upstream', detail: 'upstream' },
        theirs: { role: 'Theirs', name: op.headName ?? 'HEAD', detail: `your commit ${subj(op.currentSubject)}`.trim() }
      }
    case 'merge':
      return {
        kind: 'merge',
        yours: { role: 'Yours', name: op.headName ?? 'HEAD', detail: 'current branch' },
        theirs: { role: 'Theirs', name: op.mergeName ?? 'merged commit', detail: `being merged ${subj(op.currentSubject)}`.trim() }
      }
    case 'cherry-pick':
      return {
        kind: 'cherry-pick',
        yours: { role: 'Yours', name: op.headName ?? 'HEAD', detail: 'current branch' },
        theirs: { role: 'Theirs', name: op.currentCommit?.slice(0, 8) ?? 'commit', detail: `cherry-picked commit ${subj(op.currentSubject)}`.trim() }
      }
    case 'revert':
      return {
        kind: 'revert',
        yours: { role: 'Yours', name: op.headName ?? 'HEAD', detail: 'current branch' },
        theirs: { role: 'Theirs', name: `revert of ${op.currentCommit?.slice(0, 8) ?? 'commit'}`, detail: `undoing ${subj(op.currentSubject)}`.trim() }
      }
    default:
      if (squash) {
        return {
          kind: 'merge',
          yours: { role: 'Yours', name: 'HEAD', detail: 'current branch' },
          theirs: { role: 'Theirs', name: 'squashed branch', detail: 'changes being squash-merged' }
        }
      }
      return {
        kind: op.conflicted.length > 0 ? 'stash' : 'unknown',
        yours: { role: 'Yours', name: 'HEAD', detail: 'your committed state' },
        theirs: { role: 'Theirs', name: 'stash', detail: 'your stashed changes' }
      }
  }
}

async function isBinaryStage(runner: GitRunner, root: string, sha: string | undefined): Promise<boolean> {
  if (!sha) return false
  const r = await runner.run(['cat-file', 'blob', sha], { cwd: root })
  const n = Math.min(r.stdoutBuffer.length, 8000)
  for (let i = 0; i < n; i++) if (r.stdoutBuffer[i] === 0) return true
  return false
}

export async function conflictState(runner: GitRunner, root: string): Promise<ConflictState> {
  const op = await operationState(runner, root)
  const gd = (await runner.run(['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim()
  const squashMsg = existsSync(join(gd, 'SQUASH_MSG')) ? readFileSync(join(gd, 'SQUASH_MSG'), 'utf8') : null
  const squash = !op.operation && squashMsg !== null
  const labels = sideLabels(op, squash)
  const stages = await unmergedStages(runner, root)
  const files: ConflictFile[] = []
  for (const [path, s] of stages) {
    // Gitlinks (mode 160000) point at commits, not blobs.
    const blobSha = (x: StageInfo | undefined) => (x && x.mode !== '160000' ? x.sha : undefined)
    const binary = (await isBinaryStage(runner, root, blobSha(s[2]))) || (await isBinaryStage(runner, root, blobSha(s[3])))
    const type = typeOf(s, binary)
    let markersResolved = false
    if (type === 'content' || type === 'add-add') {
      try {
        markersResolved = !hasConflictMarkers(readFileSync(join(root, path), 'utf8'))
      } catch {
        markersResolved = false
      }
    }
    const code = `${s[2] ? (s[1] ? 'U' : 'A') : 'D'}${s[3] ? (s[1] ? 'U' : 'A') : 'D'}`
    files.push({
      path,
      code,
      type,
      yours: sideAction(s[1], s[2]),
      theirs: sideAction(s[1], s[3]),
      binary,
      submodule: type === 'submodule',
      markersResolved
    })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const title = op.operation ? op.title : squash ? 'Squash merge' : files.length ? 'Applying stash' : ''
  const cleanMsg = (m: string | null) => (m ? m.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim() : '')
  return {
    operation: labels.kind,
    title,
    step: op.step,
    totalSteps: op.total,
    yours: labels.yours,
    theirs: labels.theirs,
    files,
    canSkip: op.canSkip,
    needsMessage: op.operation === 'merge' || squash,
    defaultMessage: op.operation === 'merge' ? (op.preparedMessage ?? '') : cleanMsg(squashMsg)
  }
}

/** Base / Yours / Theirs / working tree of a conflicted file, with EOL info for saving. */
export async function conflictVersions(runner: GitRunner, root: string, path: string): Promise<ConflictVersions> {
  const [base, yours, theirs, worktree] = await Promise.all([
    fileContent(runner, root, ':1', path),
    fileContent(runner, root, ':2', path),
    fileContent(runner, root, ':3', path),
    fileContent(runner, root, ':worktree', path)
  ])
  // Submodule commits usually do not exist in this repository's object store:
  // take the SHAs from the unmerged index entries instead.
  const stages = (await unmergedStages(runner, root)).get(path) ?? {}
  for (const [n, c] of [[1, base], [2, yours], [3, theirs]] as const) {
    const s = stages[n]
    if (s?.mode === '160000') Object.assign(c, { exists: true, binary: true, gitlink: s.sha, text: '' })
  }
  const ref = [yours, theirs, base].find((c) => c.exists && c.text.includes('\n')) ?? yours
  const info = detectTextInfo(ref.text)
  const nonEmpty = [yours, theirs, base].find((c) => c.exists && c.text.length > 0)
  const finalNewline = nonEmpty ? detectTextInfo(nonEmpty.text).finalNewline : true
  return { path, base, yours, theirs, worktree, eol: info.eol, finalNewline }
}

function checkPath(p: string): string {
  if (!p || p.includes('\0') || p.startsWith('-')) throw new AppError('Invalid path', 'INVALID_ARGUMENT')
  return p
}

/** Resolve by taking one side entirely (file content, deletion or submodule commit). */
export async function acceptSide(runner: GitRunner, root: string, paths: string[], side: 'yours' | 'theirs'): Promise<void> {
  const stages = await unmergedStages(runner, root)
  const n = side === 'yours' ? 2 : 3
  for (const p of paths.map(checkPath)) {
    const st = stages.get(p)
    if (!st) continue
    const chosen = st[n]
    if (!chosen) {
      await runner.run(['rm', '-q', '--cached', '--ignore-unmatch', '--', p], { cwd: root })
      await runner.run(['rm', '-q', '-f', '--ignore-unmatch', '--', p], { cwd: root })
    } else if (chosen.mode === '160000') {
      await runner.run(['update-index', '--cacheinfo', `${chosen.mode},${chosen.sha},${p}`], { cwd: root })
    } else {
      await runner.run(['checkout', side === 'yours' ? '--ours' : '--theirs', '--', p], { cwd: root })
      await runner.run(['add', '--', p], { cwd: root })
    }
  }
}

/** Resolve a submodule conflict with an explicit commit. */
export async function resolveSubmodule(runner: GitRunner, root: string, path: string, sha: string): Promise<void> {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new AppError('Invalid commit id', 'INVALID_ARGUMENT')
  await runner.run(['update-index', '--cacheinfo', `160000,${sha},${checkPath(path)}`], { cwd: root })
}

/** Mark files as resolved as they are in the working tree (`git add`, or `git rm` if deleted). */
export async function markResolved(runner: GitRunner, root: string, paths: string[]): Promise<void> {
  for (const p of paths.map(checkPath)) {
    if (existsSync(join(root, p))) await runner.run(['add', '--', p], { cwd: root })
    else await runner.run(['rm', '-q', '--cached', '--', p], { cwd: root })
  }
}

/** Resolve by deleting the file. */
export async function resolveDelete(runner: GitRunner, root: string, paths: string[]): Promise<void> {
  for (const p of paths.map(checkPath)) await runner.run(['rm', '-q', '-f', '--', p], { cwd: root })
}

/** Write the merge editor result (original encoding) and stage it. */
export async function saveResolution(runner: GitRunner, root: string, path: string, text: string, encoding: Encoding): Promise<void> {
  await writeFile(join(root, checkPath(path)), encodeText(text, encoding))
  await runner.run(['add', '--', path], { cwd: root })
}

/**
 * "Resolve simple conflicts": re-merges each text conflict line by line and
 * writes it when nothing truly conflicts (only one side changed a chunk, or
 * both made the same change — adjacent edits included, which git leaves as
 * conflicts). Files with real conflicts are left untouched.
 */
export async function autoResolve(runner: GitRunner, root: string, paths?: string[]): Promise<{ resolved: string[]; remaining: { path: string; conflicts: number }[] }> {
  const state = await conflictState(runner, root)
  const resolved: string[] = []
  const remaining: { path: string; conflicts: number }[] = []
  for (const f of state.files) {
    if (paths && !paths.includes(f.path)) continue
    if (f.type !== 'content' && f.type !== 'add-add') {
      remaining.push({ path: f.path, conflicts: 1 })
      continue
    }
    const v = await conflictVersions(runner, root, f.path)
    if (v.yours.tooLarge || v.theirs.tooLarge) {
      remaining.push({ path: f.path, conflicts: 1 })
      continue
    }
    const m = mergeTexts(v.base.text, v.yours.text, v.theirs.text)
    if (m.text === null) {
      remaining.push({ path: f.path, conflicts: m.conflicts })
      continue
    }
    await saveResolution(runner, root, f.path, m.text, v.yours.exists ? v.yours.encoding : v.theirs.encoding)
    resolved.push(f.path)
  }
  return { resolved, remaining }
}

/** Runs the configured external merge tool (blocks until it exits). */
export async function runMergeTool(runner: GitRunner, root: string, path: string, tool: string): Promise<void> {
  const args = ['mergetool', '--no-prompt']
  if (tool.trim()) {
    if (!/^[\w.-]+$/.test(tool.trim())) throw new AppError('Invalid merge tool name', 'INVALID_ARGUMENT')
    args.push(`--tool=${tool.trim()}`)
  }
  args.push('--', checkPath(path))
  await runner.run(args, { cwd: root, env: editorEnv().base })
}

/** Files that would conflict if `ref` were merged into HEAD (git ≥ 2.38, no working-tree change). */
export async function previewMerge(runner: GitRunner, root: string, ref: string, gitVersion: [number, number, number]): Promise<MergePreview> {
  if (compareVersions(gitVersion, [2, 38, 0]) < 0) return { supported: false, conflicts: [], clean: false }
  if (ref.startsWith('-')) throw new AppError('Invalid revision', 'INVALID_ARGUMENT')
  const r = await runner.run(['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', 'HEAD', ref], { cwd: root, okExitCodes: [0, 1] })
  const parts = r.stdout.split('\0').filter(Boolean)
  const conflicts = [...new Set(parts.slice(1))]
  return { supported: true, conflicts, clean: r.exitCode === 0 }
}

export async function getRerere(runner: GitRunner, root: string): Promise<boolean> {
  const r = await runner.run(['config', '--get', '--bool', 'rerere.enabled'], { cwd: root, okExitCodes: [0, 1] })
  return r.stdout.trim() === 'true'
}

/** Per-repository `rerere.enabled` (+ autoUpdate so reused resolutions are staged). */
export async function setRerere(runner: GitRunner, root: string, enabled: boolean): Promise<void> {
  await runner.run(['config', 'rerere.enabled', String(enabled)], { cwd: root })
  await runner.run(['config', 'rerere.autoUpdate', String(enabled)], { cwd: root })
}

export async function configuredMergeTool(runner: GitRunner, root: string): Promise<string | null> {
  const r = await runner.run(['config', '--get', 'merge.tool'], { cwd: root, okExitCodes: [0, 1] })
  return r.exitCode === 0 ? r.stdout.trim() : null
}
