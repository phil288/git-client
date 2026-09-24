import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, nativeTheme, session, shell } from 'electron'
import {
  DEFAULT_SETTINGS,
  type GitStatus,
  type MenuCommand,
  type OpenRepoRequest,
  type ScanResult,
  type SessionState,
  type Settings
} from '@shared/types'
import { extractPathArgs, resolvePathArgs } from './cli'
import { AppError } from './git/errors'
import { GitService } from './git/GitService'
import { LogSessions } from './git/log'
import { registerLogHandlers } from './handlers/log'
import { registerBranchHandlers } from './handlers/branches'
import { registerRewriteHandlers } from './handlers/rewrite'
import { registerWorkingTreeHandlers } from './handlers/workingTree'
import { registerM7Handlers } from './handlers/m7'
import { registerWorktreeHandlers } from './handlers/worktrees'
import { registerConflictHandlers } from './handlers/conflicts'
import { initEditors } from './git/editors'
import type { MainContext } from './context'
import { locateGit } from './git/locate'
import { CommandLogger } from './git/logger'
import { GitRunner } from './git/runner'
import { assert, createRegistry, send } from './ipcRegistry'
import { buildMenu } from './menu'
import { OperationManager } from './operations'
import { openInEditor, openInTerminal } from './osOpen'
import { normalizeRepoPath, pathKey } from './paths'
import { RecentsService } from './repos/RecentsService'
import { scanForRepos } from './repos/scan'
import { RepoWatcher } from './repos/watcher'
import { openStore } from './store'
import { AutoFetcher } from './autoFetch'
import { checkForUpdates, downloadAndInstall } from './updates'
import { getExplorerMenu, getFileManagerScripts, setExplorerMenu, setFileManagerScripts, updateJumpList } from './osIntegration'
import { createMainWindow, isTrustedSender } from './window'

// Test/dev hook: isolate state (Playwright uses a temp dir).
if (process.env.GITCLIENT_USER_DATA) app.setPath('userData', process.env.GITCLIENT_USER_DATA)

interface SecondInstanceData {
  cwd: string
  args: string[]
}

const initialArgs = extractPathArgs(process.argv, process.defaultApp === true)
const gotLock = app.requestSingleInstanceLock({ cwd: process.cwd(), args: initialArgs } satisfies SecondInstanceData)

if (!gotLock) {
  // Another instance is running; it receives our argv via 'second-instance'.
  app.quit()
} else {
  void main()
}

async function main(): Promise<void> {
  let mainWindow: BrowserWindow | null = null
  let rendererReady = false
  const pendingOpens: OpenRepoRequest[] = resolvePathArgs(initialArgs, process.cwd()).map((path) => ({
    path,
    newTab: true
  }))

  const requestOpen = (req: OpenRepoRequest): void => {
    if (rendererReady && mainWindow) send(mainWindow.webContents, 'app:openRepo', req)
    else pendingOpens.push(req)
  }

  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    const data = additionalData as Partial<SecondInstanceData> | undefined
    const args = Array.isArray(data?.args) ? data.args : extractPathArgs(argv, false)
    const cwd = typeof data?.cwd === 'string' ? data.cwd : workingDirectory
    for (const path of resolvePathArgs(args, cwd)) requestOpen({ path, newTab: true })
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  await app.whenReady()

  // Deny every permission request (camera, notifications, ...): the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const store = openStore()
  initEditors(join(app.getPath('userData'), 'helpers'), process.execPath)
  const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...store.get('settings') })
  nativeTheme.themeSource = getSettings().theme

  const logger = new CommandLogger()
  let gitStatus: GitStatus = await locateGit(getSettings().gitPath)
  const runner = new GitRunner(gitStatus.state === 'missing' ? 'git' : gitStatus.git.path, logger)
  const git = new GitService(runner)
  const recents = new RecentsService(store)
  const ops = new OperationManager()
  const watcher = new RepoWatcher((root) => send(mainWindow?.webContents, 'repo:changed', { root }))
  const logs = new LogSessions(runner)
  const autoFetch = new AutoFetcher(runner, () => watcher.roots(), (root) => send(mainWindow?.webContents, 'repo:changed', { root }))
  autoFetch.configure(getSettings().autoFetchMinutes)
  const refreshJumpList = () => {
    const all = recents.list().repos.filter((r) => r.exists)
    const name = (r: { path: string; displayName: string | null }) => r.displayName ?? r.path.split(/[\\/]/).pop() ?? r.path
    updateJumpList(
      all.filter((r) => r.pinned).map((r) => ({ path: r.path, name: name(r) })),
      recents.mostRecent(10).filter((r) => !all.find((x) => x.path === r.path)?.pinned)
    )
  }
  refreshJumpList()

  const requireGit = (): void => {
    if (gitStatus.state !== 'ok') throw new AppError('Git is not available', 'GIT_MISSING')
  }
  const recheckGit = async (): Promise<GitStatus> => {
    gitStatus = await locateGit(getSettings().gitPath)
    if (gitStatus.state !== 'missing') runner.setExecutable(gitStatus.git.path)
    send(mainWindow?.webContents, 'git:statusChanged', gitStatus)
    return gitStatus
  }

  const rebuildMenu = (): void =>
    buildMenu({
      window: () => mainWindow,
      recent: () => recents.mostRecent(15),
      clearRecent: () => recents.clear(),
      command: (cmd: MenuCommand) => send(mainWindow?.webContents, 'menu:command', cmd)
    })

  logger.on('entry', (entry) => send(mainWindow?.webContents, 'console:entry', entry))
  ops.on('progress', (p) => send(mainWindow?.webContents, 'op:progress', p))
  recents.on('changed', (state) => {
    send(mainWindow?.webContents, 'recents:changed', state)
    rebuildMenu()
    refreshJumpList()
  })

  // ---------------------------------------------------------------------------
  // IPC handlers
  // ---------------------------------------------------------------------------
  const handle = createRegistry(isTrustedSender)

  handle('app:getInfo', () => ({
    version: app.getVersion(),
    platform: process.platform,
    homeDir: homedir(),
    userDataDir: app.getPath('userData'),
    isPackaged: app.isPackaged
  }))
  handle('app:takePendingOpens', () => {
    rendererReady = true
    return pendingOpens.splice(0)
  })

  handle('git:getStatus', () => gitStatus)
  handle('git:recheck', () => recheckGit())
  handle('git:pickExecutable', async () => {
    const opts = {
      title: 'Select the git executable',
      properties: ['openFile' as const],
      filters: process.platform === 'win32' ? [{ name: 'git.exe', extensions: ['exe'] }] : []
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    const picked = res.filePaths[0]
    if (res.canceled || !picked) return gitStatus
    store.set('settings', { ...getSettings(), gitPath: picked })
    return recheckGit()
  })

  handle('repo:resolve', (_e, path) => {
    requireGit()
    return git.resolve(assert.nonEmptyString(path, 'path'))
  })
  handle('repo:info', (_e, root) => {
    requireGit()
    return git.info(assert.nonEmptyString(root, 'root'))
  })
  handle('repo:quickStatus', (_e, path) => {
    requireGit()
    return git.quickStatus(assert.nonEmptyString(path, 'path'))
  })
  handle('repo:init', (_e, path) => {
    requireGit()
    return git.init(assert.nonEmptyString(path, 'path'))
  })
  handle('repo:clone', (_e, request, opId) => {
    requireGit()
    const req = {
      url: assert.nonEmptyString(request?.url, 'url'),
      destination: assert.nonEmptyString(request?.destination, 'destination'),
      branch: request?.branch ? assert.string(request.branch, 'branch') : undefined
    }
    return ops.run(assert.nonEmptyString(opId, 'opId'), `Cloning ${req.url}`, true, (op) =>
      git.clone(req, op.signal, (p) => op.progress(p.line, p.percent))
    )
  })
  handle('repo:watch', async (_e, root) => {
    const info = await git.info(assert.nonEmptyString(root, 'root'))
    watcher.watch(info.root, info.gitDir, info.commonDir)
  })
  handle('repo:unwatch', (_e, root) => watcher.unwatch(assert.nonEmptyString(root, 'root')))

  handle('recents:list', () => recents.list())
  handle('recents:touch', (_e, path, branch) => recents.touch(assert.nonEmptyString(path, 'path'), assert.nullableString(branch, 'branch')))
  handle('recents:remove', (_e, paths) => recents.remove(assert.stringArray(paths, 'paths')))
  handle('recents:setPinned', (_e, path, pinned) => recents.setPinned(assert.string(path, 'path'), assert.boolean(pinned, 'pinned')))
  handle('recents:rename', (_e, path, name) => recents.rename(assert.string(path, 'path'), assert.nullableString(name, 'name')))
  handle('recents:moveToGroup', (_e, path, groupId) =>
    recents.moveToGroup(assert.string(path, 'path'), assert.nullableString(groupId, 'groupId'))
  )
  handle('recents:locate', async (_e, oldPath, newPath) => {
    requireGit()
    const res = await git.resolve(assert.nonEmptyString(newPath, 'newPath'))
    if (res.kind !== 'repo') throw new AppError(`Not a git repository: ${newPath}`, 'NOT_A_REPO')
    return recents.locate(assert.string(oldPath, 'oldPath'), res.root)
  })
  handle('recents:removeMissing', () => recents.removeMissing())
  handle('recents:clear', () => recents.clear())
  handle('recents:addMany', (_e, paths, groupId) =>
    recents.addMany(assert.stringArray(paths, 'paths'), assert.nullableString(groupId, 'groupId'))
  )

  handle('groups:create', (_e, name) => recents.createGroup(assert.string(name, 'name')))
  handle('groups:rename', (_e, id, name) => recents.renameGroup(assert.string(id, 'id'), assert.string(name, 'name')))
  handle('groups:delete', (_e, id) => recents.deleteGroup(assert.string(id, 'id')))
  handle('groups:setCollapsed', (_e, id, collapsed) =>
    recents.setGroupCollapsed(assert.string(id, 'id'), assert.boolean(collapsed, 'collapsed'))
  )

  handle('scan:start', (_e, root, maxDepth, opId) => {
    const dir = assert.nonEmptyString(root, 'root')
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new AppError(`Not a folder: ${dir}`, 'PATH_MISSING')
    const depth = Math.max(0, Math.min(12, Math.floor(Number(maxDepth) || 0)))
    return ops.run(assert.nonEmptyString(opId, 'opId'), `Scanning ${dir}`, true, async (op) => {
      const found = await scanForRepos(dir, {
        maxDepth: depth,
        signal: op.signal,
        onProgress: (n, current) => op.progress(`${n} folders scanned — ${current}`, null)
      })
      const known = new Set(recents.list().repos.map((r) => pathKey(r.path)))
      return found.map((p): ScanResult => {
        const path = normalizeRepoPath(p)
        return { path, name: path.split(/[\\/]/).pop() ?? path, alreadyInRecents: known.has(pathKey(path)) }
      })
    })
  })

  handle('ops:cancel', (_e, opId) => ops.cancel(assert.string(opId, 'opId')))

  handle('session:get', () => store.get('session'))
  handle('session:save', (_e, state: SessionState) => {
    if (!state || !Array.isArray(state.tabs)) throw new TypeError('invalid session')
    store.set('session', {
      tabs: state.tabs
        .filter((t) => typeof t?.path === 'string')
        .map((t) => ({ path: t.path, ui: t.ui && typeof t.ui === 'object' ? t.ui : {} })),
      activePath: typeof state.activePath === 'string' ? state.activePath : null
    })
  })

  handle('settings:get', () => getSettings())
  handle('settings:update', async (_e, patch) => {
    const current = getSettings()
    const next: Settings = { ...current }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (patch && key in patch) (next as unknown as Record<string, unknown>)[key] = patch[key]
    }
    store.set('settings', next) // schema-validated by electron-store; throws on bad values
    if (next.theme !== current.theme) nativeTheme.themeSource = next.theme
    if (next.gitPath !== current.gitPath) await recheckGit()
    if (next.autoFetchMinutes !== current.autoFetchMinutes) autoFetch.configure(next.autoFetchMinutes)
    return next
  })

  handle('dialog:pickFolder', async (_e, title, defaultPath) => {
    const opts = {
      title: assert.string(title, 'title'),
      defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  handle('shell:openInFileManager', async (_e, path) => {
    const err = await shell.openPath(assert.nonEmptyString(path, 'path'))
    if (err) throw new AppError(err, 'UNKNOWN')
  })
  handle('shell:openInTerminal', (_e, path) => openInTerminal(getSettings().terminalCommand, assert.nonEmptyString(path, 'path')))
  handle('shell:openInEditor', (_e, path) => openInEditor(getSettings().editorCommand, assert.nonEmptyString(path, 'path')))
  handle('shell:copyText', (_e, text) => clipboard.writeText(assert.string(text, 'text')))
  handle('shell:openExternal', async (_e, url) => {
    const u = new URL(assert.string(url, 'url'))
    if (u.protocol !== 'https:') throw new AppError('Only https links can be opened', 'INVALID_ARGUMENT')
    await shell.openExternal(u.toString())
  })

  handle('console:list', () => logger.list())
  handle('console:clear', () => logger.clear())

  const ctx: MainContext = {
    handle,
    runner,
    git,
    logs,
    ops,
    store,
    recents,
    watcher,
    window: () => mainWindow,
    requireGit,
    settings: getSettings,
    notifyRepoChanged: (root) => send(mainWindow?.webContents, 'repo:changed', { root })
  }
  handle('os:integration', async () => ({
    platform: process.platform,
    explorerMenu: await getExplorerMenu(),
    fileManagerScripts: getFileManagerScripts()
  }))
  handle('os:setExplorerMenu', (_e, enable) => setExplorerMenu(assert.boolean(enable, 'enable')))
  handle('os:setFileManagerScripts', (_e, enable) => setFileManagerScripts(assert.boolean(enable, 'enable')))
  handle('update:check', () => checkForUpdates())
  handle('update:install', (_e, opId) => ops.run(assert.nonEmptyString(opId, 'opId'), 'Updating GitClient', false, (op) => downloadAndInstall(op.progress)))
  registerLogHandlers(ctx)
  registerBranchHandlers(ctx)
  registerRewriteHandlers(ctx)
  registerWorkingTreeHandlers(ctx)
  registerM7Handlers(ctx)
  registerWorktreeHandlers(ctx)
  registerConflictHandlers(ctx, () => (gitStatus.state === 'missing' ? [0, 0, 0] : gitStatus.git.versionParts))

  // ---------------------------------------------------------------------------
  // Window lifecycle
  // ---------------------------------------------------------------------------
  const openWindow = (): void => {
    mainWindow = createMainWindow()
    rendererReady = false
    // A reload re-runs the renderer bootstrap, which calls takePendingOpens again.
    mainWindow.webContents.on('did-start-loading', () => (rendererReady = false))
    mainWindow.on('closed', () => {
      mainWindow = null
      rendererReady = false
    })
  }

  rebuildMenu()
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    ops.cancelAll()
    autoFetch.stop()
    logs.closeAll()
    void watcher.closeAll()
  })
}
