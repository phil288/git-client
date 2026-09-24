import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Commit, OpOutcome, RebaseTodoItem, ReflogEntry, ResetMode, RewriteCheck, RewritePlan } from '@shared/types'
import { createBackup, listBackups } from './backup'
import { hasConflicts } from './branches'
import { editorEnv, shQuote } from './editors'
import { AppError } from './errors'
import { LOG_FORMAT, parseLogRecord } from './parsers'
import type { GitRunner } from './runner'

function assertHash(h: string): string {
  if (!/^[0-9a-f]{4,64}$/i.test(h)) throw new AppError(`Invalid commit id: ${h}`, 'INVALID_ARGUMENT')
  return h
}

async function gitDir(runner: GitRunner, root: string): Promise<string> {
  return (await runner.run(['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim()
}

async function rebaseInProgress(runner: GitRunner, root: string): Promise<boolean> {
  const d = await gitDir(runner, root)
  return existsSync(join(d, 'rebase-merge')) || existsSync(join(d, 'rebase-apply'))
}

/**
 * Commit messages for `exec git commit --amend -F <file>` lines live in the
 * git dir until the rebase is over (a rebase that stops on a conflict still
 * needs them when it continues). Cleared before the next rewrite.
 */
async function messageDir(runner: GitRunner, root: string): Promise<string> {
  const dir = join(await gitDir(runner, root), 'gitclient', 'messages')
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function cleanupMessages(runner: GitRunner, root: string): Promise<void> {
  if (await rebaseInProgress(runner, root)) return
  const dir = join(await gitDir(runner, root), 'gitclient', 'messages')
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true })
}

function writeMessage(dir: string, message: string): string {
  const file = join(dir, `${randomUUID()}.txt`)
  writeFileSync(file, message.endsWith('\n') ? message : message + '\n')
  return file
}

/** The exec line the spec asks for; runs in git's sh, so the path is shell-quoted. */
function amendExec(file: string): string {
  return `git commit --amend --no-edit -F ${shQuote(file.replace(/\\/g, '/'))}`
}

/** Commits base..HEAD (oldest first) with full messages, for the rebase dialog and plans. */
export async function rangeCommits(runner: GitRunner, root: string, base: string | null): Promise<(Commit & { message: string })[]> {
  const range = base ? `${assertHash(base)}..HEAD` : 'HEAD'
  const r = await runner.run(['log', '--reverse', '--topo-order', `--format=${LOG_FORMAT}%x00%B`, '--end-of-options', range, '--'], { cwd: root })
  return r.stdout
    .split('\x1e')
    .filter(Boolean)
    .map((rec) => {
      const c = parseLogRecord(rec, true)!
      const { body, ...rest } = c
      return { ...rest, onCurrentBranch: true, message: (body ?? '').replace(/\n+$/, '') }
    })
}

/** Pre-flight checks shown to the user before any history rewrite. */
export async function checkRewrite(runner: GitRunner, root: string, base: string | null, hashes: string[]): Promise<RewriteCheck> {
  for (const h of hashes) {
    const anc = await runner.run(['merge-base', '--is-ancestor', assertHash(h), 'HEAD'], { cwd: root, okExitCodes: [0, 1] })
    if (anc.exitCode !== 0) throw new AppError('Only commits of the current branch can be rewritten.', 'INVALID_ARGUMENT')
  }
  const [status, merges, branchR, up] = await Promise.all([
    runner.run(['status', '--porcelain=v2', '-z', '--untracked-files=no'], { cwd: root }),
    runner.run(['rev-list', '--min-parents=2', '--count', base ? `${assertHash(base)}..HEAD` : 'HEAD', '--'], { cwd: root }),
    runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] }),
    runner.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root, okExitCodes: [0, 128] })
  ])
  const upstream = up.exitCode === 0 ? up.stdout.trim() : null
  let pushed = false
  if (upstream) {
    for (const h of hashes) {
      const a = await runner.run(['merge-base', '--is-ancestor', h, '@{u}'], { cwd: root, okExitCodes: [0, 1] })
      if (a.exitCode === 0) pushed = true
    }
  }
  return {
    dirty: status.stdout.length > 0,
    containsMerges: Number(merges.stdout.trim()) > 0,
    pushed,
    upstream,
    branch: branchR.exitCode === 0 ? branchR.stdout.trim() : null
  }
}

interface TodoLine {
  action: string
  hash: string
  exec: string[]
}

/**
 * Turns the plan into todo lines. Rewording = pick + exec amend; squash =
 * fixup (no editor) + one exec amend with the combined message after the last
 * commit of the group.
 */
export function planToTodo(items: RebaseTodoItem[], writeMsg: (m: string) => string): TodoLine[] {
  const out: TodoLine[] = []
  let groupMessage: string | null = null
  const flush = () => {
    if (groupMessage !== null && out.length > 0) out[out.length - 1]!.exec.push(amendExec(writeMsg(groupMessage)))
    groupMessage = null
  }
  for (const it of items) {
    const joins = it.action === 'squash' || it.action === 'fixup'
    if (!joins) flush()
    switch (it.action) {
      case 'pick':
      case 'edit':
      case 'drop':
        out.push({ action: it.action, hash: it.hash, exec: [] })
        break
      case 'reword':
        out.push({ action: 'pick', hash: it.hash, exec: it.message !== undefined ? [amendExec(writeMsg(it.message))] : [] })
        break
      case 'fixup':
        out.push({ action: 'fixup', hash: it.hash, exec: [] })
        break
      case 'squash':
        out.push({ action: 'fixup', hash: it.hash, exec: [] })
        if (it.message !== undefined) groupMessage = it.message
        break
    }
  }
  flush()
  return out
}

export function validatePlan(items: RebaseTodoItem[]): void {
  const firstKept = items.find((i) => i.action !== 'drop')
  if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')) {
    throw new AppError('The first commit cannot be squashed or fixed up: there is nothing before it to combine with.', 'INVALID_ARGUMENT')
  }
  for (const i of items) assertHash(i.hash)
}

/**
 * Non-interactive `git rebase -i`: GIT_SEQUENCE_EDITOR writes our todo list,
 * GIT_EDITOR is a no-op, messages are applied with exec amend lines. A backup
 * ref is created first. Merges in the range need `rebaseMerges` (then only the
 * actions of picked commits are changed, order is kept).
 */
export async function runRewrite(runner: GitRunner, root: string, plan: RewritePlan, operation = 'rewrite'): Promise<OpOutcome> {
  validatePlan(plan.items)
  if (await rebaseInProgress(runner, root)) throw new AppError('A rebase is already in progress. Continue or abort it first.', 'INVALID_ARGUMENT')
  const check = await checkRewrite(runner, root, plan.base, plan.items.map((i) => i.hash))
  if (check.containsMerges && !plan.rebaseMerges) {
    throw new AppError('The range contains merge commits. Confirm “rebase merges” mode to keep them.', 'INVALID_ARGUMENT')
  }
  if (check.dirty && !plan.autostash) throw new AppError('You have uncommitted changes. Commit, stash, or choose “stash and continue”.', 'DIRTY')

  await cleanupMessages(runner, root)
  const dir = await messageDir(runner, root)
  const lines = planToTodo(plan.items, (m) => writeMessage(dir, m))
  const todoFile = join(dir, `todo-${randomUUID()}`)
  let mode: 'replace' | 'transform'
  if (plan.rebaseMerges) {
    const current = await rangeCommits(runner, root, plan.base)
    const order = plan.items.map((i) => i.hash)
    const same = current.filter((c) => c.parents.length < 2).map((c) => c.hash)
    if (order.join() !== same.join()) throw new AppError('Reordering is not possible in “rebase merges” mode.', 'INVALID_ARGUMENT')
    writeFileSync(todoFile, JSON.stringify(lines))
    mode = 'transform'
  } else {
    writeFileSync(todoFile, lines.map((l) => [`${l.action} ${l.hash}`, ...l.exec.map((x) => `exec ${x}`)].join('\n')).join('\n') + '\n')
    mode = 'replace'
  }

  await createBackup(runner, root, operation)
  const args = ['rebase', '-i']
  if (plan.autostash) args.push('--autostash')
  if (plan.rebaseMerges) args.push('--rebase-merges')
  args.push(plan.base ? assertHash(plan.base) : '--root')
  try {
    await runner.run(args, { cwd: root, env: editorEnv().sequence(todoFile, mode) })
  } catch (err) {
    if (await hasConflicts(runner, root)) return { status: 'conflicts', message: 'The rebase stopped with conflicts. Resolve them, then continue.' }
    if (await rebaseInProgress(runner, root)) return { status: 'stopped', message: 'The rebase stopped. Continue when ready, or abort.' }
    throw err
  } finally {
    rmSync(todoFile, { force: true })
  }
  if (await rebaseInProgress(runner, root)) return { status: 'stopped', message: 'Stopped for editing. Make your changes, then Continue.' }
  await cleanupMessages(runner, root)
  return { status: 'ok', message: 'History rewritten' }
}

/** Reword HEAD in place (message only: --only ignores whatever is staged). */
export async function amendHeadMessage(runner: GitRunner, root: string, message: string): Promise<void> {
  if (!message.trim()) throw new AppError('The commit message is empty.', 'INVALID_ARGUMENT')
  await createBackup(runner, root, 'reword')
  await runner.run(['commit', '--amend', '--only', '--allow-empty', '-F', '-'], { cwd: root, input: message, env: editorEnv().base })
}

export async function reset(runner: GitRunner, root: string, target: string, mode: ResetMode): Promise<void> {
  await createBackup(runner, root, `reset-${mode}`)
  await runner.run(['reset', `--${mode}`, assertHash(target), '--'], { cwd: root })
}

/** "Undo Commit": soft reset of HEAD, keeping its changes staged. */
export async function undoCommit(runner: GitRunner, root: string): Promise<void> {
  const parents = (await runner.run(['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: root })).stdout.trim().split(' ')
  if (parents.length < 2) throw new AppError('The first commit of a repository cannot be undone this way.', 'INVALID_ARGUMENT')
  if (parents.length > 2) throw new AppError('Undo Commit is not available for merge commits; use Reset instead.', 'INVALID_ARGUMENT')
  await createBackup(runner, root, 'undo-commit')
  await runner.run(['reset', '--soft', 'HEAD~1', '--'], { cwd: root })
}

export async function cherryPick(runner: GitRunner, root: string, hashes: string[]): Promise<OpOutcome> {
  await createBackup(runner, root, 'cherry-pick')
  const merges = await Promise.all(hashes.map((h) => runner.run(['rev-list', '--parents', '-n', '1', assertHash(h)], { cwd: root })))
  const args = ['cherry-pick']
  if (merges.some((m) => m.stdout.trim().split(' ').length > 2)) args.push('-m', '1')
  args.push(...hashes)
  try {
    await runner.run(args, { cwd: root, env: editorEnv().base })
    return { status: 'ok', message: `Cherry-picked ${hashes.length} commit${hashes.length === 1 ? '' : 's'}` }
  } catch (err) {
    if (await hasConflicts(runner, root)) return { status: 'conflicts', message: 'Cherry-pick stopped with conflicts.' }
    throw err
  }
}

export async function revert(runner: GitRunner, root: string, hashes: string[]): Promise<OpOutcome> {
  await createBackup(runner, root, 'revert')
  const args = ['revert', '--no-edit']
  const merges = await Promise.all(hashes.map((h) => runner.run(['rev-list', '--parents', '-n', '1', assertHash(h)], { cwd: root })))
  if (merges.some((m) => m.stdout.trim().split(' ').length > 2)) args.push('-m', '1')
  args.push(...hashes)
  try {
    await runner.run(args, { cwd: root, env: editorEnv().base })
    return { status: 'ok', message: `Reverted ${hashes.length} commit${hashes.length === 1 ? '' : 's'}` }
  } catch (err) {
    if (await hasConflicts(runner, root)) return { status: 'conflicts', message: 'Revert stopped with conflicts.' }
    throw err
  }
}

/** `git format-patch --stdout` for each commit (oldest first), concatenated. */
export async function createPatch(runner: GitRunner, root: string, hashes: string[]): Promise<string> {
  const parts: string[] = []
  for (const h of hashes) parts.push((await runner.run(['format-patch', '--stdout', '-1', assertHash(h), '--'], { cwd: root })).stdout)
  return parts.join('')
}

export async function reflog(runner: GitRunner, root: string, limit = 500): Promise<ReflogEntry[]> {
  const r = await runner.run(['reflog', 'show', '--format=%H%x00%gd%x00%gs%x00%ct', '-n', String(limit), 'HEAD', '--'], { cwd: root, okExitCodes: [0, 128] })
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash = '', selector = '', message = '', time = '0'] = l.split('\0')
      return { hash, selector, message, time: Number(time) }
    })
}

/**
 * Resets the current branch to its most recent backup ref (made before the
 * last rewrite / merge / rebase / reset). `--keep` refuses to touch files with
 * local changes (then DIRTY); `hard` discards them (UI confirms first).
 */
export async function undoLast(runner: GitRunner, root: string, hard: boolean): Promise<{ ref: string; operation: string }> {
  const branchR = await runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] })
  const branch = branchR.exitCode === 0 ? branchR.stdout.trim() : 'detached'
  const head = (await runner.run(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  const backup = (await listBackups(runner, root)).find((b) => b.branch === branch && b.hash !== head)
  if (!backup) throw new AppError('Nothing to undo on this branch.', 'INVALID_ARGUMENT')
  try {
    await runner.run(['reset', hard ? '--hard' : '--keep', backup.hash, '--'], { cwd: root })
  } catch (err) {
    if (!hard && err instanceof AppError && err.code === 'GIT_FAILED') {
      throw new AppError('Undo would overwrite local changes. Commit or stash them, or undo with a hard reset.', 'DIRTY', err.extra)
    }
    throw err
  }
  await runner.run(['update-ref', '-d', backup.ref], { cwd: root })
  return { ref: backup.ref, operation: backup.operation }
}
