import { join, relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

/** Top-level entries of a git dir that never affect what the UI shows. */
const IGNORED_TOP = new Set(['objects', 'logs', 'hooks', 'info', 'lfs', 'modules', 'worktrees', 'fsmonitor--daemon', 'description'])

interface WatchEntry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

/**
 * Watches .git/HEAD, refs, index, packed-refs and in-progress markers of each
 * open repo and emits a debounced change notification. Working-tree changes
 * are not watched here (that arrives with Local Changes in M6).
 */
export class RepoWatcher {
  private readonly entries = new Map<string, WatchEntry>()

  constructor(
    private readonly onChange: (root: string) => void,
    private readonly debounceMs = 300
  ) {}

  watch(root: string, gitDir: string, commonDir: string): void {
    // Idempotent: a renderer reload re-registers every open tab.
    if (this.entries.has(root)) return
    const ignored = (path: string): boolean => {
      if (path.endsWith('.lock')) return true
      for (const base of [gitDir, commonDir]) {
        const rel = relative(base, path)
        if (rel === '' || rel.startsWith('..')) continue
        const top = rel.split(sep)[0] ?? ''
        if (IGNORED_TOP.has(top)) return true
      }
      return false
    }
    const targets = gitDir === commonDir ? [gitDir] : [gitDir, join(commonDir, 'refs'), join(commonDir, 'packed-refs')]
    const watcher = watch(targets, {
      ignoreInitial: true,
      ignored,
      depth: 8,
      awaitWriteFinish: false,
      followSymlinks: false
    })
    const entry: WatchEntry = { watcher, timer: null }
    const fire = (): void => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        this.onChange(root)
      }, this.debounceMs)
    }
    watcher.on('all', fire)
    watcher.on('error', () => undefined)
    this.entries.set(root, entry)
  }

  unwatch(root: string): void {
    const entry = this.entries.get(root)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    void entry.watcher.close()
    this.entries.delete(root)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.watcher.close()))
    this.entries.clear()
  }
}
