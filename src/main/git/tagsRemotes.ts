import { AppError } from './errors'
import { progressPercent, type Progress } from './branches'
import type { GitRunner } from './runner'

function name(n: string, what: string): string {
  const v = n.trim()
  if (!v || v.startsWith('-')) throw new AppError(`Invalid ${what}: ${n}`, 'INVALID_ARGUMENT')
  return v
}

export async function createTag(runner: GitRunner, root: string, tag: string, target: string, message: string | null): Promise<void> {
  const t = name(tag, 'tag name')
  const ok = await runner.run(['check-ref-format', `refs/tags/${t}`], { cwd: root, okExitCodes: [0, 1] })
  if (ok.exitCode !== 0) throw new AppError(`“${t}” is not a valid tag name.`, 'INVALID_ARGUMENT')
  if (message !== null && message.trim()) await runner.run(['tag', '-a', t, '-F', '-', name(target, 'target')], { cwd: root, input: message })
  else await runner.run(['tag', t, name(target, 'target')], { cwd: root })
}

export async function deleteTag(runner: GitRunner, root: string, tag: string): Promise<void> {
  await runner.run(['tag', '-d', name(tag, 'tag')], { cwd: root })
}

export async function pushTag(runner: GitRunner, root: string, remote: string, tag: string, signal?: AbortSignal, progress?: Progress): Promise<void> {
  await runner.run(['push', '--progress', name(remote, 'remote'), `refs/tags/${name(tag, 'tag')}`], {
    cwd: root,
    signal,
    onStderrLine: (l) => progress?.(l, progressPercent(l))
  })
}

export async function deleteRemoteTag(runner: GitRunner, root: string, remote: string, tag: string, signal?: AbortSignal): Promise<void> {
  await runner.run(['push', name(remote, 'remote'), '--delete', `refs/tags/${name(tag, 'tag')}`], { cwd: root, signal })
}

export async function addRemote(runner: GitRunner, root: string, remote: string, url: string): Promise<void> {
  await runner.run(['remote', 'add', '--', name(remote, 'remote name'), name(url, 'URL')], { cwd: root })
}

export async function setRemoteUrl(runner: GitRunner, root: string, remote: string, url: string, push: boolean): Promise<void> {
  const args = ['remote', 'set-url']
  if (push) args.push('--push')
  args.push('--', name(remote, 'remote'), name(url, 'URL'))
  await runner.run(args, { cwd: root })
}

export async function removeRemote(runner: GitRunner, root: string, remote: string): Promise<void> {
  await runner.run(['remote', 'remove', name(remote, 'remote')], { cwd: root })
}

export async function renameRemote(runner: GitRunner, root: string, oldName: string, newName: string): Promise<void> {
  await runner.run(['remote', 'rename', name(oldName, 'remote'), name(newName, 'remote name')], { cwd: root })
}

export async function pruneRemote(runner: GitRunner, root: string, remote: string, signal?: AbortSignal): Promise<void> {
  await runner.run(['remote', 'prune', name(remote, 'remote')], { cwd: root, signal })
}
