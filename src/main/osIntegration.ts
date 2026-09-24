import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { fileManagerScript } from './fileManagerScript'

/** Same keys as build/installer.nsh, so the installer and Settings agree. */
const MENU_KEYS = ['HKCU\\Software\\Classes\\Directory\\shell\\GitClient', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\GitClient']

function exec(file: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(file, args, { windowsHide: true, stdio: 'ignore' })
    c.on('error', () => resolve(-1))
    c.on('close', (code) => resolve(code ?? -1))
  })
}

/** The command other programs should launch: the AppImage file, else the executable. */
export function launcherPath(): string {
  return process.env.APPIMAGE || process.execPath
}

export async function getExplorerMenu(): Promise<boolean | null> {
  if (process.platform !== 'win32') return null
  return (await exec('reg', ['query', `${MENU_KEYS[0]}\\command`, '/ve'])) === 0
}

/** Adds/removes "Open in GitClient" for folders and folder backgrounds (per user, no admin). */
export async function setExplorerMenu(enable: boolean): Promise<void> {
  if (process.platform !== 'win32') return
  const exe = process.execPath
  for (const key of MENU_KEYS) {
    if (!enable) {
      await exec('reg', ['delete', key, '/f'])
      continue
    }
    await exec('reg', ['add', key, '/ve', '/d', 'Open in GitClient', '/f'])
    await exec('reg', ['add', key, '/v', 'Icon', '/d', `"${exe}",0`, '/f'])
    await exec('reg', ['add', `${key}\\command`, '/ve', '/d', `"${exe}" "%V"`, '/f'])
  }
}

const FM_DIRS = {
  nautilus: join(homedir(), '.local', 'share', 'nautilus', 'scripts'),
  nemo: join(homedir(), '.local', 'share', 'nemo', 'scripts')
}
const SCRIPT_NAME = 'Open in GitClient'

export function getFileManagerScripts(): { nautilus: boolean | null; nemo: boolean | null } | null {
  if (process.platform !== 'linux') return null
  const has = (fm: keyof typeof FM_DIRS) => (existsSync(join(FM_DIRS[fm], '..')) ? existsSync(join(FM_DIRS[fm], SCRIPT_NAME)) : null)
  return { nautilus: has('nautilus'), nemo: has('nemo') }
}

/** Installs the script for Nautilus and Nemo (where their config folder exists). */
export function setFileManagerScripts(enable: boolean): void {
  if (process.platform !== 'linux') return
  for (const fm of ['nautilus', 'nemo'] as const) {
    const dir = FM_DIRS[fm]
    const file = join(dir, SCRIPT_NAME)
    if (!enable) {
      rmSync(file, { force: true })
      continue
    }
    if (!existsSync(join(dir, '..'))) continue // file manager not used by this account
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, fileManagerScript(fm, launcherPath()))
    chmodSync(file, 0o755)
  }
}

/** Windows taskbar jump list: pinned and recent repositories. */
export function updateJumpList(pinned: { path: string; name: string }[], recent: { path: string; name: string }[]): void {
  if (process.platform !== 'win32') return
  const item = (r: { path: string; name: string }) => ({
    type: 'task' as const,
    title: r.name,
    description: r.path,
    program: process.execPath,
    args: `"${r.path.replace(/"/g, '')}"`,
    iconPath: process.execPath,
    iconIndex: 0
  })
  try {
    app.setJumpList([
      ...(pinned.length ? [{ type: 'custom' as const, name: 'Pinned', items: pinned.slice(0, 10).map(item) }] : []),
      ...(recent.length ? [{ type: 'custom' as const, name: 'Recent Repositories', items: recent.slice(0, 10).map(item) }] : [])
    ])
  } catch {
    // Jump lists can fail if the user disabled them; not critical.
  }
}
