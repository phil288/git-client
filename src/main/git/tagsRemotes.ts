import type { TagEntry } from '@shared/types'
import { AppError } from './errors'
import { progressPercent, type Progress } from './branches'
import type { GitRunner } from './runner'

function name(n: string, what: string): string {
  const v = n.trim()
  if (!v || v.startsWith('-')) throw new AppError(`Invalid ${what}: ${n}`, 'INVALID_ARGUMENT')
  return v
}

/** Fields NUL-separated, records separated by RS (the annotation message may span lines). */
const TAG_FORMAT = ['%(refname:short)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(taggername)', '%(creatordate:unix)', '%(*subject)', '%(subject)', '%(contents)'].join('%00') + '%1e'

export function parseTags(out: string): TagEntry[] {
  const tags: TagEntry[] = []
  for (const rec of out.split('\x1e')) {
    const [name = '', type = '', oid = '', peeled = '', tagger = '', date = '', peeledSubject = '', subject = '', ...contents] = rec.replace(/^\n/, '').split('\0')
    if (!name) continue
    const annotated = type === 'tag'
    tags.push({
      name,
      hash: peeled || oid,
      annotated,
      tagger: annotated ? tagger.replace(/\s*<[^>]*>$/, '') || null : null,
      date: Number(date) || 0,
      message: annotated ? contents.join('\0').replace(/\n+$/, '') : '',
      commitSubject: annotated ? peeledSubject : subject
    })
  }
  return tags
}

export async function listTags(runner: GitRunner, root: string): Promise<TagEntry[]> {
  const r = await runner.run(['for-each-ref', '--sort=-creatordate', `--format=${TAG_FORMAT}`, 'refs/tags'], { cwd: root })
  return parseTags(r.stdout)
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
