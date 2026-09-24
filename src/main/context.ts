import type { BrowserWindow } from 'electron'
import type Store from 'electron-store'
import type { Settings } from '@shared/types'
import type { GitService } from './git/GitService'
import type { LogSessions } from './git/log'
import type { GitRunner } from './git/runner'
import type { createRegistry } from './ipcRegistry'
import type { OperationManager } from './operations'
import type { RecentsService } from './repos/RecentsService'
import type { RepoWatcher } from './repos/watcher'
import type { PersistedState } from './store'

/** Everything IPC handler modules need; built once in index.ts. */
export interface MainContext {
  handle: ReturnType<typeof createRegistry>
  runner: GitRunner
  git: GitService
  logs: LogSessions
  ops: OperationManager
  store: Store<PersistedState>
  recents: RecentsService
  watcher: RepoWatcher
  window(): BrowserWindow | null
  requireGit(): void
  settings(): Settings
  /** Tells renderers that repo state changed outside the watcher's view (e.g. after an operation). */
  notifyRepoChanged(root: string): void
}
