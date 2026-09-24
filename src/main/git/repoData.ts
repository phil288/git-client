import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { INDEX, WORKTREE, type CommitDetails, type ContainingRefs, type FileChange, type FileContent, type Ref } from '@shared/types'
import { decodeText } from './encoding'
import { AppError } from './errors'
import { applyNumstat, parseLogRecord, parseNameStatus, parseRefs, REF_FORMAT } from './parsers'
import type { GitRunner } from './runner'

/** Files larger than this are not loaded into the diff viewer. */
export const MAX_DIFF_BYTES = 5 * 1024 * 1024

export async function listRefs(runner: GitRunner, root: string): Promise<Ref[]> {
  const r = await runner.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'], { cwd: root })
  return parseRefs(r.stdout)
}

function assertRev(rev: string): void {
  if (rev.startsWith('-')) throw new AppError(`Invalid revision: ${rev}`, 'INVALID_ARGUMENT')
}

export async function commitDetails(runner: GitRunner, root: string, hash: string): Promise<CommitDetails> {
  assertRev(hash)
  const r = await runner.run(['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%B', hash, '--'], {
    cwd: root
  })
  const f = r.stdout.split('\0')
  const commit = parseLogRecord(f.slice(0, 9).join('\0'))
  if (!commit) throw new AppError(`Unknown commit ${hash}`, 'INVALID_ARGUMENT')
  const message = f.slice(9).join('\0').replace(/\n+$/, '')
  const files = await changedFiles(runner, root, commit.parents[0] ?? null, commit.hash)
  return { commit: { ...commit, onCurrentBranch: false }, message, files }
}

/** Files changed between two revisions (from = null: the root commit's own tree). */
export async function changedFiles(runner: GitRunner, root: string, from: string | null, to: string): Promise<FileChange[]> {
  assertRev(to)
  if (from) assertRev(from)
  const revs = from ? [from, to] : ['--root', to]
  const base = ['diff-tree', '-r', '-z', '-M', '--no-commit-id']
  const [ns, num] = await Promise.all([
    runner.run([...base, '--name-status', ...revs, '--'], { cwd: root }),
    runner.run([...base, '--numstat', ...revs, '--'], { cwd: root })
  ])
  return applyNumstat(parseNameStatus(ns.stdout), num.stdout)
}

/** Changes between a revision and the working tree (tracked files). */
export async function changesAgainstWorktree(runner: GitRunner, root: string, rev: string): Promise<FileChange[]> {
  assertRev(rev)
  const [ns, num] = await Promise.all([
    runner.run(['diff', '-z', '-M', '--name-status', rev, '--'], { cwd: root }),
    runner.run(['diff', '-z', '-M', '--numstat', rev, '--'], { cwd: root })
  ])
  return applyNumstat(parseNameStatus(ns.stdout), num.stdout)
}

export async function containingRefs(runner: GitRunner, root: string, hash: string): Promise<ContainingRefs> {
  assertRev(hash)
  const [b, t] = await Promise.all([
    runner.run(['branch', '-a', '--format=%(refname:short)', '--contains', hash], { cwd: root }),
    runner.run(['tag', '--format=%(refname:short)', '--contains', hash], { cwd: root })
  ])
  const lines = (s: string) => s.split('\n').filter((l) => l && !l.endsWith('/HEAD') && !l.startsWith('('))
  return { branches: lines(b.stdout), tags: lines(t.stdout) }
}

const empty = (extra: Partial<FileContent> = {}): FileContent => ({
  exists: false,
  binary: false,
  tooLarge: false,
  size: 0,
  text: '',
  encoding: 'utf8',
  ...extra
})

/**
 * Content of `path` at `rev`: a commit-ish, WORKTREE, INDEX, or a conflict
 * stage ':1' / ':2' / ':3'.
 */
export async function fileContent(runner: GitRunner, root: string, rev: string, path: string): Promise<FileContent> {
  if (path.includes('\n') || path.startsWith('-')) throw new AppError('Unsupported path', 'INVALID_ARGUMENT')
  if (rev === WORKTREE) {
    const abs = join(root, path)
    try {
      const st = await stat(abs)
      if (st.isDirectory()) return empty({ exists: true, binary: true })
      if (st.size > MAX_DIFF_BYTES) return empty({ exists: true, tooLarge: true, size: st.size })
      const buf = await readFile(abs)
      const d = decodeText(buf)
      return { exists: true, binary: d.binary, tooLarge: false, size: buf.length, text: d.text, encoding: d.encoding }
    } catch {
      return empty()
    }
  }
  assertRev(rev)
  let spec: string
  if (rev === INDEX) spec = `:${path}`
  else if (/^:[0-3]$/.test(rev)) spec = `${rev}:${path}`
  else spec = `${rev}:${path}`

  const check = await runner.run(['cat-file', '--batch-check'], { cwd: root, input: spec + '\n' })
  const line = check.stdout.trim()
  if (line.endsWith(' missing') || line.endsWith(' ambiguous') || line === '') return empty()
  const [oid = '', type = '', sizeStr = '0'] = line.split(' ')
  const size = Number(sizeStr)
  if (type === 'commit') return empty({ exists: true, gitlink: oid })
  if (type !== 'blob') return empty()
  if (size > MAX_DIFF_BYTES) return empty({ exists: true, tooLarge: true, size })
  const blob = await runner.run(['cat-file', 'blob', oid], { cwd: root })
  const d = decodeText(blob.stdoutBuffer)
  return { exists: true, binary: d.binary, tooLarge: false, size, text: d.text, encoding: d.encoding }
}

/** Raw bytes as base64 (image previews for binary conflicts / diffs). */
export async function fileBase64(runner: GitRunner, root: string, rev: string, path: string): Promise<string | null> {
  if (rev === WORKTREE) {
    try {
      const buf = await readFile(join(root, path))
      return buf.length > MAX_DIFF_BYTES ? null : buf.toString('base64')
    } catch {
      return null
    }
  }
  assertRev(rev)
  const spec = rev === INDEX ? `:${path}` : `${rev}:${path}`
  const r = await runner.run(['cat-file', 'blob', spec], { cwd: root, okExitCodes: [0, 128] })
  if (r.exitCode !== 0 || r.stdoutBuffer.length > MAX_DIFF_BYTES) return null
  return r.stdoutBuffer.toString('base64')
}
