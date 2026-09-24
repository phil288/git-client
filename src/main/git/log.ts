import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { Commit, LogPage, LogQuery } from '@shared/types'
import { AppError } from './errors'
import { LOG_FORMAT, LOG_FORMAT_WITH_BODY, takeLogRecords, type RawCommit } from './parsers'
import type { GitRunner, StreamHandle } from './runner'

/** Stop reading git's stdout when this many parsed commits wait for the renderer. */
const HIGH_WATER = 10_000
const LOW_WATER = 4_000
const IDLE_MS = 10 * 60_000

/**
 * Text search matches the message, the hash (prefix) and the author, which
 * git cannot OR together (--grep and --author are ANDed), so it is applied
 * here to the streamed records instead of by git.
 */
export function buildTextFilter(query: LogQuery): ((c: RawCommit) => boolean) | null {
  const text = query.text?.trim()
  if (!text) return null
  let re: RegExp
  try {
    re = query.regex ? new RegExp(text, query.matchCase ? 'u' : 'iu') : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), query.matchCase ? '' : 'i')
  } catch (e) {
    throw new AppError(`Invalid regular expression: ${(e as Error).message}`, 'INVALID_ARGUMENT')
  }
  const hashLike = /^[0-9a-f]{4,64}$/i.test(text) ? text.toLowerCase() : null
  return (c) =>
    (hashLike !== null && c.hash.startsWith(hashLike)) ||
    re.test(c.body ?? c.subject) ||
    re.test(c.authorName) ||
    re.test(c.authorEmail)
}

/** Builds `git log` arguments. Revisions and paths never reach git as options. */
export function buildLogArgs(query: LogQuery, headExists: boolean): string[] {
  const withBody = !!query.text?.trim()
  const args = ['log', '--date-order', `--format=${withBody ? LOG_FORMAT_WITH_BODY : LOG_FORMAT}`, '--no-color']
  const paths = (query.paths ?? []).filter((p) => p.trim() !== '')
  if (paths.length > 0 && !query.follow) args.push('--parents') // enables parent rewriting for the graph
  if (query.follow && paths.length === 1) args.push('--follow')
  const authors = (query.authors ?? []).filter((a) => a.trim())
  if (authors.length > 0) args.push('--fixed-strings', '--regexp-ignore-case')
  for (const a of authors) args.push(`--author=${a}`)
  if (query.since) args.push(`--since=${query.since}`)
  if (query.until) args.push(`--until=${query.until}`)
  const revs = query.revs.filter((r) => r.trim() !== '')
  // --branches & co. are options, so they must precede --end-of-options.
  if (revs.length === 0) args.push('--branches', '--remotes', '--tags')
  args.push('--end-of-options')
  if (revs.length === 0) {
    if (headExists) args.push('HEAD')
  } else {
    args.push(...revs)
  }
  args.push('--', ...paths)
  return args
}

interface Session {
  id: string
  handle: StreamHandle | null
  buffer: Commit[]
  text: string
  decoder: StringDecoder
  ended: boolean
  error: AppError | null
  paused: boolean
  waiters: (() => void)[]
  /** Hashes reachable from HEAD that have not been seen yet. */
  pending: Set<string>
  filter: ((c: RawCommit) => boolean) | null
  withBody: boolean
  lastUsed: number
}

/**
 * Streams `git log` once per query and hands it to the renderer in pages.
 * The git process is paused when the renderer falls behind, so a 1M-commit
 * repository never has to be read completely unless the user scrolls there.
 */
export class LogSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly timer: NodeJS.Timeout

  constructor(private readonly runner: GitRunner) {
    this.timer = setInterval(() => this.closeIdle(), 60_000)
    this.timer.unref()
  }

  async open(root: string, query: LogQuery): Promise<string> {
    const filter = buildTextFilter(query)
    const head = await this.runner.run(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { cwd: root, okExitCodes: [0, 1] })
    const headHash = head.exitCode === 0 ? head.stdout.trim() : ''
    const s: Session = {
      id: randomUUID(),
      handle: null,
      buffer: [],
      text: '',
      decoder: new StringDecoder('utf8'),
      ended: false,
      error: null,
      paused: false,
      waiters: [],
      pending: new Set(headHash ? [headHash] : []),
      filter,
      withBody: filter !== null,
      lastUsed: Date.now()
    }
    this.sessions.set(s.id, s)

    // A repository without any ref (fresh `git init`) has no history to show.
    const anyRef = await this.runner.run(['for-each-ref', '--count=1', '--format=%(refname)'], { cwd: root })
    if (!headHash && anyRef.stdout.trim() === '') {
      s.ended = true
      return s.id
    }

    s.handle = this.runner.stream(buildLogArgs(query, headHash !== ''), { cwd: root }, (chunk) => {
      s.text += s.decoder.write(chunk)
      this.drain(s, false)
    })
    s.handle.done
      .then(() => {
        s.text += s.decoder.end()
        this.drain(s, true)
        s.ended = true
        this.wake(s)
      })
      .catch((err: unknown) => {
        s.error = err instanceof AppError ? err : new AppError(String(err), 'UNKNOWN')
        s.ended = true
        this.wake(s)
      })
    return s.id
  }

  private drain(s: Session, final: boolean): void {
    const { records, rest } = takeLogRecords(s.text, final, s.withBody)
    s.text = rest
    for (const r of records) {
      const onCurrentBranch = s.pending.delete(r.hash)
      if (onCurrentBranch) for (const p of r.parents) s.pending.add(p)
      if (s.filter && !s.filter(r)) continue
      const { body: _body, ...commit } = r
      s.buffer.push({ ...commit, onCurrentBranch })
    }
    if (!final && s.buffer.length >= HIGH_WATER && !s.paused) {
      s.paused = true
      s.handle?.pause()
    }
    if (records.length > 0) this.wake(s)
  }

  private wake(s: Session): void {
    const w = s.waiters.splice(0)
    for (const fn of w) fn()
  }

  async next(id: string, count: number): Promise<LogPage> {
    const s = this.sessions.get(id)
    if (!s) throw new AppError('Log session expired', 'INVALID_ARGUMENT')
    s.lastUsed = Date.now()
    while (s.buffer.length < count && !s.ended) {
      await new Promise<void>((r) => s.waiters.push(r))
    }
    if (s.error && s.buffer.length === 0) {
      const e = s.error
      this.close(id)
      throw e
    }
    const commits = s.buffer.splice(0, count)
    if (s.paused && s.buffer.length < LOW_WATER) {
      s.paused = false
      s.handle?.resume()
    }
    const done = s.ended && s.buffer.length === 0
    if (done) this.sessions.delete(id) // fully consumed: nothing left to keep
    return { commits, done }
  }

  close(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.handle?.kill()
    s.ended = true
    this.wake(s)
    this.sessions.delete(id)
  }

  private closeIdle(): void {
    const now = Date.now()
    for (const s of this.sessions.values()) if (now - s.lastUsed > IDLE_MS) this.close(s.id)
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
    clearInterval(this.timer)
  }
}
