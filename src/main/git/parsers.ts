import type { Commit, FileChange, FileStatus, Ref } from '@shared/types'

/**
 * Parsers for machine-readable git output only (porcelain v2, -z, --format
 * with %x00/%x1e). Never parse human-readable output here.
 */

export interface StatusSummary {
  branch: string | null
  detached: boolean
  /** Commit SHA of HEAD, or null for an unborn branch. */
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  changedCount: number
  conflictedCount: number
  untrackedCount: number
}

/**
 * Parses `git status --porcelain=v2 --branch -z`.
 * Records are NUL-terminated. Rename/copy records ("2 ...") are followed by
 * one extra NUL-terminated field (the original path) that must be skipped.
 */
export function parseStatusV2(output: string): StatusSummary {
  const summary: StatusSummary = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changedCount: 0,
    conflictedCount: 0,
    untrackedCount: 0
  }
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i] as string
    if (rec === '') continue
    if (rec.startsWith('# ')) {
      const [key, ...rest] = rec.slice(2).split(' ')
      const value = rest.join(' ')
      switch (key) {
        case 'branch.oid':
          summary.oid = value === '(initial)' ? null : value
          break
        case 'branch.head':
          if (value === '(detached)') summary.detached = true
          else summary.branch = value
          break
        case 'branch.upstream':
          summary.upstream = value
          break
        case 'branch.ab': {
          const m = /^\+(\d+) -(\d+)$/.exec(value)
          if (m) {
            summary.ahead = Number(m[1])
            summary.behind = Number(m[2])
          }
          break
        }
      }
      continue
    }
    switch (rec[0]) {
      case '1':
        summary.changedCount++
        break
      case '2':
        summary.changedCount++
        i++ // skip original path
        break
      case 'u':
        summary.changedCount++
        summary.conflictedCount++
        break
      case '?':
        summary.changedCount++
        summary.untrackedCount++
        break
      default:
        // '!' ignored entries are not requested; anything else is unknown.
        break
    }
  }
  return summary
}

export interface CloneProgress {
  phase: string
  percent: number | null
}

/**
 * Maps a `git clone --progress` stderr line to an overall percentage.
 * Phases are weighted: counting 5%, compressing 5%, receiving 60%,
 * resolving deltas 20%, updating files 10%.
 */
const PHASES: { match: RegExp; start: number; weight: number }[] = [
  { match: /^remote: Counting objects/, start: 0, weight: 5 },
  { match: /^remote: Compressing objects/, start: 5, weight: 5 },
  { match: /^Receiving objects/, start: 10, weight: 60 },
  { match: /^Resolving deltas/, start: 70, weight: 20 },
  { match: /^Updating files/, start: 90, weight: 10 }
]

export function parseCloneProgress(line: string): CloneProgress | null {
  const trimmed = line.trim()
  for (const p of PHASES) {
    if (!p.match.test(trimmed)) continue
    const m = /(\d+)%/.exec(trimmed)
    const phase = trimmed.split(':')[trimmed.startsWith('remote:') ? 1 : 0]?.trim() ?? trimmed
    if (!m) return { phase, percent: p.start }
    const pct = Number(m[1])
    return { phase, percent: Math.min(100, Math.round(p.start + (p.weight * pct) / 100)) }
  }
  return null
}

// ---------------------------------------------------------------------------
// Log records
// ---------------------------------------------------------------------------

/**
 * `git log` format: every record starts with \x1e, fields are NUL-separated.
 * Subjects never contain NUL or \x1e, and %s is a single line.
 */
export const LOG_FORMAT = '%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s'
/** Same plus the full message (%B), used only while a text filter is active. */
export const LOG_FORMAT_WITH_BODY = LOG_FORMAT + '%x00%B'

export type RawCommit = Omit<Commit, 'onCurrentBranch'> & { body?: string }

export function parseLogRecord(rec: string, withBody = false): RawCommit | null {
  const f = rec.replace(/\n+$/, '').split('\0')
  if (f.length < 9 || !f[0]) return null
  if (withBody) {
    const body = f.slice(9).join('\0')
    return { ...parseLogRecord(f.slice(0, 9).join('\0'))!, body }
  }
  return {
    hash: f[0],
    parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
    authorName: f[2] ?? '',
    authorEmail: f[3] ?? '',
    authorTime: Number(f[4]) || 0,
    committerName: f[5] ?? '',
    committerEmail: f[6] ?? '',
    committerTime: Number(f[7]) || 0,
    subject: f.slice(8).join('\0')
  }
}

/**
 * Splits streamed log text into complete records. A record is complete once
 * the next record separator arrives (or the stream ended).
 */
export function takeLogRecords(text: string, final: boolean, withBody = false): { records: RawCommit[]; rest: string } {
  const parts = text.split('\x1e')
  const rest = final ? '' : (parts.pop() ?? '')
  const records: RawCommit[] = []
  for (const p of parts) {
    if (p === '') continue
    const c = parseLogRecord(p, withBody)
    if (c) records.push(c)
  }
  return { records, rest: final ? '' : '\x1e' + rest }
}

// ---------------------------------------------------------------------------
// for-each-ref
// ---------------------------------------------------------------------------

export const REF_FORMAT =
  '%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(creatordate:unix)%00%(contents:subject)'

export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: track.trim() === 'gone' }
}

export function parseRefs(output: string): Ref[] {
  const refs: Ref[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [name = '', oid = '', peeled = '', type = '', upstream = '', track = '', head = '', date = '', ...subj] = line.split('\0')
    let kind: Ref['kind']
    let short: string
    let remote: string | undefined
    if (name.startsWith('refs/heads/')) {
      kind = 'local'
      short = name.slice(11)
    } else if (name.startsWith('refs/remotes/')) {
      short = name.slice(13)
      if (short.endsWith('/HEAD')) continue
      kind = 'remote'
      remote = short.split('/')[0]
    } else if (name.startsWith('refs/tags/')) {
      kind = 'tag'
      short = name.slice(10)
    } else continue
    const t = parseTrack(track)
    refs.push({
      name,
      short,
      kind,
      hash: peeled || oid,
      remote,
      upstream: upstream || undefined,
      ahead: t.ahead,
      behind: t.behind,
      upstreamGone: t.gone,
      isHead: head === '*',
      annotated: kind === 'tag' ? type === 'tag' : undefined,
      date: Number(date) || 0,
      subject: subj.join('\0')
    })
  }
  return refs
}

// ---------------------------------------------------------------------------
// diff --name-status -z / --numstat -z
// ---------------------------------------------------------------------------

export function parseNameStatus(output: string): FileChange[] {
  const t = output.split('\0')
  const files: FileChange[] = []
  let i = 0
  while (i < t.length) {
    const code = t[i++]
    if (!code) continue
    const status = code[0] as FileStatus
    if (status === 'R' || status === 'C') {
      const oldPath = t[i++] ?? ''
      const path = t[i++] ?? ''
      files.push({ path, oldPath, status, additions: null, deletions: null })
    } else {
      files.push({ path: t[i++] ?? '', status, additions: null, deletions: null })
    }
  }
  return files
}

/** Merges `--numstat -z` counts into name-status entries (null = binary). */
export function applyNumstat(files: FileChange[], output: string): FileChange[] {
  const t = output.split('\0')
  const counts = new Map<string, [number | null, number | null]>()
  let i = 0
  while (i < t.length) {
    const rec = t[i++]
    if (!rec) continue
    const [a = '-', d = '-', path = ''] = rec.split('\t')
    const add = a === '-' ? null : Number(a)
    const del = d === '-' ? null : Number(d)
    if (path === '') {
      i++ // old path
      const newPath = t[i++] ?? ''
      counts.set(newPath, [add, del])
    } else counts.set(path, [add, del])
  }
  return files.map((f) => {
    const c = counts.get(f.path)
    return c ? { ...f, additions: c[0], deletions: c[1] } : f
  })
}
