import { spawn } from 'node:child_process'
import { AppError } from './git/errors'

const TIMEOUT_MS = 120_000

/**
 * `sudo chown -R <uid>:<gid> -- <path>`: hands a tree that root (often a
 * container) wrote back to the current user, so a normal, non-root git command
 * can delete it with all its safety checks. Never runs `rm` as root.
 *
 * The password goes to sudo's stdin (`-S`), never into argv, the environment or
 * a log; `-k` ignores a cached credential so stdin is always read as the
 * password, `-p ''` keeps the prompt out of stderr. No shell.
 */
export function sudoChown(path: string, password: string): Promise<void> {
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    return Promise.reject(new AppError('Elevated removal is not available on this platform.', 'INVALID_ARGUMENT'))
  }
  if (/[\r\n]/.test(password)) return Promise.reject(new AppError('The password must be a single line.', 'INVALID_ARGUMENT'))
  const owner = `${process.getuid()}:${process.getgid()}`
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-S', '-k', '-p', '', '--', 'chown', '-R', owner, '--', path], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
    })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new AppError(`Could not run sudo: ${e.message}`, 'UNKNOWN'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(sudoFailure(stderr, code))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(`${password}\n`)
  })
}

/** Maps a failed sudo run (stderr in the C locale) to an error the renderer can act on. */
export function sudoFailure(stderr: string, code: number | null): AppError {
  // Only one line was written: sudo's retry reads EOF, so a wrong password ends here.
  if (/incorrect password|try again|authentication failure|no password was provided/i.test(stderr)) return new AppError('Wrong sudo password.', 'AUTH_FAILED')
  if (/not in the sudoers|not allowed to/i.test(stderr)) return new AppError('This user is not allowed to use sudo.', 'AUTH_FAILED')
  return new AppError(`sudo chown failed${stderr.trim() ? `: ${stderr.trim()}` : ` (exit ${code ?? 'killed'})`}`, 'UNKNOWN')
}
