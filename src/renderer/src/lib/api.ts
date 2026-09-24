import type { EventChannel, InvokeArgs, InvokeChannel, InvokeResult, IpcEventMap } from '@shared/ipc'
import type { CloneRequest, ErrorInfo, LogQuery, MergeMode, PullMode, PushOptions, RepoGroup, RepoPrefs, SessionState, Settings } from '@shared/types'

/** Error carrying git's stderr and the failed command across IPC. */
export class ApiError extends Error {
  constructor(readonly info: ErrorInfo) {
    super(info.message)
    this.name = 'ApiError'
  }
}

async function call<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  const res = await window.bridge.invoke(channel, ...args)
  if (!res.ok) throw new ApiError(res.error)
  return res.value
}

export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) return err.info
  return { message: err instanceof Error ? err.message : String(err), code: 'UNKNOWN' }
}

/** Typed facade over the preload bridge. The renderer's only way to reach main. */
export const api = {
  app: {
    getInfo: () => call('app:getInfo'),
    takePendingOpens: () => call('app:takePendingOpens')
  },
  git: {
    getStatus: () => call('git:getStatus'),
    recheck: () => call('git:recheck'),
    pickExecutable: () => call('git:pickExecutable')
  },
  repo: {
    resolve: (path: string) => call('repo:resolve', path),
    info: (root: string) => call('repo:info', root),
    quickStatus: (path: string) => call('repo:quickStatus', path),
    init: (path: string) => call('repo:init', path),
    clone: (request: CloneRequest, opId: string) => call('repo:clone', request, opId),
    watch: (root: string) => call('repo:watch', root),
    unwatch: (root: string) => call('repo:unwatch', root),
    refs: (root: string) => call('repo:refs', root),
    commitDetails: (root: string, hash: string) => call('repo:commitDetails', root, hash),
    changes: (root: string, from: string | null, to: string) => call('repo:changes', root, from, to),
    changesVsWorktree: (root: string, rev: string) => call('repo:changesVsWorktree', root, rev),
    containing: (root: string, hash: string) => call('repo:containing', root, hash),
    fileContent: (root: string, rev: string, path: string) => call('repo:fileContent', root, rev, path),
    fileBase64: (root: string, rev: string, path: string) => call('repo:fileBase64', root, rev, path),
    resolveRev: (root: string, rev: string) => call('repo:resolveRev', root, rev),
    config: (root: string, key: string) => call('repo:config', root, key)
  },
  branch: {
    checkout: (root: string, target: string, opts: { force?: boolean; detach?: boolean } = {}) => call('branch:checkout', root, target, opts),
    smartCheckout: (root: string, target: string, opts: { detach?: boolean } = {}) => call('branch:smartCheckout', root, target, opts),
    checkoutRemote: (root: string, remoteBranch: string, localName: string, opts: { force?: boolean; smart?: boolean } = {}) =>
      call('branch:checkoutRemote', root, remoteBranch, localName, opts),
    create: (root: string, name: string, start: string, checkout: boolean) => call('branch:create', root, name, start, checkout),
    checkName: (root: string, name: string) => call('branch:checkName', root, name),
    rename: (root: string, oldName: string, newName: string, renameRemote: boolean, opId: string) =>
      call('branch:rename', root, oldName, newName, renameRemote, opId),
    delete: (root: string, name: string, force: boolean) => call('branch:delete', root, name, force),
    restore: (root: string, name: string, sha: string) => call('branch:restore', root, name, sha),
    deleteRemote: (root: string, remote: string, branch: string, opId: string) => call('branch:deleteRemote', root, remote, branch, opId),
    setUpstream: (root: string, branch: string, upstream: string | null) => call('branch:setUpstream', root, branch, upstream),
    merge: (root: string, ref: string, mode: MergeMode) => call('branch:merge', root, ref, mode),
    rebase: (root: string, onto: string, branch: string | null) => call('branch:rebase', root, onto, branch),
    compare: (root: string, a: string, b: string) => call('branch:compare', root, a, b),
    recent: (root: string) => call('branch:recent', root)
  },
  remote: {
    list: (root: string) => call('remote:list', root),
    fetch: (root: string, remote: string | null, prune: boolean, opId: string) => call('remote:fetch', root, remote, prune, opId),
    pull: (root: string, mode: PullMode, opId: string) => call('remote:pull', root, mode, opId),
    push: (root: string, options: PushOptions, opId: string) => call('remote:push', root, options, opId),
    outgoing: (root: string, branch: string, remote: string, remoteBranch: string) => call('remote:outgoing', root, branch, remote, remoteBranch)
  },
  prefs: {
    get: (root: string) => call('prefs:get', root),
    update: (root: string, patch: Partial<RepoPrefs>) => call('prefs:update', root, patch)
  },
  log: {
    open: (root: string, query: LogQuery) => call('log:open', root, query),
    next: (id: string, count: number) => call('log:next', id, count),
    close: (id: string) => call('log:close', id)
  },
  recents: {
    list: () => call('recents:list'),
    touch: (path: string, branch: string | null) => call('recents:touch', path, branch),
    remove: (paths: string[]) => call('recents:remove', paths),
    setPinned: (path: string, pinned: boolean) => call('recents:setPinned', path, pinned),
    rename: (path: string, name: string | null) => call('recents:rename', path, name),
    moveToGroup: (path: string, groupId: string | null) => call('recents:moveToGroup', path, groupId),
    locate: (oldPath: string, newPath: string) => call('recents:locate', oldPath, newPath),
    removeMissing: () => call('recents:removeMissing'),
    clear: () => call('recents:clear'),
    addMany: (paths: string[], groupId: string | null) => call('recents:addMany', paths, groupId)
  },
  groups: {
    create: (name: string): Promise<RepoGroup> => call('groups:create', name),
    rename: (id: string, name: string) => call('groups:rename', id, name),
    delete: (id: string) => call('groups:delete', id),
    setCollapsed: (id: string, collapsed: boolean) => call('groups:setCollapsed', id, collapsed)
  },
  scan: {
    start: (root: string, maxDepth: number, opId: string) => call('scan:start', root, maxDepth, opId)
  },
  ops: {
    cancel: (opId: string) => call('ops:cancel', opId)
  },
  session: {
    get: () => call('session:get'),
    save: (state: SessionState) => call('session:save', state)
  },
  settings: {
    get: () => call('settings:get'),
    update: (patch: Partial<Settings>) => call('settings:update', patch)
  },
  dialog: {
    pickFolder: (title: string, defaultPath?: string) => call('dialog:pickFolder', title, defaultPath),
    pickPaths: (title: string, defaultPath: string, kind: 'files' | 'folders') => call('dialog:pickPaths', title, defaultPath, kind)
  },
  shell: {
    openInFileManager: (path: string) => call('shell:openInFileManager', path),
    openInTerminal: (path: string) => call('shell:openInTerminal', path),
    openInEditor: (path: string) => call('shell:openInEditor', path),
    copyText: (text: string) => call('shell:copyText', text),
    openExternal: (url: string) => call('shell:openExternal', url)
  },
  console: {
    list: () => call('console:list'),
    clear: () => call('console:clear')
  },
  on<E extends EventChannel>(event: E, listener: (payload: IpcEventMap[E]) => void): () => void {
    return window.bridge.on(event, listener)
  },
  getPathForFile: (file: File): string => window.bridge.getPathForFile(file),
  platform: (): string => window.bridge.platform
}
