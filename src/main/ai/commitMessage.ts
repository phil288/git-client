import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { AI_TOOL_LABEL, type AiCommitResult, type AiTool } from '@shared/types'
import { AppError } from '../git/errors'
import { killProcessTree, type GitRunner } from '../git/runner'
import { cleanCommitMessage } from './clean'
import { searchDirs } from './detect'
import { buildPrompt } from './prompt'
import { AI_TOOL_SPECS, buildInvocation } from './tools'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const DEFAULT_TIMEOUT_MS = 120_000
const STDOUT_CAP = 1024 * 1024
const DIFF_OPTS = ['--cached', '--no-color', '--no-ext-diff', '--no-textconv', '-M']

export interface GenerateOptions {
  amend: boolean
  signal?: AbortSignal
  /** Messages the user recently committed with this app (style hints). */
  recentMessages?: readonly string[]
  timeoutMs?: number
  /** Status-bar text for each phase. */
  onProgress?: (message: string) => void
}

export interface StagedContext {
  diff: string
  stat: string
  recentSubjects: string[]
  previousMessage?: string
}

async function revExists(runner: GitRunner, root: string, rev: string): Promise<boolean> {
  const r = await runner.run(['rev-parse', '--verify', '-q', `${rev}^{commit}`], { cwd: root, okExitCodes: [0, 1, 128], quiet: true })
  return r.exitCode === 0
}

/**
 * Collects what the model sees. For amend the diff is HEAD~1..index (the whole
 * amended commit), or empty tree..index for a root commit.
 */
export async function gatherStagedContext(runner: GitRunner, root: string, amend: boolean, signal?: AbortSignal): Promise<StagedContext> {
  let base: string[] = []
  let previousMessage: string | undefined
  if (amend) {
    if (!(await revExists(runner, root, 'HEAD'))) throw new AppError('There is no commit to amend yet', 'INVALID_ARGUMENT')
    base = [(await revExists(runner, root, 'HEAD~1')) ? 'HEAD~1' : EMPTY_TREE]
    previousMessage = (await runner.run(['log', '-1', '--format=%B'], { cwd: root, signal })).stdout.trim()
  }
  // Wide --stat so long paths are not abbreviated with "...".
  const stat = (await runner.run(['diff', ...DIFF_OPTS, '--stat=1000,800', ...base, '--'], { cwd: root, signal })).stdout
  if (stat.trim() === '') {
    throw new AppError(amend ? 'The commit being amended has no changes to describe' : 'Nothing is staged. Stage changes first, then generate a message.', 'INVALID_ARGUMENT')
  }
  const diff = (await runner.run(['diff', ...DIFF_OPTS, ...base, '--'], { cwd: root, signal })).stdout
  let recentSubjects: string[] = []
  try {
    const log = await runner.run(['log', '-10', '--format=%s'], { cwd: root, signal, quiet: true })
    recentSubjects = log.stdout.split('\n').filter((l) => l.trim() !== '')
  } catch {
    /* unborn branch: no history to imitate */
  }
  return { diff, stat, recentSubjects, previousMessage }
}

/** Kills the CLI and everything it started (agents spawn helpers). */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    killProcessTree(pid)
    return
  }
  // Spawned detached, so the child leads its own process group.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGTERM')
      break
    } catch {
      /* group or process already gone */
    }
  }
  const t = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* exited */
    }
  }, 2000)
  t.unref()
}

/** Env for the CLI: non-interactive, no colours, not refusing to run "nested". */
export function toolEnv(toolPath: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, CI: '1', NO_COLOR: '1', TERM: 'dumb' }
  // The app may be launched from a terminal inside Claude Code; nested-session guards
  // key off these. Also never let ours leak into a real CLI.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  delete env.ELECTRON_RUN_AS_NODE
  // A GUI launch often has a minimal PATH; npm-installed CLIs need `node` from the same
  // place they live, so put the tool's dir and the usual user bins on PATH.
  const key = process.platform === 'win32' ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path') : 'PATH'
  const sep = process.platform === 'win32' ? ';' : delimiter
  env[key] = [dirname(toolPath), ...searchDirs(process.platform, env)].join(sep)
  return env
}

export interface RunToolResult {
  stdout: string
  answerFile: string | null
}

/** Spawns the CLI (no shell), writes the prompt to stdin, enforces timeout + cancel. */
export function runTool(
  tool: AiTool,
  toolPath: string,
  root: string,
  prompt: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<RunToolResult> {
  const spec = AI_TOOL_SPECS[tool]
  const label = AI_TOOL_LABEL[tool]
  if (opts.signal?.aborted) return Promise.reject(new AppError('Operation cancelled', 'CANCELLED'))
  // Only tools that write their answer to a file (codex -o) get a temp dir.
  const tmp = spec.answerInFile ? mkdtempSync(join(tmpdir(), 'gitclient-ai-')) : null
  const outFile = tmp ? join(tmp, 'message.txt') : ''
  const cleanup = (): void => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<RunToolResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      const inv = buildInvocation(toolPath, spec.args(outFile))
      child = spawn(inv.command, inv.args, {
        cwd: root,
        env: { ...toolEnv(toolPath), ...inv.env },
        windowsHide: true,
        windowsVerbatimArguments: inv.windowsVerbatimArguments,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      // buildInvocation rejects unsafe shim args; spawn can throw synchronously (e.g. EINVAL).
      cleanup()
      reject(e instanceof AppError ? e : new AppError(e instanceof Error ? e.message : String(e), 'UNKNOWN'))
      return
    }
    const out: Buffer[] = []
    let outLen = 0
    const err: Buffer[] = []
    let errLen = 0
    let reason: 'cancelled' | 'timeout' | null = null
    let settled = false

    const stop = (why: 'cancelled' | 'timeout'): void => {
      if (reason) return
      reason = why
      killTree(child.pid)
    }
    const onAbort = (): void => stop('cancelled')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => stop('timeout'), timeoutMs)

    child.stdout.on('data', (c: Buffer) => {
      if (outLen < STDOUT_CAP) out.push(c)
      outLen += c.length
    })
    child.stderr.on('data', (c: Buffer) => {
      // Keep the tail only: that is where the useful error is.
      err.push(c)
      errLen += c.length
      while (errLen > 64 * 1024 && err.length > 1) errLen -= err.shift()!.length
    })
    // The CLI may exit before reading all of stdin (e.g. auth failure): ignore EPIPE.
    child.stdin.on('error', () => undefined)

    const finish = (code: number | null, spawnError?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      const stdout = Buffer.concat(out).toString('utf8').slice(0, STDOUT_CAP)
      const stderr = Buffer.concat(err).toString('utf8')
      let answer: string | null = null
      if (tmp && existsSync(outFile)) answer = readFileSync(outFile, 'utf8')
      cleanup()
      const command = `${spec.binaries[0]} ${spec.args('<file>').join(' ')}`

      if (spawnError) {
        const missing = (spawnError as NodeJS.ErrnoException).code === 'ENOENT'
        reject(new AppError(missing ? `${label} not found at ${toolPath}` : spawnError.message, 'UNKNOWN', { command }))
      } else if (reason === 'cancelled') {
        reject(new AppError('Operation cancelled', 'CANCELLED', { command }))
      } else if (reason === 'timeout') {
        reject(new AppError(`${label} did not answer within ${Math.round(timeoutMs / 1000)} s`, 'UNKNOWN', { command, stderr }))
      } else if (code !== 0) {
        const tail = stderr.trim().split('\n').filter((l) => l.trim() !== '').slice(-5).join('\n')
        const detail = tail || stdout.trim().split('\n').slice(-3).join('\n')
        reject(
          new AppError(`${label} failed (exit code ${code}). ${spec.loginHint}${detail ? `\n${detail}` : ''}`, 'UNKNOWN', {
            command,
            stderr,
            exitCode: code
          })
        )
      } else {
        resolve({ stdout, answerFile: answer })
      }
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code))
    child.stdin.end(prompt, 'utf8')
  })
}

/**
 * Generates a commit message for the staged changes with the given CLI.
 * Throws AppError: nothing staged, CLI failure/timeout, CANCELLED, or empty answer.
 */
export async function generateCommitMessage(
  runner: GitRunner,
  root: string,
  tool: { id: AiTool; path: string },
  opts: GenerateOptions
): Promise<AiCommitResult> {
  opts.onProgress?.('Reading staged changes…')
  const ctx = await gatherStagedContext(runner, root, opts.amend, opts.signal)
  const prompt = buildPrompt({ ...ctx, amend: opts.amend, recentMessages: opts.recentMessages })
  opts.onProgress?.(`Asking ${AI_TOOL_LABEL[tool.id]}…`)
  const res = await runTool(tool.id, tool.path, root, prompt, { signal: opts.signal, timeoutMs: opts.timeoutMs })
  const message = cleanCommitMessage(res.answerFile?.trim() ? res.answerFile : res.stdout)
  if (message === '') throw new AppError(`${AI_TOOL_LABEL[tool.id]} returned an empty message`, 'UNKNOWN')
  return { message, tool: tool.id }
}
