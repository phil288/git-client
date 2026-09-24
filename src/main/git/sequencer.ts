import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpOutcome, OperationState } from '@shared/types'
import { hasConflicts } from './branches'
import { editorEnv } from './editors'
import { AppError } from './errors'
import { cleanupMessages } from './rewrite'
import type { GitRunner } from './runner'

function read(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

async function nameOf(runner: GitRunner, root: string, hash: string | null): Promise<string | null> {
  if (!hash) return null
  const r = await runner.run(['for-each-ref', '--points-at', hash, '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { cwd: root })
  const names = r.stdout.split('\n').filter((n) => n && !n.endsWith('/HEAD'))
  return names.find((n) => !n.includes('/')) ?? names[0] ?? null
}

async function subjectOf(runner: GitRunner, root: string, hash: string | null): Promise<string | null> {
  if (!hash) return null
  const r = await runner.run(['log', '-1', '--format=%s', hash, '--'], { cwd: root, okExitCodes: [0, 128] })
  return r.exitCode === 0 ? r.stdout.trim() : null
}

export async function conflictedPaths(runner: GitRunner, root: string): Promise<string[]> {
  const r = await runner.run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root })
  return [...new Set(r.stdout.split('\0').filter(Boolean))]
}

export async function operationState(runner: GitRunner, root: string): Promise<OperationState> {
  const gd = (await runner.run(['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim()
  const has = (n: string) => existsSync(join(gd, n))
  const conflicted = await conflictedPaths(runner, root)
  const base: OperationState = {
    operation: null,
    title: '',
    step: null,
    total: null,
    headName: null,
    onto: null,
    ontoName: null,
    currentCommit: null,
    currentSubject: null,
    mergeName: null,
    conflicted,
    canSkip: false,
    preparedMessage: null
  }
  const short = (ref: string | null) => (ref ? ref.replace(/^refs\/heads\//, '') : null)

  if (has('rebase-merge') || has('rebase-apply')) {
    const dir = join(gd, has('rebase-merge') ? 'rebase-merge' : 'rebase-apply')
    if (has('rebase-apply') && existsSync(join(dir, 'applying'))) {
      return { ...base, operation: 'am', title: 'Applying patches (git am)', canSkip: true }
    }
    const headName = short(read(join(dir, 'head-name')))
    const onto = read(join(dir, 'onto'))
    const step = Number(read(join(dir, has('rebase-merge') ? 'msgnum' : 'next'))) || null
    const total = Number(read(join(dir, has('rebase-merge') ? 'end' : 'last'))) || null
    const current = read(join(gd, 'REBASE_HEAD')) ?? read(join(dir, 'stopped-sha'))
    const ontoName = (await nameOf(runner, root, onto)) ?? onto?.slice(0, 8) ?? null
    return {
      ...base,
      operation: 'rebase',
      title: `Rebasing ${headName ?? 'HEAD'} onto ${ontoName ?? '?'}`,
      step,
      total,
      headName,
      onto,
      ontoName,
      currentCommit: current,
      currentSubject: await subjectOf(runner, root, current),
      canSkip: true
    }
  }
  if (has('MERGE_HEAD')) {
    const mh = read(join(gd, 'MERGE_HEAD'))?.split('\n')[0] ?? null
    const msg = read(join(gd, 'MERGE_MSG'))
    const fromMsg = msg ? /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(msg)?.[1] : undefined
    const mergeName = fromMsg ?? (await nameOf(runner, root, mh)) ?? mh?.slice(0, 8) ?? null
    const head = (await runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] })).stdout.trim() || 'HEAD'
    return {
      ...base,
      operation: 'merge',
      title: `Merging ${mergeName} into ${head}`,
      headName: head,
      currentCommit: mh,
      currentSubject: await subjectOf(runner, root, mh),
      mergeName,
      preparedMessage: msg ? msg.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim() : null
    }
  }
  const head = (await runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, okExitCodes: [0, 1] })).stdout.trim() || 'HEAD'
  for (const [file, op, verb] of [
    ['CHERRY_PICK_HEAD', 'cherry-pick', 'Cherry-picking'],
    ['REVERT_HEAD', 'revert', 'Reverting']
  ] as const) {
    if (!has(file)) continue
    const h = read(join(gd, file))
    const subject = await subjectOf(runner, root, h)
    const todo = read(join(gd, 'sequencer', 'todo'))
    const remaining = todo ? todo.split('\n').filter((l) => l && !l.startsWith('#')).length : 0
    return {
      ...base,
      operation: op,
      title: `${verb} ${h?.slice(0, 8)} “${subject ?? ''}” onto ${head}`,
      headName: head,
      currentCommit: h,
      currentSubject: subject,
      total: remaining > 0 ? remaining + 1 : null,
      canSkip: true,
      preparedMessage: read(join(gd, 'MERGE_MSG'))
    }
  }
  if (has('BISECT_LOG')) return { ...base, operation: 'bisect', title: 'Bisecting' }
  if (has('SQUASH_MSG') && conflicted.length === 0) return { ...base, preparedMessage: read(join(gd, 'SQUASH_MSG')) }
  return base
}

async function outcomeAfter(runner: GitRunner, root: string, doneMessage: string): Promise<OpOutcome> {
  const st = await operationState(runner, root)
  if (st.conflicted.length > 0) return { status: 'conflicts', message: `${st.title}: conflicts in the next step.` }
  if (st.operation) return { status: 'stopped', message: `${st.title}${st.step ? ` (step ${st.step}/${st.total})` : ''}: stopped.` }
  await cleanupMessages(runner, root)
  return { status: 'ok', message: doneMessage }
}

async function runSeq(runner: GitRunner, root: string, args: string[], input?: string): Promise<void> {
  try {
    await runner.run(args, { cwd: root, env: editorEnv().base, input })
  } catch (err) {
    // Stopping again on conflicts / an edit step is a normal outcome.
    if (await hasConflicts(runner, root)) return
    const st = await operationState(runner, root)
    if (st.operation && err instanceof AppError && /stopped|could not apply|CONFLICT/i.test(err.extra.stderr ?? '')) return
    throw err
  }
}

/** Continue the operation in progress. `message` is used for merge commits. */
export async function continueOperation(runner: GitRunner, root: string, message?: string): Promise<OpOutcome> {
  const st = await operationState(runner, root)
  if (st.conflicted.length > 0) {
    throw new AppError(`Resolve the remaining conflicts first (${st.conflicted.length} file${st.conflicted.length === 1 ? '' : 's'}).`, 'INVALID_ARGUMENT')
  }
  switch (st.operation) {
    case 'rebase':
      await runSeq(runner, root, ['rebase', '--continue'])
      return outcomeAfter(runner, root, `Rebase of ${st.headName ?? 'HEAD'} finished`)
    case 'merge':
      if (message?.trim()) await runSeq(runner, root, ['commit', '-F', '-'], message)
      else await runSeq(runner, root, ['commit', '--no-edit'])
      return outcomeAfter(runner, root, 'Merge committed')
    case 'cherry-pick':
      await runSeq(runner, root, ['cherry-pick', '--continue'])
      return outcomeAfter(runner, root, 'Cherry-pick finished')
    case 'revert':
      await runSeq(runner, root, ['revert', '--continue'])
      return outcomeAfter(runner, root, 'Revert finished')
    case 'am':
      await runSeq(runner, root, ['am', '--continue'])
      return outcomeAfter(runner, root, 'Patches applied')
    default: {
      // `merge --squash` leaves no operation marker, only SQUASH_MSG: finishing = committing.
      const gd = (await runner.run(['rev-parse', '--absolute-git-dir'], { cwd: root })).stdout.trim()
      if (existsSync(join(gd, 'SQUASH_MSG'))) {
        if (message?.trim()) await runSeq(runner, root, ['commit', '-F', '-'], message)
        else await runSeq(runner, root, ['commit', '--no-edit'])
        return outcomeAfter(runner, root, 'Squash merge committed')
      }
      throw new AppError('No operation in progress.', 'INVALID_ARGUMENT')
    }
  }
}

export async function skipOperation(runner: GitRunner, root: string): Promise<OpOutcome> {
  const st = await operationState(runner, root)
  const cmd = { rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert', am: 'am' }[st.operation as string]
  if (!cmd) throw new AppError('This operation cannot skip a step.', 'INVALID_ARGUMENT')
  await runSeq(runner, root, [cmd, '--skip'])
  return outcomeAfter(runner, root, `${st.operation} finished`)
}

export async function abortOperation(runner: GitRunner, root: string): Promise<OpOutcome> {
  const st = await operationState(runner, root)
  if (st.operation && st.operation !== 'bisect') {
    await runner.run([st.operation, '--abort'], { cwd: root, env: editorEnv().base })
  } else if (st.operation === 'bisect') {
    await runner.run(['bisect', 'reset'], { cwd: root })
  } else if (st.conflicted.length > 0) {
    // Conflicts without an operation: a stash apply/pop. Restore the pre-apply state of those files.
    await runner.run(['reset', '--merge'], { cwd: root })
  } else {
    throw new AppError('No operation in progress.', 'INVALID_ARGUMENT')
  }
  await cleanupMessages(runner, root)
  return { status: 'ok', message: st.operation ? `${st.operation} aborted` : 'Stash application aborted' }
}
