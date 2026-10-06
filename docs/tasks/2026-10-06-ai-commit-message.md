# Generate commit message with an installed coding-agent CLI

- **Date:** 2026-10-06
- **Branch:** `feat/ai-commit-message`
- **Status:** done

## Context

A "Generate commit message" button in the Commit view. Rather than shipping an API client and
asking for keys, the app shells out to whichever coding-agent CLI the user already has and is
logged into: Claude Code (`claude`), OpenAI Codex (`codex`), GitHub Copilot CLI (`copilot`),
Cursor Agent (`agent` / `cursor-agent`) or Gemini CLI (`gemini`). The tool is picked in Settings
(`settings.aiCommitTool`: `'auto'` = first installed in `AI_TOOLS` order).

Contract (written before this work, unchanged): `AI_TOOLS`, `AiToolInfo`, `AiCommitResult`,
`Settings.aiCommitTool` in `src/shared/types.ts`; channels `ai:tools` and
`ai:commitMessage(root, opId, { amend })` in `src/shared/ipc.ts`; cancellation via `ops:cancel`.

## Decisions

- **Prompt goes through stdin, never argv** — argv is size-limited (32 KB on Windows) and visible
  in process lists; the diff can be large and private. A unit test asserts every tool's argv is
  short fixed flags, and the integration test checks the fake CLI's argv exactly.
- **Each CLI in its most locked-down non-interactive mode** (`src/main/ai/tools.ts`):

  | Tool | Invocation | Status |
  | --- | --- | --- |
  | claude | `claude -p --output-format text --tools "" --no-session-persistence --disable-slash-commands` | verified live (2.1.291) |
  | cursor | `agent -p --output-format text --mode ask --trust` | verified live (2026.09.15) |
  | codex | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -o <tmp> -` | flags verified against `--help` and accepted by a live run; answer path unverified (login expired here) |
  | copilot | `copilot -s --deny-tool shell --deny-tool write` (stdin = prompt) | **unverified**, from docs |
  | gemini | `gemini --output-format text` (non-TTY stdin = headless) | **unverified**, from docs |

- **Codex answer from `-o` file** (falls back to stdout if the file is missing/blank), so its
  progress noise does not matter.
- **Env**: `CI=1`, `NO_COLOR=1`, `TERM=dumb`; `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
  `ELECTRON_RUN_AS_NODE` removed; PATH = tool dir + PATH + user-local bins (npm-installed CLIs
  need `node` next to them when the app is launched from a desktop menu with a minimal PATH).
- **Detection** (`src/main/ai/detect.ts`): PATH then `~/.local/bin`, `~/.npm-global/bin`,
  `~/.bun/bin`, `~/.claude/local`, `~/.volta/bin`, pnpm, `/usr/local/bin`, `/opt/homebrew/bin`,
  `/snap/bin`; on Windows `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\{claude,cursor-agent}`,
  WinGet Links, scoop shims. A real `.exe` anywhere beats a `.cmd`/`.bat` shim. Not cached: every
  `ai:tools` call re-stats, so a fresh install appears without restart.
- **Windows `.cmd` shims**: `spawn` refuses them without a shell (EINVAL), and ESLint forbids
  `shell: true`. We spawn `%ComSpec% /d /v:off /s /c ""<path>" <flags>"` with
  `windowsVerbatimArguments`. Safe only because nothing user/model-controlled is on that line:
  flags are constants, the path is quoted, and any arg containing `"`, `%`, `!` or a newline is
  rejected.
- **Kill the whole tree** on cancel/timeout (120 s): POSIX children are spawned `detached` (own
  process group) and get SIGTERM to the group, SIGKILL after 2 s; Windows uses the existing
  `killProcessTree` (taskkill /T). Agents spawn helpers, so killing only the pid leaks them.
- **Context** (`gatherStagedContext`): `git diff --cached --no-color --no-ext-diff --no-textconv -M`
  (+ `--stat=1000,800` so paths are not abbreviated), `git log -10 --format=%s`, and for amend the
  diff `HEAD~1..index` (empty tree for a root commit) plus the current message. Nothing staged →
  `AppError('Nothing is staged…', 'INVALID_ARGUMENT')` before any CLI is spawned.
- **Prompt** (`src/main/ai/prompt.ts`, pure): Conventional-Commit style only when ≥ half of the
  recent subjects match `^(feat|fix|chore|docs|refactor|test|perf|build|ci|style)(\(.+\))?!?:`;
  otherwise imperative subject ≤ 72 chars. App-recent messages (`getPrefs().recentMessages`) are
  merged in as style examples (subjects only). Diff budget 60k chars, shared fairly per file
  (water-filling: small files whole, longest files cut with `[truncated: N more lines]`); the
  stat always lists every file.
- **Cleaning** (`src/main/ai/clean.ts`, pure): CRLF, ANSI codes, first fenced block, labels
  ("Commit message:", "Here's the commit message:", bold variants; colon required so "Commit
  message editor…" survives), surrounding quotes (only if the inner text has no such quote),
  trailing spaces, 3+ blank lines, subject/body blank line, and drops `Co-Authored-By`,
  `Signed-off-by` (the dialog has its own sign-off option) and `Generated with/by` lines.
- **Testing seam**: `GITCLIENT_AI_<TOOL>_PATH` (e.g. `GITCLIENT_AI_CLAUDE_PATH`) is taken as that
  tool's path; `.js/.cjs/.mjs` paths run as `process.execPath <script> <flags>` with
  `ELECTRON_RUN_AS_NODE=1` (inside Electron execPath is the Electron binary), so fakes need no
  chmod/shebang. `GITCLIENT_AI_NO_PATH_SEARCH=1` hides real installed CLIs for deterministic e2e.
- **Handler** (`src/main/handlers/ai.ts`): `'auto'` → first installed, else the chosen tool; clear
  `INVALID_ARGUMENT` errors when none / not installed; wrapped in
  `ctx.ops.run(opId, 'Generating commit message', true, …)` so the renderer can cancel.

## Rejected alternatives

- Calling vendor HTTP APIs directly — needs key management and per-vendor clients; the CLIs
  already hold the user's auth.
- Passing the prompt as an argument (`copilot -p "<prompt>"`, `agent "<prompt>"`) — size limits
  and process-list leaks. Copilot ignores stdin when `-p` is given, so it gets no `-p`.
- `codex exec` stdout parsing — `-o` is cleaner and version-independent.
- Caching detection results — stale after the user installs a CLI.
- Running claude with `--bare` — skips OAuth/keychain reads in some setups; `--tools ""` is
  enough to make it tool-less.

## What changed

- New `src/main/ai/tools.ts`, `detect.ts`, `prompt.ts`, `clean.ts`, `commitMessage.ts`.
- New `src/main/handlers/ai.ts`; registered in `src/main/index.ts` (`registerAiHandlers(ctx)`).
- Tests: `tests/unit/aiPrompt.test.ts` (16), `tests/integration/ai.test.ts` (9).

## Evidence

- Smoke calls (CLAUDECODE=1 in the calling env):
  - `echo "Reply with the single word pong" | claude -p --output-format text --tools "" --no-session-persistence --disable-slash-commands` → `pong`, exit 0, ~7 s. Also works with `CLAUDECODE=1` left set (print mode does not refuse nesting in 2.1.291); we unset it anyway.
  - `… | agent -p --output-format text --mode ask --trust` → `pong`, exit 0, ~12 s. Without
    `--trust` in a new directory it exits 1 with "Workspace Trust Required". Without login:
    "Authentication required. Please run 'agent login' first" (exit 1).
  - `… | codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -o <f> -` →
    exit 1, refresh token expired; stdout empty, `-o` file not created. Error path surfaces
    "ERROR: Your access token could not be refreshed…" in the AppError message.
- Live through `generateCommitMessage` on a temp repo (`clamp` helper added after a
  `feat:` commit): claude → `feat: add clamp helper` (8.6 s), cursor → `feat: add clamp helper`
  (14.6 s). Same claude run with `env -i HOME=… PATH=/usr/bin:/bin` still detects
  `~/.local/bin/claude` and succeeds.
- `npm run typecheck && npm run lint && npm test` → 29 files, 265 tests pass.

## Corrections

- Assumed Claude Code refuses to run when `CLAUDECODE=1` is set: not true for `-p` in 2.1.291.
  The var is still removed defensively (older/newer versions, interactive guards).

## Deliberately not done

- copilot and gemini invocations not run (not installed). Codex's success path not run
  (expired login). Revisit flags when they can be tested.
- No streaming of partial output to the UI; the op shows "Starting…" until done.
- No model selection per tool; each CLI uses its own default model.
- e2e not run in this half (renderer agent owns it).

## How to verify

- `npx vitest run tests/unit/aiPrompt.test.ts tests/integration/ai.test.ts`
- Manual: stage a change, click "Generate commit message" with a logged-in `claude` or `agent`.
- E2E fake: `GITCLIENT_AI_NO_PATH_SEARCH=1 GITCLIENT_AI_CLAUDE_PATH=/path/fake-claude.mjs` where
  the script reads stdin and prints a message.

## Renderer

Files: `ChangesView.tsx`, `SettingsDialog.tsx`, `ShortcutsDialog.tsx`, `src/shared/aiTool.ts` (pure `resolveAiTool`; in shared so unit tests can import it), `tests/unit/aiTool.test.ts`, `e2e/ai-commit.spec.ts`.

Decisions:

- **Button** left of "Recent" (`data-testid="ai-generate"`). Tool label from `api.ai.tools()` (query `['ai-tools']`) resolved against `settings.aiCommitTool`. Disabled with an install hint when no tool is installed, while committing, or with nothing staged and no amend.
- **Cancel on the same button**: while generating it shows a spinner and "Generating…"; clicking calls `ops:cancel`. A `CANCELLED` error is swallowed (no toast); other errors use `notifyError`. Rejected: a separate cancel control (more chrome in a tight row).
- **No extra progress UI**: the status bar already renders `op:progress` events with a cancel button.
- **Commit blocked while generating** (`doCommit` returns early, buttons disabled) so Ctrl+Enter cannot commit a half-filled message. The editor stays editable.
- **Confirm after generation**: if the field is non-empty and differs from the last generated text, `confirm()` asks before replacing. Asked after the result arrives, so the user's typing during generation is what is protected. Declining keeps the text. Editor focused after filling.
- **Shortcut Ctrl+Shift+G** (Cmd on macOS) via a window listener in ChangesView, active only when the commit panel is visible (`offsetParent !== null`), because background tabs keep their view mounted and would otherwise all react. Not added to `@shared/shortcuts` (view-local); listed in the Shortcuts dialog.
- **Settings**: select with auto-detect plus each tool ("(not installed)" suffix), resolved path in the help text, tools refetched on open plus a Refresh button.

E2E (`e2e/ai-commit.spec.ts`, fake CLI via `GITCLIENT_AI_CLAUDE_PATH`, `GITCLIENT_AI_NO_PATH_SEARCH=1`): generate and commit; confirm before replacing a typed message; cancel (fake CLI hangs via `FAKE_CLI_HANG`) with no error toast. All pass.
