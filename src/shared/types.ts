/**
 * IPC contracts shared by main, preload and renderer.
 * Everything that crosses the process boundary is declared here.
 * Keep these plain JSON-serialisable shapes (no classes, no functions, no Dates).
 */

// ---------------------------------------------------------------------------
// Results & errors
// ---------------------------------------------------------------------------

export interface ErrorInfo {
  /** Short human-readable message. */
  message: string
  /** Machine-readable code, e.g. 'GIT_FAILED', 'NOT_A_REPO', 'CANCELLED'. */
  code: ErrorCode
  /** git's stderr, verbatim, when the error came from a git command. */
  stderr?: string
  exitCode?: number | null
  /** Display form of the command that failed, e.g. "git fetch --prune". */
  command?: string
}

export type ErrorCode =
  | 'GIT_FAILED'
  | 'GIT_MISSING'
  | 'NOT_A_REPO'
  | 'PATH_MISSING'
  | 'INVALID_ARGUMENT'
  | 'CANCELLED'
  | 'ALREADY_EXISTS'
  /** Checkout blocked by local changes (offer Smart / Force checkout). */
  | 'LOCAL_CHANGES'
  /** Branch deletion refused: not fully merged (offer force delete). */
  | 'NOT_MERGED'
  /** Working tree must be clean for this operation. */
  | 'DIRTY'
  | 'UNKNOWN'

/** Envelope for every invoke() round-trip. The renderer unwraps it. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: ErrorInfo }

/** Result of a git operation that may partially succeed (used from M4 on). */
export interface OperationResult {
  ok: boolean
  message: string
  stderr?: string
}

// ---------------------------------------------------------------------------
// App / git detection
// ---------------------------------------------------------------------------

export interface AppInfo {
  version: string
  platform: string
  homeDir: string
  userDataDir: string
  isPackaged: boolean
}

export interface GitExecutableInfo {
  path: string
  version: string
  /** major, minor, patch */
  versionParts: [number, number, number]
}

export type GitStatus =
  | { state: 'ok'; git: GitExecutableInfo }
  | { state: 'missing'; searched: string[]; configuredPath: string | null }
  | { state: 'too-old'; git: GitExecutableInfo; minimum: string }

export const MIN_GIT_VERSION: [number, number, number] = [2, 30, 0]

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export type InProgressOp =
  | 'merge'
  | 'rebase'
  | 'am'
  | 'cherry-pick'
  | 'revert'
  | 'bisect'

export interface RepoInfo {
  /** Absolute, normalised working-tree root. */
  root: string
  /** Display name (folder name). */
  name: string
  /** Absolute path of this worktree's git dir (.git or .git/worktrees/x). */
  gitDir: string
  /** Absolute path of the shared git dir (differs from gitDir in linked worktrees). */
  commonDir: string
  isLinkedWorktree: boolean
  /** Working-tree root of the parent repository when this repo is a submodule. */
  superproject: string | null
  /** Short branch name, or null when HEAD is detached / unborn-without-name. */
  branch: string | null
  headSha: string | null
  detached: boolean
  /** True when HEAD points to a branch that has no commits yet. */
  unborn: boolean
  inProgress: InProgressOp[]
}

export type RepoResolution =
  | { kind: 'repo'; root: string }
  | { kind: 'not-repo'; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'bare'; path: string }

export interface RepoQuickStatus {
  path: string
  exists: boolean
  isRepo: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Staged, unstaged or untracked changes present. */
  dirty: boolean
  /** Number of changed entries (staged + unstaged + untracked + conflicted). */
  changedCount: number
}

// ---------------------------------------------------------------------------
// Recents, groups, session, settings (persisted)
// ---------------------------------------------------------------------------

export interface RecentRepo {
  /** Normalised absolute path; unique key (case-insensitive on Windows). */
  path: string
  displayName: string | null
  lastOpened: number
  pinned: boolean
  groupId: string | null
  lastBranch: string | null
}

export interface RepoGroup {
  id: string
  name: string
  collapsed: boolean
}

/** Recents as sent to the renderer, with a cheap existence check. */
export interface RecentRepoView extends RecentRepo {
  exists: boolean
}

export interface RecentsState {
  repos: RecentRepoView[]
  groups: RepoGroup[]
}

export interface TabSession {
  path: string
  /** Opaque per-tab UI state (selected commit, filters, pane sizes...). */
  ui: Record<string, unknown>
}

export interface SessionState {
  tabs: TabSession[]
  activePath: string | null
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface Settings {
  reopenLastSession: boolean
  /** Explicit git executable path; null = auto-detect. */
  gitPath: string | null
  /** Command used for "Open in Editor", e.g. "code" or "idea". The path is appended. */
  editorCommand: string
  /** Command used for "Open in Terminal"; empty = auto-detect. */
  terminalCommand: string
  scanMaxDepth: number
  theme: ThemeSetting
  showConsole: boolean
  consoleHeight: number
  diffSideBySide: boolean
  diffIgnoreWhitespace: boolean
  /** Default for Pull. */
  pullMode: 'merge' | 'rebase' | 'ff-only'
  /** Background `git fetch` interval in minutes; 0 = off. */
  autoFetchMinutes: 0 | 5 | 15
  dateFormat: 'relative' | 'absolute' | 'iso'
  /** Ask before non-destructive network operations (destructive ones always ask). */
  confirmPush: boolean
  checkForUpdates: boolean
  /** External merge tool name for `git mergetool --tool`; '' = git config merge.tool. */
  mergeTool: string
}

export const DEFAULT_SETTINGS: Settings = {
  reopenLastSession: true,
  gitPath: null,
  editorCommand: 'code',
  terminalCommand: '',
  scanMaxDepth: 4,
  theme: 'system',
  showConsole: false,
  consoleHeight: 220,
  diffSideBySide: true,
  diffIgnoreWhitespace: false,
  pullMode: 'merge',
  autoFetchMinutes: 0,
  dateFormat: 'relative',
  confirmPush: true,
  checkForUpdates: true,
  mergeTool: ''
}

// ---------------------------------------------------------------------------
// Operations, progress, scan, clone
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  opId: string
  title: string
  /** Latest progress line (e.g. "Receiving objects: 45% (450/1000)"). */
  message: string
  /** 0..100, or null when indeterminate. */
  percent: number | null
  cancellable: boolean
  done: boolean
  error?: ErrorInfo
}

export interface ScanResult {
  path: string
  name: string
  alreadyInRecents: boolean
}

export interface CloneRequest {
  url: string
  /** Full destination path (parent + folder name). */
  destination: string
  branch?: string
}

// ---------------------------------------------------------------------------
// Git console
// ---------------------------------------------------------------------------

export interface CommandLogEntry {
  id: number
  /** Repo root (or cwd) the command ran in; null for global commands. */
  cwd: string | null
  args: string[]
  startedAt: number
  durationMs: number
  exitCode: number | null
  stderr: string
  cancelled: boolean
  /** Still running; a second entry with the same id replaces it when done. */
  running: boolean
}

// ---------------------------------------------------------------------------
// Renderer <-> main events
// ---------------------------------------------------------------------------

export interface OpenRepoRequest {
  path: string
  /** Open in a new tab (CLI, jump list, second instance) vs replace current. */
  newTab: boolean
}

export type MenuCommand =
  | 'open-folder'
  | 'clone'
  | 'new-repo'
  | 'scan'
  | 'welcome'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'quick-switcher'
  | 'toggle-console'
  | { type: 'goto-tab'; index: number }
  | { type: 'open-recent'; path: string }

// ---------------------------------------------------------------------------
// Log / commits (M2, M3)
// ---------------------------------------------------------------------------

export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Unix seconds. */
  authorTime: number
  committerName: string
  committerEmail: string
  committerTime: number
  subject: string
  /** Reachable from HEAD (commits not on the current branch are dimmed). */
  onCurrentBranch: boolean
}

export interface LogQuery {
  /** Revisions to walk; empty = all branches, remotes, tags and HEAD. */
  revs: string[]
  /** Message search (git --grep). */
  text?: string
  regex?: boolean
  matchCase?: boolean
  /** Author patterns (ORed). */
  authors?: string[]
  /** ISO dates or git approxidate ("2 weeks ago"). */
  since?: string
  until?: string
  /** Only commits touching these repo-relative paths. */
  paths?: string[]
  /** Follow renames (single file history). */
  follow?: boolean
}

export interface LogPage {
  commits: Commit[]
  done: boolean
}

export type RefKind = 'local' | 'remote' | 'tag'

export interface Ref {
  /** Full name, e.g. refs/heads/main. */
  name: string
  /** Display name, e.g. main, origin/main, v1.0. */
  short: string
  kind: RefKind
  /** Commit the ref points to (tags peeled). */
  hash: string
  /** Remote name for remote-tracking branches. */
  remote?: string
  /** Short upstream name for local branches (origin/main). */
  upstream?: string
  ahead: number
  behind: number
  /** Upstream configured but deleted on the remote. */
  upstreamGone: boolean
  /** Currently checked-out branch. */
  isHead: boolean
  /** Annotated tag (has its own object). */
  annotated?: boolean
  /** Committer date (unix seconds) of the tip. */
  date: number
  subject: string
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatus
  /** null for binary files. */
  additions: number | null
  deletions: number | null
}

export interface CommitDetails {
  commit: Commit
  /** Full message including subject. */
  message: string
  files: FileChange[]
}

export interface ContainingRefs {
  branches: string[]
  tags: string[]
}

/** Special revision names for file contents. */
export const WORKTREE = ':worktree'
export const INDEX = ':index'

export interface FileContent {
  exists: boolean
  binary: boolean
  tooLarge: boolean
  size: number
  /** Decoded text ('' for binary / missing / too large). */
  text: string
  /** Encoding used to decode, re-used when saving. */
  encoding: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'latin1'
  /** Submodule (gitlink) entry: the commit SHA. */
  gitlink?: string
}

export interface FileDiffSide {
  rev: string | null
  path: string
}

// ---------------------------------------------------------------------------
// Branch operations (M4)
// ---------------------------------------------------------------------------

export type MergeMode = 'default' | 'no-ff' | 'ff-only' | 'squash'
export type PullMode = 'merge' | 'rebase' | 'ff-only'

export interface CompareResult {
  /** Commits in `a` but not in `b`. */
  onlyA: Commit[]
  onlyB: Commit[]
  files: FileChange[]
}

/** Per-repository preferences (persisted in the app state file). */
export interface RepoPrefs {
  favorites: string[]
  recentMessages: string[]
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

// ---------------------------------------------------------------------------
// History rewriting (M5)
// ---------------------------------------------------------------------------

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface RebaseTodoItem {
  action: RebaseAction
  hash: string
  subject: string
  /** New message for reword / squash (squash: the combined message). */
  message?: string
}

export interface RewritePlan {
  /** Commit whose descendants are rewritten (the rebase base); null = root. */
  base: string | null
  /** Oldest first. */
  items: RebaseTodoItem[]
  /** Use --autostash for a dirty working tree. */
  autostash?: boolean
  /** Required when the range contains merge commits. */
  rebaseMerges?: boolean
}

export interface RewriteCheck {
  dirty: boolean
  containsMerges: boolean
  /** Some rewritten commits are already on the upstream (force push needed). */
  pushed: boolean
  upstream: string | null
  branch: string | null
}

export interface BackupEntry {
  ref: string
  branch: string
  hash: string
  time: number
  operation: string
}

export interface ReflogEntry {
  hash: string
  selector: string
  message: string
  time: number
}

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

/** Result of an operation that can stop on conflicts. */
export interface OpOutcome {
  status: 'ok' | 'conflicts' | 'stopped'
  message: string
}

// ---------------------------------------------------------------------------
// Local changes (M6)
// ---------------------------------------------------------------------------

export interface StatusEntry {
  path: string
  origPath?: string
  /** Index (staged) status char from porcelain v2, '.' = unchanged. */
  index: string
  /** Worktree status char, '.' = unchanged. */
  worktree: string
  untracked: boolean
  conflicted: boolean
  /** Unmerged XY code (UU, AA, DU...) for conflicts. */
  conflictCode?: string
  submodule: boolean
}

export interface WorkingStatus {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  entries: StatusEntry[]
}

export interface DiffLine {
  kind: ' ' | '+' | '-'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  /** 'staged' hunks come from diff --cached, 'unstaged' from diff (worktree vs index). */
  source: 'staged' | 'unstaged'
  /** Stable id: source + index within the file diff. */
  id: string
}

export interface FileHunks {
  path: string
  binary: boolean
  staged: DiffHunk[]
  unstaged: DiffHunk[]
  /** Raw patch header lines (diff --git ..., ---, +++) per source. */
  headers: { staged: string[]; unstaged: string[] }
}

export interface OutgoingBranch {
  branch: string
  remote: string
  remoteBranch: string
  hasUpstream: boolean
  commits: Commit[]
}

export interface PushOptions {
  remote: string
  branch: string
  remoteBranch: string
  setUpstream: boolean
  forceWithLease: boolean
  tags: boolean
}

// ---------------------------------------------------------------------------
// Stash, history, blame (M7)
// ---------------------------------------------------------------------------

export interface StashEntry {
  index: number
  ref: string
  hash: string
  message: string
  time: number
}

export interface BlameLine {
  hash: string
  line: number
  text: string
  author: string
  authorTime: number
  summary: string
  originalPath: string
}

export interface FileHistoryEntry {
  commit: Commit
  /** Path of the file in this commit (changes across renames). */
  path: string
  status: FileStatus
  oldPath?: string
}

// ---------------------------------------------------------------------------
// Conflicts (M8)
// ---------------------------------------------------------------------------

export type ConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash' | 'unknown'

export type SideAction = 'modified' | 'added' | 'deleted' | 'renamed' | 'unchanged'

export type ConflictType =
  | 'content'
  | 'add-add'
  | 'modify-delete'
  | 'delete-modify'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'binary'
  | 'submodule'

export interface SideLabel {
  /** Always "Yours" or "Theirs" (stage 2 / stage 3). */
  role: 'Yours' | 'Theirs'
  /** Branch name or short description, e.g. "main". */
  name: string
  /** Context, e.g. "upstream", "current branch", "your commit 'Fix login'". */
  detail: string
}

export interface ConflictState {
  operation: ConflictOperation
  /** Human summary, e.g. "Rebasing feature/x onto main". */
  title: string
  step: number | null
  totalSteps: number | null
  yours: SideLabel
  theirs: SideLabel
  files: ConflictFile[]
  /** Operation supports --skip. */
  canSkip: boolean
  /** Merge / squash commits need a message on continue. */
  needsMessage: boolean
  defaultMessage: string
}

export interface ConflictFile {
  path: string
  code: string
  type: ConflictType
  yours: SideAction
  theirs: SideAction
  binary: boolean
  submodule: boolean
  /** Worktree file no longer contains conflict markers. */
  markersResolved: boolean
}

export interface ConflictVersions {
  path: string
  base: FileContent
  yours: FileContent
  theirs: FileContent
  worktree: FileContent
  eol: '\n' | '\r\n'
  finalNewline: boolean
}

export interface MergePreview {
  supported: boolean
  conflicts: string[]
  clean: boolean
}

// ---------------------------------------------------------------------------
// Updates (M10)
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  current: string
  latest: string | null
  available: boolean
  /** How the app was installed; decides the update flow. */
  channel: 'windows-nsis' | 'linux-deb' | 'linux-user' | 'linux-appimage' | 'dev' | 'unknown'
  releaseUrl: string
  /** Linux: shell command that upgrades in place. */
  updateCommand?: string
  error?: string
}
