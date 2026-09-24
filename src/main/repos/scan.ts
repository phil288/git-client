import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../git/errors'

/** Folders never descended into while scanning. */
export const SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.venv',
  'venv',
  'vendor',
  'build',
  'dist',
  'out',
  'target',
  '__pycache__',
  '.cache',
  '.gradle',
  '.tox',
  '.next',
  '.nuxt',
  'bower_components',
  '.Trash',
  '$RECYCLE.BIN',
  'System Volume Information'
])

export interface ScanOptions {
  maxDepth: number
  signal?: AbortSignal
  onProgress?: (dirsVisited: number, current: string) => void
}

/**
 * Breadth-first search for git working trees under `root`. A directory is a
 * repo when it contains a `.git` entry (folder, or file for worktrees and
 * submodules). Repos are not descended into; symlinks are not followed.
 * Depth 0 = only `root` itself.
 */
export async function scanForRepos(root: string, opts: ScanOptions): Promise<string[]> {
  const found: string[] = []
  let queue: string[] = [root]
  let visited = 0
  for (let depth = 0; depth <= opts.maxDepth && queue.length > 0; depth++) {
    const next: string[] = []
    for (const dir of queue) {
      if (opts.signal?.aborted) throw new AppError('Scan cancelled', 'CANCELLED')
      visited++
      opts.onProgress?.(visited, dir)
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue // permission denied, vanished, etc.
      }
      if (entries.some((e) => e.name === '.git' && (e.isDirectory() || e.isFile()))) {
        found.push(dir)
        continue
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue
        if (SCAN_SKIP_DIRS.has(e.name)) continue
        next.push(join(dir, e.name))
      }
    }
    queue = next
  }
  return found.sort((a, b) => a.localeCompare(b))
}
