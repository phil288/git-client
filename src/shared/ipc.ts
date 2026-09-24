import type {
  AppInfo,
  CommitDetails,
  ContainingRefs,
  Commit,
  BackupEntry,
  BlameLine,
  CompareResult,
  ConflictState,
  ConflictVersions,
  MergePreview,
  FileHistoryEntry,
  StashEntry,
  FileHunks,
  WorkingStatus,
  OperationState,
  ReflogEntry,
  ResetMode,
  RewriteCheck,
  RewritePlan,
  UpdateInfo,
  FileChange,
  MergeMode,
  OpOutcome,
  PullMode,
  PushOptions,
  Remote,
  RepoPrefs,
  FileContent,
  LogPage,
  LogQuery,
  Ref,
  CloneRequest,
  CommandLogEntry,
  GitStatus,
  IpcResult,
  MenuCommand,
  OpenRepoRequest,
  ProgressEvent,
  RecentsState,
  RepoInfo,
  RepoQuickStatus,
  RepoResolution,
  RepoGroup,
  ScanResult,
  SessionState,
  Settings,
  WorktreeEntry,
  WorktreeForce,
  WorktreeMergeResult
} from './types'

/**
 * Request/response channels: channel name -> [argument tuple, result].
 * Main registers exactly these handlers; preload refuses any other channel.
 */
export interface IpcInvokeMap {
  'app:getInfo': [[], AppInfo]
  /**
   * Repos requested before the renderer was ready (command line, jump list).
   * Calling this also marks the renderer as ready for live 'app:openRepo' events.
   */
  'app:takePendingOpens': [[], OpenRepoRequest[]]

  'git:getStatus': [[], GitStatus]
  'git:recheck': [[], GitStatus]
  /** Opens a native file picker for the git executable and re-checks. */
  'git:pickExecutable': [[], GitStatus]

  'repo:resolve': [[path: string], RepoResolution]
  'repo:info': [[root: string], RepoInfo]
  'repo:quickStatus': [[path: string], RepoQuickStatus]
  'repo:init': [[path: string], RepoResolution]
  /**
   * Clones and resolves with the new repo root. `opId` is chosen by the
   * renderer so it can cancel ('ops:cancel') while the call is pending;
   * progress arrives on 'op:progress'.
   */
  'repo:clone': [[request: CloneRequest, opId: string], string]
  'repo:watch': [[root: string], void]
  'repo:unwatch': [[root: string], void]

  'recents:list': [[], RecentsState]
  'recents:touch': [[path: string, branch: string | null], RecentsState]
  'recents:remove': [[paths: string[]], RecentsState]
  'recents:setPinned': [[path: string, pinned: boolean], RecentsState]
  'recents:rename': [[path: string, displayName: string | null], RecentsState]
  'recents:moveToGroup': [[path: string, groupId: string | null], RecentsState]
  'recents:locate': [[oldPath: string, newPath: string], RecentsState]
  'recents:removeMissing': [[], RecentsState]
  'recents:clear': [[], RecentsState]
  'recents:addMany': [[paths: string[], groupId: string | null], RecentsState]

  'groups:create': [[name: string], RepoGroup]
  'groups:rename': [[id: string, name: string], RecentsState]
  'groups:delete': [[id: string], RecentsState]
  'groups:setCollapsed': [[id: string, collapsed: boolean], RecentsState]

  'scan:start': [[root: string, maxDepth: number, opId: string], ScanResult[]]

  'ops:cancel': [[opId: string], void]

  'session:get': [[], SessionState]
  'session:save': [[state: SessionState], void]

  'settings:get': [[], Settings]
  'settings:update': [[patch: Partial<Settings>], Settings]

  'dialog:pickFolder': [[title: string, defaultPath?: string], string | null]

  'shell:openInFileManager': [[path: string], void]
  'shell:openInTerminal': [[path: string], void]
  'shell:openInEditor': [[path: string], void]
  'shell:copyText': [[text: string], void]
  'shell:openExternal': [[url: string], void]

  'console:list': [[], CommandLogEntry[]]
  'console:clear': [[], void]

  // M2 — log
  'log:open': [[root: string, query: LogQuery], string]
  'log:next': [[sessionId: string, count: number], LogPage]
  'log:close': [[sessionId: string], void]
  'repo:refs': [[root: string], Ref[]]
  'repo:commitDetails': [[root: string, hash: string], CommitDetails]
  /** Files changed between two revisions; from = null diffs against the empty tree (root commit). */
  'repo:changes': [[root: string, from: string | null, to: string], FileChange[]]
  'repo:changesVsWorktree': [[root: string, rev: string], FileChange[]]
  'repo:containing': [[root: string, hash: string], ContainingRefs]
  /** rev: commit-ish, ':worktree', ':index', or a conflict stage ':1' / ':2' / ':3'. */
  'repo:fileContent': [[root: string, rev: string, path: string], FileContent]
  'repo:fileBase64': [[root: string, rev: string, path: string], string | null]

  // M3 — filters / navigation
  /** Resolves a hash prefix, branch or tag to a full commit hash (null if unknown). */
  'repo:resolveRev': [[root: string, rev: string], string | null]
  'repo:config': [[root: string, key: string], string | null]
  /** Native picker for files and/or folders; returns absolute paths. */
  'dialog:pickPaths': [[title: string, defaultPath: string, kind: 'files' | 'folders'], string[]]

  // M4 — branches & remotes. Network ops take a renderer-chosen opId (progress + cancel).
  'branch:checkout': [[root: string, target: string, opts: { force?: boolean; detach?: boolean }], void]
  'branch:smartCheckout': [[root: string, target: string, opts: { detach?: boolean }], OpOutcome]
  'branch:checkoutRemote': [[root: string, remoteBranch: string, localName: string, opts: { force?: boolean; smart?: boolean }], OpOutcome]
  'branch:create': [[root: string, name: string, start: string, checkout: boolean], void]
  'branch:checkName': [[root: string, name: string], boolean]
  'branch:rename': [[root: string, oldName: string, newName: string, renameRemote: boolean, opId: string], void]
  /** Returns the deleted branch's SHA (for Restore). */
  'branch:delete': [[root: string, name: string, force: boolean], string]
  'branch:restore': [[root: string, name: string, sha: string], void]
  'branch:deleteRemote': [[root: string, remote: string, branch: string, opId: string], void]
  'branch:deleteRemoteMany': [[root: string, remote: string, branches: string[], opId: string], void]
  'branch:setUpstream': [[root: string, branch: string, upstream: string | null], void]
  'branch:merge': [[root: string, ref: string, mode: MergeMode], OpOutcome]
  'branch:rebase': [[root: string, onto: string, branch: string | null], OpOutcome]
  'branch:compare': [[root: string, a: string, b: string], CompareResult]
  'branch:recent': [[root: string], string[]]
  'remote:list': [[root: string], Remote[]]
  'remote:fetch': [[root: string, remote: string | null, prune: boolean, opId: string], void]
  'remote:pull': [[root: string, mode: PullMode, opId: string], OpOutcome]
  'remote:push': [[root: string, options: PushOptions, opId: string], void]
  'remote:outgoing': [[root: string, branch: string, remote: string, remoteBranch: string], Commit[]]
  'prefs:get': [[root: string], RepoPrefs]
  'prefs:update': [[root: string, patch: Partial<RepoPrefs>], RepoPrefs]

  // M5 — history rewriting & in-progress operations
  /** Commits base..HEAD oldest first, with full messages (base null = from the root). */
  'rewrite:commits': [[root: string, base: string | null], (Commit & { message: string })[]]
  'rewrite:check': [[root: string, base: string | null, hashes: string[]], RewriteCheck]
  'rewrite:run': [[root: string, plan: RewritePlan, operation: string], OpOutcome]
  'rewrite:amendHead': [[root: string, message: string], void]
  'rewrite:reset': [[root: string, target: string, mode: ResetMode], void]
  'rewrite:undoCommit': [[root: string], void]
  'rewrite:cherryPick': [[root: string, hashes: string[]], OpOutcome]
  'rewrite:revert': [[root: string, hashes: string[]], OpOutcome]
  'rewrite:patch': [[root: string, hashes: string[]], string]
  'rewrite:reflog': [[root: string], ReflogEntry[]]
  'rewrite:backups': [[root: string], BackupEntry[]]
  'rewrite:undoLast': [[root: string, hard: boolean], { ref: string; operation: string }]
  'op:state': [[root: string], OperationState]
  'op:continue': [[root: string, message: string | null], OpOutcome]
  'op:skip': [[root: string], OpOutcome]
  'op:abort': [[root: string], OpOutcome]
  /** Save dialog + write; returns the chosen path or null. */
  'dialog:saveText': [[title: string, defaultName: string, content: string], string | null]

  // M6 — local changes & commit
  'wt:status': [[root: string], WorkingStatus]
  'wt:hunks': [[root: string, path: string], FileHunks]
  'wt:stage': [[root: string, paths: string[]], void]
  'wt:unstage': [[root: string, paths: string[]], void]
  'wt:discard': [[root: string, paths: string[]], void]
  'wt:stageHunks': [[root: string, path: string, hunkIds: string[]], void]
  'wt:unstageHunks': [[root: string, path: string, hunkIds: string[]], void]
  'wt:discardHunks': [[root: string, path: string, hunkIds: string[]], void]
  /** Commits the index; returns the new HEAD. Records the message in recent messages. */
  'wt:commit': [[root: string, message: string, options: { amend: boolean; signOff: boolean }], string]
  'wt:lastMessage': [[root: string], string]

  // M7 — stash, history, blame, tags, remotes
  'stash:list': [[root: string], StashEntry[]]
  'stash:files': [[root: string, index: number], { files: FileChange[]; untracked: FileChange[]; base: string; hash: string; untrackedCommit: string | null }]
  'stash:push': [[root: string, message: string, includeUntracked: boolean, keepIndex: boolean], void]
  'stash:apply': [[root: string, index: number, reinstateIndex: boolean], OpOutcome]
  'stash:pop': [[root: string, index: number, reinstateIndex: boolean], OpOutcome]
  'stash:drop': [[root: string, index: number], void]
  'stash:branch': [[root: string, name: string, index: number], void]
  'history:file': [[root: string, path: string], FileHistoryEntry[]]
  'history:blame': [[root: string, path: string, rev: string | null], BlameLine[]]
  'tag:create': [[root: string, name: string, target: string, message: string | null], void]
  'tag:delete': [[root: string, name: string], void]
  'tag:push': [[root: string, remote: string, name: string, opId: string], void]
  'tag:deleteRemote': [[root: string, remote: string, name: string, opId: string], void]
  'remote:add': [[root: string, name: string, url: string], void]
  'remote:setUrl': [[root: string, name: string, url: string, push: boolean], void]
  'remote:remove': [[root: string, name: string], void]
  'remote:rename': [[root: string, oldName: string, newName: string], void]
  'remote:prune': [[root: string, name: string, opId: string], void]

  // Worktrees
  'worktree:list': [[root: string], WorktreeEntry[]]
  /** Free sibling path `<main>-<slug>` for a new worktree named after `name`. */
  'worktree:suggestPath': [[root: string, name: string], string]
  'worktree:defaultBranch': [[root: string], string | null]
  /** newBranch null checks out `start`; returns the new worktree's normalised path. */
  'worktree:add': [[root: string, path: string, start: string, newBranch: string | null], string]
  'worktree:remove': [[root: string, path: string, force: WorktreeForce], void]
  'worktree:lock': [[root: string, path: string, reason: string | null], void]
  'worktree:unlock': [[root: string, path: string], void]
  'worktree:prune': [[root: string], void]
  'worktree:mergeInto': [[root: string, source: string, target: string, mode: MergeMode], WorktreeMergeResult]

  // M8 — conflicts
  'conflicts:state': [[root: string], ConflictState]
  'conflicts:versions': [[root: string, path: string], ConflictVersions]
  'conflicts:acceptSide': [[root: string, paths: string[], side: 'yours' | 'theirs'], void]
  'conflicts:resolveSubmodule': [[root: string, path: string, sha: string], void]
  'conflicts:markResolved': [[root: string, paths: string[]], void]
  'conflicts:delete': [[root: string, paths: string[]], void]
  /** Writes the merge result in the file's original encoding and stages it. */
  'conflicts:save': [[root: string, path: string, text: string, encoding: FileContent['encoding']], void]
  'conflicts:autoResolve': [[root: string, paths: string[] | null], { resolved: string[]; remaining: { path: string; conflicts: number }[] }]
  'conflicts:mergeTool': [[root: string, path: string], void]
  'conflicts:preview': [[root: string, ref: string], MergePreview]
  'conflicts:getRerere': [[root: string], boolean]
  'conflicts:setRerere': [[root: string, enabled: boolean], void]
  'conflicts:configuredTool': [[root: string], string | null]

  // M9 — OS integration
  'os:integration': [[], { platform: string; explorerMenu: boolean | null; fileManagerScripts: { nautilus: boolean | null; nemo: boolean | null } | null }]
  'os:setExplorerMenu': [[enable: boolean], void]
  'os:setFileManagerScripts': [[enable: boolean], void]

  // M10 — updates
  'update:check': [[], UpdateInfo]
  /** Windows only: download the update and restart into it. */
  'update:install': [[opId: string], void]
}

/** Main -> renderer push events. */
export interface IpcEventMap {
  'console:entry': CommandLogEntry
  'op:progress': ProgressEvent
  'repo:changed': { root: string }
  'recents:changed': RecentsState
  'app:openRepo': OpenRepoRequest
  'menu:command': MenuCommand
  'git:statusChanged': GitStatus
}

export type InvokeChannel = keyof IpcInvokeMap
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeMap[C][0]
export type InvokeResult<C extends InvokeChannel> = IpcInvokeMap[C][1]
export type EventChannel = keyof IpcEventMap

/**
 * Runtime allowlists. `satisfies` keeps them in sync with the maps above:
 * adding a channel to a map without listing it here is a type error.
 */
const invokeChannelRecord = {
  'app:getInfo': true,
  'app:takePendingOpens': true,
  'git:getStatus': true,
  'git:recheck': true,
  'git:pickExecutable': true,
  'repo:resolve': true,
  'repo:info': true,
  'repo:quickStatus': true,
  'repo:init': true,
  'repo:clone': true,
  'repo:watch': true,
  'repo:unwatch': true,
  'recents:list': true,
  'recents:touch': true,
  'recents:remove': true,
  'recents:setPinned': true,
  'recents:rename': true,
  'recents:moveToGroup': true,
  'recents:locate': true,
  'recents:removeMissing': true,
  'recents:clear': true,
  'recents:addMany': true,
  'groups:create': true,
  'groups:rename': true,
  'groups:delete': true,
  'groups:setCollapsed': true,
  'scan:start': true,
  'ops:cancel': true,
  'session:get': true,
  'session:save': true,
  'settings:get': true,
  'settings:update': true,
  'dialog:pickFolder': true,
  'shell:openInFileManager': true,
  'shell:openInTerminal': true,
  'shell:openInEditor': true,
  'shell:copyText': true,
  'shell:openExternal': true,
  'console:list': true,
  'console:clear': true,
  'log:open': true,
  'log:next': true,
  'log:close': true,
  'repo:refs': true,
  'repo:commitDetails': true,
  'repo:changes': true,
  'repo:changesVsWorktree': true,
  'repo:containing': true,
  'repo:fileContent': true,
  'repo:fileBase64': true,
  'repo:resolveRev': true,
  'repo:config': true,
  'dialog:pickPaths': true,
  'branch:checkout': true,
  'branch:smartCheckout': true,
  'branch:checkoutRemote': true,
  'branch:create': true,
  'branch:checkName': true,
  'branch:rename': true,
  'branch:delete': true,
  'branch:restore': true,
  'branch:deleteRemote': true,
  'branch:deleteRemoteMany': true,
  'branch:setUpstream': true,
  'branch:merge': true,
  'branch:rebase': true,
  'branch:compare': true,
  'branch:recent': true,
  'remote:list': true,
  'remote:fetch': true,
  'remote:pull': true,
  'remote:push': true,
  'remote:outgoing': true,
  'prefs:get': true,
  'prefs:update': true,
  'rewrite:commits': true,
  'rewrite:check': true,
  'rewrite:run': true,
  'rewrite:amendHead': true,
  'rewrite:reset': true,
  'rewrite:undoCommit': true,
  'rewrite:cherryPick': true,
  'rewrite:revert': true,
  'rewrite:patch': true,
  'rewrite:reflog': true,
  'rewrite:backups': true,
  'rewrite:undoLast': true,
  'op:state': true,
  'op:continue': true,
  'op:skip': true,
  'op:abort': true,
  'dialog:saveText': true,
  'wt:status': true,
  'wt:hunks': true,
  'wt:stage': true,
  'wt:unstage': true,
  'wt:discard': true,
  'wt:stageHunks': true,
  'wt:unstageHunks': true,
  'wt:discardHunks': true,
  'wt:commit': true,
  'wt:lastMessage': true,
  'stash:list': true,
  'stash:files': true,
  'stash:push': true,
  'stash:apply': true,
  'stash:pop': true,
  'stash:drop': true,
  'stash:branch': true,
  'history:file': true,
  'history:blame': true,
  'tag:create': true,
  'tag:delete': true,
  'tag:push': true,
  'tag:deleteRemote': true,
  'remote:add': true,
  'remote:setUrl': true,
  'remote:remove': true,
  'remote:rename': true,
  'remote:prune': true,
  'worktree:list': true,
  'worktree:suggestPath': true,
  'worktree:defaultBranch': true,
  'worktree:add': true,
  'worktree:remove': true,
  'worktree:lock': true,
  'worktree:unlock': true,
  'worktree:prune': true,
  'worktree:mergeInto': true,
  'conflicts:state': true,
  'conflicts:versions': true,
  'conflicts:acceptSide': true,
  'conflicts:resolveSubmodule': true,
  'conflicts:markResolved': true,
  'conflicts:delete': true,
  'conflicts:save': true,
  'conflicts:autoResolve': true,
  'conflicts:mergeTool': true,
  'conflicts:preview': true,
  'conflicts:getRerere': true,
  'conflicts:setRerere': true,
  'conflicts:configuredTool': true,
  'os:integration': true,
  'os:setExplorerMenu': true,
  'os:setFileManagerScripts': true,
  'update:check': true,
  'update:install': true
} as const satisfies Record<InvokeChannel, true>

const eventChannelRecord = {
  'console:entry': true,
  'op:progress': true,
  'repo:changed': true,
  'recents:changed': true,
  'app:openRepo': true,
  'menu:command': true,
  'git:statusChanged': true
} as const satisfies Record<EventChannel, true>

export const INVOKE_CHANNELS = Object.keys(invokeChannelRecord) as InvokeChannel[]
export const EVENT_CHANNELS = Object.keys(eventChannelRecord) as EventChannel[]

/** Shape of the object preload exposes as `window.bridge`. */
export interface Bridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcResult<InvokeResult<C>>>
  on<E extends EventChannel>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void
  /** Absolute filesystem path of a dropped File (Electron webUtils). */
  getPathForFile(file: File): string
  platform: string
}
