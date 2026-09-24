import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'

export interface MenuDeps {
  window: () => BrowserWindow | null
  recent: () => { path: string; name: string }[]
  clearRecent: () => void
  command: (cmd: MenuCommand) => void
}

export function buildMenu(deps: MenuDeps): void {
  const cmd = (c: MenuCommand) => () => deps.command(c)
  const recent = deps.recent()
  const isMac = process.platform === 'darwin'

  const openRecent: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: 'No Recent Repositories', enabled: false }]
      : recent.map((r) => ({ label: `${r.name}  —  ${r.path}`, click: cmd({ type: 'open-recent', path: r.path }) }))
  openRecent.push({ type: 'separator' }, { label: 'Clear Recent', enabled: recent.length > 0, click: deps.clearRecent })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: '&File',
      submenu: [
        { label: 'Welcome Screen', click: cmd('welcome') },
        { type: 'separator' },
        { label: 'Open Folder/Repository…', accelerator: 'CmdOrCtrl+O', click: cmd('open-folder') },
        { label: 'Clone Repository…', click: cmd('clone') },
        { label: 'New Repository…', click: cmd('new-repo') },
        { label: 'Scan Folder for Repositories…', click: cmd('scan') },
        { label: 'Open Recent', submenu: openRecent },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'E&xit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: '&View',
      submenu: [
        { label: 'Git Console', accelerator: 'Alt+9', click: cmd('toggle-console') },
        { type: 'separator' },
        { role: 'reload', visible: !app.isPackaged },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Window',
      submenu: [
        { label: 'Recent Repositories…', accelerator: 'CmdOrCtrl+E', click: cmd('quick-switcher') },
        { label: 'Switch Repository…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('quick-switcher') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: cmd('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: cmd('prev-tab') },
        {
          label: 'Go to Tab',
          submenu: Array.from({ length: 9 }, (_, i) => ({
            label: `Tab ${i + 1}`,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: cmd({ type: 'goto-tab', index: i })
          }))
        },
        { type: 'separator' },
        { role: 'minimize' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About GitClient',
          click: () => {
            const win = deps.window()
            const opts = {
              type: 'info' as const,
              title: 'About GitClient',
              message: `GitClient ${app.getVersion()}`,
              detail: `Electron ${process.versions.electron}\nChromium ${process.versions.chrome}\nNode ${process.versions.node}`
            }
            void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
