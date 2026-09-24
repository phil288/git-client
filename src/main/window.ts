import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { restorableBounds, type WindowState } from './windowState'

const DEV_URL = process.env.ELECTRON_RENDERER_URL

export function rendererIndexUrl(): string {
  return DEV_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

/** Only our own renderer page may call IPC handlers. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  if (DEV_URL) return new URL(url).origin === new URL(DEV_URL).origin
  return url.split('#')[0]?.split('?')[0] === rendererIndexUrl()
}

function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

const MIN_SIZE = { width: 800, height: 500 }

/**
 * `saved` restores the last size/position/maximized state; `onClose` receives
 * the state to persist when the window closes.
 */
export function createMainWindow(saved: WindowState, onClose: (state: WindowState) => void): BrowserWindow {
  const bounds = restorableBounds(
    saved.bounds,
    screen.getAllDisplays().map((d) => d.workArea),
    MIN_SIZE
  )
  const win = new BrowserWindow({
    ...(bounds ?? { width: 1400, height: 900 }),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'GitClient',
    autoHideMenuBar: false,
    backgroundColor: '#1e1f22',
    // Window/taskbar icon on Linux (Windows uses the exe icon).
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })
  // Track the un-maximized geometry ourselves: on Linux getNormalBounds() of a
  // maximized window includes the frame, so the window would grow each restart.
  let normalBounds = bounds
  const track = (): void => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) normalBounds = win.getBounds()
  }
  win.on('resize', track)
  win.on('move', track)
  win.on('close', () => onClose({ bounds: normalBounds, maximized: win.isMaximized() }))

  // No popups: links to the web open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The app never navigates away from its single page (also blocks file drops).
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
