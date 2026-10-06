import { basename } from 'node:path'
import type { AiTool } from '@shared/types'
import { AppError } from '../git/errors'

/**
 * How each coding-agent CLI is run to produce one commit message.
 *
 * Common rules for every tool:
 * - The prompt (which embeds the diff) is written to **stdin**, never argv:
 *   argv has size limits (32 KB on Windows) and is visible in process lists.
 * - Non-interactive, and read-only / no tools as far as the CLI allows: the
 *   prompt already contains everything the model needs.
 * - Flags are fixed constants. That is what makes the Windows `.cmd` shim
 *   path in {@link buildInvocation} safe.
 *
 * Verification status (2026-10-06, see docs/tasks/2026-10-06-ai-commit-message.md):
 * - claude 2.1.291: verified live (stdin prompt, `--tools ""`, answer on stdout).
 * - cursor agent 2026.09.15: verified live (stdin prompt; `--trust` is required
 *   or it exits asking for workspace trust).
 * - codex-cli 0.142.5: flags verified against `--help` and accepted by a live
 *   run, but that run failed at login, so the answer path is from the docs.
 * - copilot, gemini: NOT installed here; flags taken from their docs. Unverified.
 */
export interface AiToolSpec {
  id: AiTool
  /** Executable base names, in preference order (no extension). */
  binaries: readonly string[]
  /** Fixed arguments. `outFile` is a temp file for tools that can write their final answer to one. */
  args(outFile: string): string[]
  /** The final answer is read from `outFile` (falling back to stdout if the file is missing). */
  answerInFile?: boolean
  /** Shown when the CLI fails: usually it is not logged in. */
  loginHint: string
}

export const AI_TOOL_SPECS: Record<AiTool, AiToolSpec> = {
  claude: {
    id: 'claude',
    binaries: ['claude'],
    // --tools "" disables every built-in tool; no session file is written; no skills.
    args: () => ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence', '--disable-slash-commands'],
    loginHint: 'Is `claude` logged in? Run it once in a terminal.'
  },
  codex: {
    id: 'codex',
    binaries: ['codex'],
    // `-` = read the prompt from stdin. Read-only sandbox, no session files, and the
    // last agent message goes to a file so progress noise on stdout/stderr is irrelevant.
    args: (outFile) => ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', outFile, '-'],
    answerInFile: true,
    loginHint: 'Is `codex` logged in? Run `codex login` in a terminal.'
  },
  copilot: {
    id: 'copilot',
    binaries: ['copilot'],
    // UNVERIFIED (docs): piped stdin is the prompt and runs non-interactively; it is
    // ignored when -p is also given, so no -p. -s prints only the agent's answer.
    args: () => ['-s', '--deny-tool', 'shell', '--deny-tool', 'write'],
    loginHint: 'Is `copilot` logged in? Run it once in a terminal and use /login.'
  },
  cursor: {
    id: 'cursor',
    binaries: ['agent', 'cursor-agent'],
    // --mode ask = read-only Q&A. --trust is required in print mode, otherwise it exits
    // with "Workspace Trust Required"; harmless here because ask mode cannot edit or run.
    args: () => ['-p', '--output-format', 'text', '--mode', 'ask', '--trust'],
    loginHint: 'Is Cursor Agent logged in? Run `agent login` in a terminal.'
  },
  gemini: {
    id: 'gemini',
    binaries: ['gemini'],
    // UNVERIFIED (docs): a non-TTY stdin triggers headless mode with stdin as the prompt.
    // In headless mode, tools that need approval are not run.
    args: () => ['--output-format', 'text'],
    loginHint: 'Is `gemini` logged in? Run it once in a terminal.'
  }
}

/** `GITCLIENT_AI_CLAUDE_PATH` etc.: testing/override seam honoured by detection and spawning. */
export function overrideEnvVar(id: AiTool): string {
  return `GITCLIENT_AI_${id.toUpperCase()}_PATH`
}

export interface Invocation {
  command: string
  args: string[]
  /** Windows only: pass args to cmd.exe untouched (we quote them ourselves). */
  windowsVerbatimArguments?: boolean
  /** Extra env for this invocation. */
  env?: Record<string, string>
}

const SCRIPT_RE = /\.(c|m)?js$/i
const SHIM_RE = /\.(cmd|bat)$/i

/**
 * Turns a resolved tool path + fixed flags into what is actually spawned.
 *
 * - `.js/.cjs/.mjs` (tests and e2e fakes via `GITCLIENT_AI_<TOOL>_PATH`): run with
 *   our own runtime, `process.execPath <script> <flags>`, so tests need no chmod or
 *   shebang. Inside Electron, execPath is the Electron binary, hence
 *   ELECTRON_RUN_AS_NODE=1.
 * - Windows `.cmd`/`.bat` npm shims: spawn() refuses them without a shell (EINVAL
 *   since the 2024 BatBadBut fix), so we run `cmd.exe /d /s /c ""<path>" <flags>"`.
 *   This is safe ONLY because nothing user- or model-controlled reaches this
 *   command line: the prompt goes through stdin, flags are constants, and the
 *   path and temp file are quoted and rejected if they contain characters cmd
 *   would still interpret inside quotes (`"`, `%`, `!`, newlines).
 * - Everything else is spawned directly.
 */
export function buildInvocation(
  path: string,
  flags: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath
): Invocation {
  if (SCRIPT_RE.test(path)) {
    return { command: execPath, args: [path, ...flags], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  if (platform === 'win32' && SHIM_RE.test(path)) {
    const quote = (s: string): string => {
      if (/["%!\r\n]/.test(s)) throw new AppError(`Cannot run ${basename(path)}: unsupported character in "${s}"`, 'INVALID_ARGUMENT')
      return s === '' || /[\s&|<>^()]/.test(s) ? `"${s}"` : s
    }
    const line = [`"${quote(path).replace(/^"|"$/g, '')}"`, ...flags.map(quote)].join(' ')
    return {
      command: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
      windowsVerbatimArguments: true
    }
  }
  return { command: path, args: [...flags] }
}
