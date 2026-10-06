import type { RemoteTestResult, RemoteUpdate, TagEntry } from '@shared/types'
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

export async function addRemote(runner: GitRunner, root: string, remote: string, url: string, pushUrl: string | null = null): Promise<void> {
  const n = name(remote, 'remote name')
  await runner.run(['remote', 'add', '--', n, name(url, 'URL')], { cwd: root })
  if (pushUrl?.trim() && pushUrl.trim() !== url.trim()) await setRemoteUrl(runner, root, n, pushUrl, true)
}

/** Removes a separate push URL so pushes use the fetch URL again. */
export async function unsetPushUrl(runner: GitRunner, root: string, remote: string): Promise<void> {
  // Exit 5: the key was not set.
  await runner.run(['config', '--unset-all', `remote.${name(remote, 'remote')}.pushurl`], { cwd: root, okExitCodes: [0, 5] })
}

/**
 * Applies the edits of the remote dialog in one call: rename, fetch URL, push URL
 * (null = same as fetch). Only what changed is run.
 */
export async function updateRemote(runner: GitRunner, root: string, remote: string, u: RemoteUpdate): Promise<void> {
  const current = (await listRemoteConfig(runner, root)).get(remote)
  if (!current) throw new AppError(`There is no remote named “${remote}”.`, 'INVALID_ARGUMENT')
  let n = remote
  const newName = u.name.trim()
  if (newName && newName !== remote) {
    await renameRemote(runner, root, remote, newName)
    n = newName
  }
  const url = name(u.fetchUrl, 'URL')
  if (url !== current.url) await setRemoteUrl(runner, root, n, url, false)
  const push = u.pushUrl?.trim() || null
  if (push === null || push === url) {
    if (current.push !== undefined) await unsetPushUrl(runner, root, n)
  } else if (push !== current.push) {
    await setRemoteUrl(runner, root, n, push, true)
  }
}

async function listRemoteConfig(runner: GitRunner, root: string): Promise<Map<string, { url?: string; push?: string }>> {
  const cfg = await runner.run(['config', '-z', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'], { cwd: root, okExitCodes: [0, 1] })
  const out = new Map<string, { url?: string; push?: string }>()
  for (const entry of cfg.stdout.split('\0')) {
    const nl = entry.indexOf('\n')
    const m = /^remote\.(.+)\.(url|pushurl)$/.exec(entry.slice(0, nl))
    if (!m) continue
    const e = out.get(m[1]!) ?? {}
    if (m[2] === 'url') e.url ??= entry.slice(nl + 1)
    else e.push ??= entry.slice(nl + 1)
    out.set(m[1]!, e)
  }
  return out
}

/** Parses `ls-remote --symref` output. */
export function parseLsRemote(out: string): RemoteTestResult {
  let branches = 0
  let tags = 0
  let defaultBranch: string | null = null
  for (const line of out.split('\n')) {
    const sym = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line)
    if (sym) defaultBranch = sym[1]!
    const ref = line.split('\t')[1] ?? ''
    if (ref.startsWith('refs/heads/')) branches++
    else if (ref.startsWith('refs/tags/') && !ref.endsWith('^{}')) tags++
  }
  return { branches, tags, defaultBranch }
}

/** Checks that a URL is reachable and readable (no change to the repository). Gives up after `timeoutMs`. */
export async function testRemoteUrl(runner: GitRunner, root: string, url: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<RemoteTestResult> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const r = await runner.run(['ls-remote', '--symref', '--', name(url, 'URL')], {
    cwd: root,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  }).catch((err: unknown) => {
    if (timeout.aborted) throw new AppError(`No answer from the server after ${Math.round(timeoutMs / 1000)} seconds.`, 'GIT_FAILED')
    throw err
  })
  return parseLsRemote(r.stdout)
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
