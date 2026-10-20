# Per-tool model setting for AI commit messages

- **Date:** 2026-10-20
- **Branch:** `feat/ai-model-per-tool`
- **Status:** done

## Context

"Generate commit message" ran every CLI with fixed flags, so each one used its own
configured default model. The user wanted to pick the model from GitClient
(e.g. a cheap model for commit messages) without editing each CLI's config.
Builds on [2026-10-06-ai-commit-message](2026-10-06-ai-commit-message.md).

## Decisions

- **`aiModels: Partial<Record<AiTool, string>>` in Settings**, missing / `''` = CLI default.
  Per tool because model names are tool-specific (`sonnet` means nothing to codex);
  switching tools keeps each one's choice.
- **Passed as `--model <name>`** — every supported CLI accepts that spelling
  (claude, codex `exec`, copilot, cursor `agent`, gemini). Appended at the end of the
  fixed flags, except codex where it goes before `-o <file> -` because the trailing `-`
  (read prompt from stdin) must stay last.
- **Strict whitelist, `isValidAiModel` in `src/shared/aiTool.ts`:**
  `^$|^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,99}$`. Covers real ids (`opus[1m]`,
  `gpt-5-codex`, `openai/gpt-5`, `...-v1:0`). Reasons:
  - The model is the first user-controlled value on the Windows `.cmd` shim command line
    (`buildInvocation` → `cmd.exe /s /c "..."`). The whitelist excludes everything cmd
    interprets (`"%!&|<>^()`, whitespace, newlines), so the "flags are constants" safety
    argument still holds.
  - Must start alphanumeric so a value can never be read as another flag (`--tools x`).
- **Checked in three places:** store schema `pattern` (rejects bad `settings:update`),
  `runTool` (a hand-edited state file is only schema-checked on load; rejects with
  `INVALID_ARGUMENT` before spawning or creating the temp dir), and the Settings input
  (saves only while valid, shows an inline error, so typing never toasts).
- **UI: one "<Tool> model" field for the tool that would actually run** (auto resolves to
  the first installed one), not five fields — keeps the Tools section short. The input is
  keyed by tool so switching tools resets the draft.
- Leading/trailing whitespace is trimmed before validation and use.

## Rejected alternatives

- **Free-form "extra arguments" field** — far more flexible, but breaks the
  constant-flags guarantee (could re-enable tools, write sessions, or inject on the cmd
  line). Rejected for security.
- **Dropdown of known models per CLI** — model lists change monthly and differ by account;
  would be stale immediately. CLIs validate names themselves and report errors via the
  existing stderr/login-hint path.
- **Env vars (`ANTHROPIC_MODEL`, `GEMINI_MODEL`)** instead of `--model` — not uniform
  across the five CLIs.

## What changed

- `src/shared/types.ts` — `Settings.aiModels`, default `{}`.
- `src/shared/aiTool.ts` — `AI_MODEL_PATTERN`, `isValidAiModel`.
- `src/main/store.ts` — schema for `aiModels` (known tool keys only, pattern-checked).
- `src/main/ai/tools.ts` — `args(outFile, model?)`, shared `modelArgs`; comments updated.
- `src/main/ai/commitMessage.ts` — `runTool` option `model`, validated; `generateCommitMessage`
  takes `tool.model`; error `command` detail shows the model.
- `src/main/handlers/ai.ts` — reads `aiModels[tool.id]` for the resolved tool.
- `src/renderer/src/features/settings/SettingsDialog.tsx` — `AiModelInput` row.
- Tests: `tests/unit/aiTool.test.ts`, `tests/unit/aiPrompt.test.ts`,
  `tests/integration/ai.test.ts`, `e2e/ai-commit.spec.ts`.

## Evidence

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 29 files, 272 tests passed.
- `E2E_NO_SANDBOX=1 npx playwright test e2e/ai-commit.spec.ts`: 4 passed, including the new
  "model set in Settings is passed to the CLI as --model" (invalid value flagged, valid
  `opus[1m]` reaches the fake CLI's argv).

## Corrections

None.

## Deliberately not done

- Not run live with `--model` against real CLIs. `--help` on this machine (2026-10-20)
  lists `--model` for `claude`, `agent` (cursor) and `codex exec`; copilot and gemini are
  not installed here, so their flag is from docs only, like the rest of their flags.
- No reasoning-effort / other per-tool options.
- The store-schema rejection path is not unit-tested (store needs Electron); covered by
  the renderer never sending invalid values and by `runTool`'s own check.
- No "agy" / other CLIs added.

## How to verify

```bash
npm test
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/ai-commit.spec.ts
```

Manually: Settings → Tools → choose Claude Code → set model `haiku` → Generate in the commit
panel; on failure the error detail shows `claude -p ... --model haiku`.
