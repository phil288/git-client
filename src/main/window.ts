import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, shell, type IpcMainInvokeEvent } from 'electron'

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

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
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

  win.once('ready-to-show', () => win.show())

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
