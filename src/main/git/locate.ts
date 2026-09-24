import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { MIN_GIT_VERSION, type GitExecutableInfo, type GitStatus } from '@shared/types'

/** "git version 2.43.0.windows.1" -> [2, 43, 0] */
export function parseGitVersion(output: string): [number, number, number] | null {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Candidate executables in priority order: PATH entries first, then the
 * usual install locations. Only real executables (git / git.exe), never
 * .cmd/.bat wrappers, because those would need a shell.
 */
export function candidateGitPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const exe = platform === 'win32' ? 'git.exe' : 'git'
  const pathVar = env.PATH ?? env.Path ?? ''
  const fromPath = pathVar
    .split(platform === 'win32' ? ';' : delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
    .map((d) => join(d, exe))

  const common: string[] = []
  if (platform === 'win32') {
    const pf = env.ProgramFiles ?? 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const local = env.LOCALAPPDATA
    const home = env.USERPROFILE
    common.push(join(pf, 'Git', 'cmd', 'git.exe'), join(pf, 'Git', 'bin', 'git.exe'), join(pf86, 'Git', 'cmd', 'git.exe'))
    if (local) common.push(join(local, 'Programs', 'Git', 'cmd', 'git.exe'))
    if (home) common.push(join(home, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'))
    common.push('C:\\Git\\cmd\\git.exe')
  } else {
    common.push('/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/snap/bin/git')
  }
  const seen = new Set<string>()
  return [...fromPath, ...common].filter((p) => {
    const key = platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Runs `<path> --version`. Returns null if it is not a working git. */
export function probeGit(path: string, timeoutMs = 5000): Promise<GitExecutableInfo | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: GitExecutableInfo | null): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    try {
      const child = spawn(path, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      const timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, timeoutMs)
      child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')))
      child.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      child.on('close', () => {
        clearTimeout(timer)
        const parts = parseGitVersion(out)
        finish(parts ? { path, version: out.trim().replace(/^git version /, ''), versionParts: parts } : null)
      })
    } catch {
      finish(null)
    }
  })
}

export function formatVersion(v: readonly number[]): string {
  return v.join('.')
}

/**
 * Finds git: the configured path if any (no fallback, so a wrong setting is
 * visible), otherwise PATH then common install locations.
 */
export async function locateGit(
  configuredPath: string | null,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<GitStatus> {
  const candidates = configuredPath ? [configuredPath] : candidateGitPaths(platform, env).filter(isFile)
  const searched = configuredPath ? [configuredPath] : candidateGitPaths(platform, env)
  for (const c of candidates) {
    const info = await probeGit(c)
    if (!info) continue
    if (compareVersions(info.versionParts, MIN_GIT_VERSION) < 0) {
      return { state: 'too-old', git: info, minimum: formatVersion(MIN_GIT_VERSION) }
    }
    return { state: 'ok', git: info }
  }
  return { state: 'missing', searched, configuredPath }
}
