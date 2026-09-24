import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { AppError } from './git/errors'

/**
 * Splits a user-configured command ("code --new-window", '"C:\\Program Files\\x.exe" -n')
 * into argv. Supports single and double quotes. The result is spawned
 * directly, never handed to a shell.
 */
export function tokenizeCommand(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let hasToken = false
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
    } else if (/\s/.test(ch)) {
      if (hasToken || cur) out.push(cur)
      cur = ''
      hasToken = false
    } else {
      cur += ch
    }
  }
  if (hasToken || cur) out.push(cur)
  return out
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Resolves a command name against PATH (and PATHEXT on Windows). */
export function findExecutable(name: string, platform: NodeJS.Platform = process.platform, env = process.env): string | null {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : ['']
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    for (const e of exts) if (isFile(name + e)) return name + e
    return null
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d.replace(/^"(.*)"$/, '$1'), name + e)
      if (isFile(p)) return p
    }
  }
  return null
}

function spawnDetached(file: string, args: string[], cwd: string, verbatim = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim })
    child.once('error', (e) => reject(new AppError(`Could not start ${file}: ${e.message}`, 'UNKNOWN')))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Characters cmd.exe would interpret; refused when we must go through cmd /c. */
const CMD_META = /[&|<>^%!"\r\n]/

/**
 * Launches `exe args...`. Windows .cmd/.bat wrappers (e.g. VS Code's
 * `code.cmd`) can only run via cmd.exe, so for those we refuse any argument
 * containing cmd metacharacters and quote each argument ourselves.
 */
async function launch(exe: string, args: string[], cwd: string): Promise<void> {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    if ([exe, ...args].some((a) => CMD_META.test(a))) {
      throw new AppError('Path contains characters that cannot be passed safely to a .cmd launcher', 'INVALID_ARGUMENT')
    }
    const line = [exe, ...args].map((a) => `"${a}"`).join(' ')
    await spawnDetached(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], cwd, true)
    return
  }
  await spawnDetached(exe, args, cwd)
}

export async function openInEditor(command: string, path: string): Promise<void> {
  const [name, ...args] = tokenizeCommand(command)
  if (!name) throw new AppError('No editor command configured (Settings → Editor command)', 'INVALID_ARGUMENT')
  const exe = findExecutable(name)
  if (!exe) throw new AppError(`Editor command not found: ${name}`, 'INVALID_ARGUMENT')
  // `path` may be a file (Open in Editor from the changes tree): run from its folder.
  let cwd = path
  try {
    if (!statSync(path).isDirectory()) cwd = dirname(path)
  } catch {
    cwd = dirname(path)
  }
  await launch(exe, [...args, path], cwd)
}

const LINUX_TERMINALS: { name: string; args: (dir: string) => string[] }[] = [
  { name: 'x-terminal-emulator', args: () => [] },
  { name: 'gnome-terminal', args: (d) => [`--working-directory=${d}`] },
  { name: 'ptyxis', args: (d) => ['--new-window', '--working-directory', d] },
  { name: 'konsole', args: (d) => ['--workdir', d] },
  { name: 'xfce4-terminal', args: (d) => [`--working-directory=${d}`] },
  { name: 'kitty', args: (d) => ['--directory', d] },
  { name: 'alacritty', args: (d) => ['--working-directory', d] },
  { name: 'wezterm', args: (d) => ['start', '--cwd', d] },
  { name: 'xterm', args: () => [] }
]

export async function openInTerminal(configured: string, path: string): Promise<void> {
  if (configured.trim()) {
    const [name, ...args] = tokenizeCommand(configured)
    const exe = name ? findExecutable(name) : null
    if (!exe) throw new AppError(`Terminal command not found: ${name ?? ''}`, 'INVALID_ARGUMENT')
    await launch(exe, args, path)
    return
  }
  if (process.platform === 'win32') {
    const wt = findExecutable('wt')
    if (wt && !/\.(cmd|bat)$/i.test(wt)) return spawnDetached(wt, ['-d', path], path)
    // A detached cmd.exe gets its own console window, starting in `path`.
    return spawnDetached(process.env.ComSpec ?? 'cmd.exe', ['/K'], path)
  }
  if (process.platform === 'darwin') return spawnDetached('open', ['-a', 'Terminal', path], path)
  for (const t of LINUX_TERMINALS) {
    const exe = findExecutable(t.name)
    if (exe) return spawnDetached(exe, t.args(path), path)
  }
  throw new AppError('No terminal emulator found. Set one in Settings → Terminal command.', 'INVALID_ARGUMENT')
}
