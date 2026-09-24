import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { formatCommand } from '@shared/display'
import { AppError } from './errors'
import type { CommandLogger } from './logger'

export interface RunOptions {
  /** Working directory. Must exist. */
  cwd?: string | null
  /** Extra environment variables (merged over process.env). */
  env?: Record<string, string>
  /** Data written to stdin, then stdin is closed. */
  input?: string | Buffer
  signal?: AbortSignal
  /** Called for each stderr progress line (split on \r and \n). */
  onStderrLine?: (line: string) => void
  /** Exit codes that are not errors (default: [0]). */
  okExitCodes?: number[]
  /** Automatic background refresh: still logged, but flagged so the console can hide it. */
  quiet?: boolean
}

export interface RunResult {
  stdout: string
  /** Raw stdout bytes (file blobs must not be decoded as UTF-8 blindly). */
  stdoutBuffer: Buffer
  stderr: string
  exitCode: number
}

/** A running git process whose stdout is consumed incrementally. */
export interface StreamHandle {
  pause(): void
  resume(): void
  kill(): void
  /** Resolves on exit (rejects like run() on failure, except when killed). */
  done: Promise<{ exitCode: number | null; stderr: string; killed: boolean }>
}

/**
 * Global options prepended to every invocation. They make output stable for
 * parsing (no colour, no path quoting) and enable long paths on Windows.
 */
function baseArgs(platform: NodeJS.Platform): string[] {
  const args = ['-c', 'core.quotepath=false', '-c', 'color.ui=false']
  if (platform === 'win32') args.push('-c', 'core.longpaths=true')
  return args
}

/** Kill a process and, on Windows, its whole tree (git spawns helpers). */
export function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => undefined)
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already exited */
    }
  }
}

/**
 * Spawns the git executable with an argument array. There is no code path
 * that builds a shell string: `shell` is never set, so arguments reach git
 * verbatim regardless of spaces, quotes or metacharacters.
 */
export class GitRunner {
  constructor(
    private gitPath: string,
    private readonly logger: CommandLogger
  ) {}

  get executable(): string {
    return this.gitPath
  }

  setExecutable(path: string): void {
    this.gitPath = path
  }

  run(args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
    const cwd = opts.cwd ?? undefined
    if (cwd !== undefined && !existsSync(cwd)) {
      return Promise.reject(new AppError(`Folder does not exist: ${cwd}`, 'PATH_MISSING'))
    }
    if (opts.signal?.aborted) {
      return Promise.reject(new AppError('Operation cancelled', 'CANCELLED'))
    }

    const logEntry = this.logger.start(cwd ?? null, args, opts.quiet === true)
    const fullArgs = [...baseArgs(process.platform), ...args]
    const command = formatCommand(args)

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(this.gitPath, fullArgs, {
        cwd,
        env: {
          ...process.env,
          // Never block on a terminal prompt; credential helpers / ssh-agent still work.
          GIT_TERMINAL_PROMPT: '0',
          ...opts.env
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const out: Buffer[] = []
      const err: Buffer[] = []
      let pendingLine = ''
      let cancelled = false
      let settled = false

      const onAbort = (): void => {
        cancelled = true
        killProcessTree(child.pid)
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => {
        err.push(chunk)
        if (opts.onStderrLine) {
          const text = pendingLine + chunk.toString('utf8')
          const parts = text.split(/[\r\n]/)
          pendingLine = parts.pop() ?? ''
          for (const p of parts) if (p.trim() !== '') opts.onStderrLine(p)
        }
      })

      const finish = (exitCode: number | null, spawnError?: Error): void => {
        if (settled) return
        settled = true
        opts.signal?.removeEventListener('abort', onAbort)
        if (opts.onStderrLine && pendingLine.trim() !== '') opts.onStderrLine(pendingLine)
        const stdoutBuffer = Buffer.concat(out)
        const stdout = stdoutBuffer.toString('utf8')
        const stderr = spawnError ? spawnError.message : Buffer.concat(err).toString('utf8')
        if (logEntry) this.logger.finish(logEntry, exitCode, stderr, cancelled)

        if (spawnError) {
          const missing = (spawnError as NodeJS.ErrnoException).code === 'ENOENT'
          reject(
            new AppError(missing ? `Git executable not found: ${this.gitPath}` : spawnError.message, missing ? 'GIT_MISSING' : 'UNKNOWN', {
              command
            })
          )
          return
        }
        if (cancelled) {
          reject(new AppError('Operation cancelled', 'CANCELLED', { command, stderr, exitCode }))
          return
        }
        const okCodes = opts.okExitCodes ?? [0]
        if (exitCode === null || !okCodes.includes(exitCode)) {
          const firstLine = stderr.split('\n').find((l) => l.trim() !== '') ?? `exit code ${exitCode}`
          reject(new AppError(firstLine.replace(/^(fatal|error): /, ''), 'GIT_FAILED', { stderr, exitCode, command }))
          return
        }
        resolve({ stdout, stdoutBuffer, stderr, exitCode })
      }

      child.on('error', (e) => finish(null, e))
      child.on('close', (code) => finish(code))

      if (opts.input !== undefined) child.stdin.end(opts.input)
      else child.stdin.end()
    })
  }

  /**
   * Spawns git and hands stdout chunks to `onData` as they arrive, with
   * pause/resume for back-pressure (used to page through `git log`).
   */
  stream(args: readonly string[], opts: { cwd: string; env?: Record<string, string> }, onData: (chunk: Buffer) => void): StreamHandle {
    if (!existsSync(opts.cwd)) throw new AppError(`Folder does not exist: ${opts.cwd}`, 'PATH_MISSING')
    const logEntry = this.logger.start(opts.cwd, args)
    const child = spawn(this.gitPath, [...baseArgs(process.platform), ...args], {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const err: Buffer[] = []
    let killed = false
    child.stdout.on('data', onData)
    child.stderr.on('data', (c: Buffer) => err.push(c))
    const done = new Promise<{ exitCode: number | null; stderr: string; killed: boolean }>((resolve, reject) => {
      let settled = false
      const finish = (code: number | null, e?: Error) => {
        if (settled) return
        settled = true
        const stderr = e ? e.message : Buffer.concat(err).toString('utf8')
        this.logger.finish(logEntry, code, stderr, killed)
        if (e) reject(new AppError(e.message, (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'GIT_MISSING' : 'UNKNOWN'))
        else if (!killed && code !== 0) {
          const first = stderr.split('\n').find((l) => l.trim() !== '') ?? `exit code ${code}`
          reject(new AppError(first.replace(/^(fatal|error): /, ''), 'GIT_FAILED', { stderr, exitCode: code, command: formatCommand(args) }))
        } else resolve({ exitCode: code, stderr, killed })
      }
      child.on('error', (e) => finish(null, e))
      child.on('close', (code) => finish(code))
    })
    return {
      pause: () => child.stdout.pause(),
      resume: () => child.stdout.resume(),
      kill: () => {
        if (child.exitCode !== null) return
        killed = true
        killProcessTree(child.pid)
      },
      done
    }
  }
}
