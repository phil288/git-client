import type {
  AppInfo,
  CommitDetails,
  ContainingRefs,
  Commit,
  CompareResult,
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
  Settings
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
  'prefs:update': true
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
