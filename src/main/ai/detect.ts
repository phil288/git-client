import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AI_TOOL_LABEL, AI_TOOLS, type AiToolInfo } from '@shared/types'
import { AI_TOOL_SPECS, overrideEnvVar } from './tools'

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Directories searched for AI CLIs: PATH first, then the usual per-user install
 * locations. A GUI app started from a desktop menu often gets a minimal PATH that
 * lacks ~/.local/bin, npm's global bin, etc., where these CLIs live.
 */
export function searchDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const pathVar = env.PATH ?? env.Path ?? ''
  const fromPath = pathVar
    .split(platform === 'win32' ? ';' : delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
  const home = (platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir()
  const extra: string[] = []
  if (platform === 'win32') {
    const appData = env.APPDATA
    const local = env.LOCALAPPDATA
    if (appData) extra.push(join(appData, 'npm'))
    if (local) {
      extra.push(
        join(local, 'Programs', 'claude'),
        join(local, 'Programs', 'cursor-agent'),
        join(local, 'Microsoft', 'WinGet', 'Links'),
        join(local, 'pnpm')
      )
    }
    extra.push(join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, 'scoop', 'shims'), join(home, '.claude', 'local'))
  } else {
    extra.push(
      join(home, '.local', 'bin'),
      join(home, '.npm-global', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.claude', 'local'),
      join(home, '.cursor', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.local', 'share', 'pnpm'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/snap/bin'
    )
  }
  const seen = new Set<string>()
  return [...fromPath, ...extra].filter((d) => {
    const key = platform === 'win32' ? d.toLowerCase() : d
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * First existing executable for one of `names`. On Windows a real `.exe` anywhere
 * beats a `.cmd`/`.bat` shim (shims need cmd.exe, see buildInvocation).
 */
export function resolveBinary(
  names: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = isFile
): string | null {
  const dirs = searchDirs(platform, env)
  const exts = platform === 'win32' ? [['.exe'], ['.cmd', '.bat']] : [['']]
  for (const group of exts) {
    for (const name of names) {
      for (const dir of dirs) {
        for (const ext of group) {
          const p = join(dir, name + ext)
          if (exists(p)) return p
        }
      }
    }
  }
  return null
}

/**
 * Resolves every supported CLI. Not cached: called on each `ai:tools` request so a
 * freshly installed CLI shows up without restarting the app.
 *
 * Testing seam: `GITCLIENT_AI_<TOOL>_PATH` (e.g. GITCLIENT_AI_CLAUDE_PATH) is taken as
 * that tool's path when the file exists (empty / missing file = not installed).
 * `GITCLIENT_AI_NO_PATH_SEARCH=1` disables the PATH search so tests and e2e only see
 * their fakes, whatever is installed on the machine.
 */
export function detectTools(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = isFile
): AiToolInfo[] {
  const noSearch = env.GITCLIENT_AI_NO_PATH_SEARCH === '1'
  return AI_TOOLS.map((id) => {
    const override = env[overrideEnvVar(id)]
    let path: string | null
    if (override !== undefined) path = override !== '' && exists(override) ? override : null
    else path = noSearch ? null : resolveBinary(AI_TOOL_SPECS[id].binaries, platform, env, exists)
    return { id, label: AI_TOOL_LABEL[id], path }
  })
}
