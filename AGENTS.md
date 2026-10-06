# AGENTS.md

Guide for AI coding agents (Claude Code, Codex, Cursor, Copilot, Aider…) and new contributors.
Human-facing overview: [README.md](README.md). Machine-readable summary: [llms.txt](llms.txt).

## What this is

GitClient: an Electron desktop Git GUI for Linux and Windows modeled on classic IDE Git
tooling (log + commit graph, branches, commit window, interactive rebase, 3-way merge editor).
TypeScript everywhere; React 19 + Tailwind 4 + Zustand + TanStack Query in the renderer; Monaco for
diffs and the merge editor; Vitest + Playwright for tests. Node 22.12+, git 2.30+.

## Commands

| Task | Command |
| --- | --- |
| Install deps | `npm install` (also downloads Electron) |
| Run in dev (HMR) | `npm run dev` |
| Typecheck (main + renderer, strict) | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit + integration tests | `npm test` (single file: `npx vitest run tests/unit/parsers.test.ts`) |
| E2E (builds first) | `npm run test:e2e` — on CI or without a usable Chromium sandbox: `E2E_NO_SANDBOX=1` |
| 100k-commit perf test | `npm run test:perf` |
| Package | `npm run dist:linux` / `npm run dist:win` |
| README screenshots | `npm run build && node scripts/screenshots.mjs` |

Before calling a change done: `npm run typecheck && npm run lint && npm test`, plus the relevant
`e2e/*.spec.ts` when UI behaviour changed.

## Layout

```
src/shared/     IPC contract (ipc.ts: channel maps + runtime allowlists), types.ts, pure logic
                (graph.ts lanes, merge3.ts / mergeModel.ts 3-way merge, fuzzy.ts, remotes.ts …)
src/main/       Electron main: index.ts (lifecycle, security), ipcRegistry.ts, handlers/*.ts
  git/          runner.ts (the only place git is spawned), GitService.ts, parsers.ts, one module
                per area: log, branches, rewrite, sequencer, conflicts, stash, worktrees, tagsRemotes
  repos/        recents, folder scan, .git watcher
src/preload/    contextBridge exposing typed invoke/on, filtered by the allowlists
src/renderer/   React app; src/features/<area>/ (log, branches, changes, merge, rewrite, …)
tests/unit      pure functions; tests/integration real git repos in temp dirs (tests/helpers.ts)
e2e/            Playwright driving the built Electron app against throwaway repos
docs/tasks/     one decision record per task (see below)
```

## Adding a feature end to end

1. Add the channel to `IpcInvokeMap` **and** `invokeChannelRecord` in `src/shared/ipc.ts`
   (the `satisfies` check fails otherwise).
2. Implement git logic in `src/main/git/<area>.ts` using the runner; parse machine formats only.
3. Register the handler in `src/main/handlers/<area>.ts` with `handle(...)`; validate renderer
   arguments with `assert.*` from `ipcRegistry.ts`.
4. Call it from the renderer through the preload API; add `data-testid` attributes for e2e.
5. Tests: parser/pure logic in `tests/unit`, git behaviour in `tests/integration`, UI in `e2e/`.

## Hard rules

- **Git is spawned only via `GitRunner.run(args[])`** (`child_process.spawn` without a shell).
  ESLint fails on `exec`/`execSync` and `shell: true`. Never build command strings.
- **Parse only machine formats**: `--porcelain=v2 -z`, `--format` with `%x00`/`%x1e` separators.
  Never parse human-readable git output or depend on the user's locale.
- **Keep the Electron security model**: `contextIsolation`, `sandbox`, no `nodeIntegration`,
  strict CSP, IPC sender validation, channel allowlists. Do not add `--no-sandbox` to the app
  (only tests may, via `E2E_NO_SANDBOX`).
- **Destructive git operations need a way back**: history rewriting writes backup refs
  (`src/main/git/backup.ts`); keep that when touching rebase/reset flows.
- **Persistent state** goes through `src/main/store.ts` (schema + migrations, atomic writes).
- Match the surrounding style: small modules, typed results (`IpcResult`), terse comments that
  explain *why*.

## Task records

Every non-trivial change gets `docs/tasks/YYYY-MM-DD-slug.md` (from `docs/tasks/_TEMPLATE.md`) and a
row in `docs/tasks/README.md`: context, decisions and rejected alternatives, evidence, what was left
undone, how to verify. Read the related records before changing an area — they explain why things
are the way they are. Do not edit `CHANGELOG` files per feature.
