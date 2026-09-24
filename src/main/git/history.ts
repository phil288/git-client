import type { BlameLine, FileHistoryEntry, FileStatus } from '@shared/types'
import { AppError } from './errors'
import { LOG_FORMAT, parseLogRecord } from './parsers'
import type { GitRunner } from './runner'

function checkPath(p: string): string {
  if (!p || p.includes('\0') || p.startsWith('-')) throw new AppError('Invalid path', 'INVALID_ARGUMENT')
  return p
}

/**
 * History of one file across renames (`--follow`), with the file's path at
 * each commit. Output per commit: "\x1e<fields>\0\n<status>\0<path>[\0<new>]\0".
 */
export async function fileHistory(runner: GitRunner, root: string, path: string, limit = 5000): Promise<FileHistoryEntry[]> {
  const r = await runner.run(['log', '--follow', `--format=${LOG_FORMAT}`, '--name-status', '-z', '-M', '-n', String(limit), '--', checkPath(path)], { cwd: root })
  const out: FileHistoryEntry[] = []
  for (const rec of r.stdout.split('\x1e')) {
    if (!rec) continue
    const t = rec.split('\0')
    const commit = parseLogRecord(t.slice(0, 9).join('\0'))
    if (!commit) continue
    const status = (t[9] ?? '').replace(/^\n/, '')
    const code = (status[0] ?? 'M') as FileStatus
    let entry: FileHistoryEntry
    if (code === 'R' || code === 'C') entry = { commit: { ...commit, onCurrentBranch: true }, status: code, oldPath: t[10], path: t[11] ?? path }
    else entry = { commit: { ...commit, onCurrentBranch: true }, status: code, path: t[10] ?? path }
    out.push(entry)
  }
  return out
}

/** `git blame --porcelain`: one entry per line with its commit's author, time and summary. */
export async function blame(runner: GitRunner, root: string, path: string, rev: string | null): Promise<BlameLine[]> {
  const args = ['blame', '--porcelain']
  if (rev) {
    if (rev.startsWith('-')) throw new AppError('Invalid revision', 'INVALID_ARGUMENT')
    args.push(rev)
  }
  args.push('--', checkPath(path))
  const r = await runner.run(args, { cwd: root })
  return parseBlamePorcelain(r.stdout)
}

export function parseBlamePorcelain(text: string): BlameLine[] {
  const info = new Map<string, { author: string; authorTime: number; summary: string; filename: string }>()
  const lines: BlameLine[] = []
  const rows = text.split('\n')
  let i = 0
  while (i < rows.length) {
    const header = rows[i++]
    if (!header) continue
    const m = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/.exec(header)
    if (!m) continue
    const hash = m[1]!
    const finalLine = Number(m[3])
    const meta = info.get(hash) ?? { author: '', authorTime: 0, summary: '', filename: '' }
    while (i < rows.length && !rows[i]!.startsWith('\t')) {
      const row = rows[i++]!
      const sp = row.indexOf(' ')
      const key = sp < 0 ? row : row.slice(0, sp)
      const val = sp < 0 ? '' : row.slice(sp + 1)
      if (key === 'author') meta.author = val
      else if (key === 'author-time') meta.authorTime = Number(val)
      else if (key === 'summary') meta.summary = val
      else if (key === 'filename') meta.filename = val
    }
    info.set(hash, meta)
    const content = (rows[i++] ?? '\t').slice(1)
    lines.push({ hash, line: finalLine, text: content, author: meta.author, authorTime: meta.authorTime, summary: meta.summary, originalPath: meta.filename })
  }
  return lines.sort((a, b) => a.line - b.line)
}
