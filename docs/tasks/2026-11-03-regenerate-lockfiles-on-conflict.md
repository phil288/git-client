# Regenerate conflicted lockfiles instead of asking the AI

- **Date:** 2026-11-03
- **Branch:** `feat/regenerate-lockfiles-on-conflict`
- **Status:** done

## Context

The conflict step sent every non-Markdown text conflict to the AI CLI, lockfiles included. That is
slow and costs tokens, big lockfiles hit the 200 KB limit, and a hand-merged lockfile can be wrong
anyway. The request: regenerate `Cargo.lock`, `package-lock.json` and the like during Auto Merge.

## Decisions

- **In `resolveConflictsAuto`,** so Auto Merge, Auto Rebase and Resolve with AI all get it. They share
  one conflict step on purpose (see [2026-10-27-ai-resolve-conflicts.md](2026-10-27-ai-resolve-conflicts.md)).
- **Supported:** `package-lock.json` (npm), `pnpm-lock.yaml` (pnpm), `Cargo.lock` (cargo), `uv.lock` (uv).
  Matched on exact file name, in any folder; the tool runs in the lockfile's folder.
- **Start from the Yours side, then update; do not delete and regenerate.** Deleting would upgrade every
  dependency inside its range as a side effect of a merge. Yours is the target branch for a merge and the
  upstream for a rebase. Hence `cargo update --workspace`, not `cargo generate-lockfile`.
- **Runs after the AI pass,** because the tool reads the manifests and those may be conflicted too.
- **Waits if any other conflict is left.** The manifest might be among them, and a lockfile staged from a
  half-resolved tree looks finished but is wrong. Re-running after resolving the rest finishes it.
- **Failure never falls back to the AI** and restores the conflict: `checkout --ours` keeps the index
  stages, so `checkout -m` brings the markers back after a failure, timeout or cancel. A missing tool
  or a failed run is reported in `reasons`.
- **`--ignore-scripts` for npm and pnpm, `--ignore-pnpmfile` for pnpm.** `--no-frozen-lockfile` for pnpm is
  required because `toolEnv` sets `CI=1`, which turns frozen mode on.
- **Finding the tool:** PATH plus `~/.cargo/bin` and nvm's versioned bins (newest first). A desktop launch
  has none of those on PATH. Kept in `lockfiles.ts` so the AI CLI search is unchanged.

## Rejected alternatives

- **yarn.** Classic has no lockfile-only mode (it would populate `node_modules`), and berry's `yarnPath`
  runs a script from the repository. `yarn.lock` still goes to the AI, as before.
- **composer, poetry, bundler, go.sum.** Not tried, or no minimal lockfile-only update (`composer update
  --lock` only rewrites the hash). They still go to the AI, as before.
- **Taking one side's lockfile without running a tool.** Fast, but drops the other side's new dependencies.

## What changed

- `src/main/lockfiles.ts` (new): tool table, binary lookup, `regenerateLockfile`.
- `src/main/resolveConflicts.ts`: the lockfile pass. `src/main/ai/commitMessage.ts`: exports `killTree`.
- `regenerated: string[]` on `AiResolveResult`, `AutoMergeResult` and `AutoRebaseResult`
  (`src/shared/types.ts`, `autoMerge.ts`, `autoRebase.ts`).
- `aiResolve.ts`, `AutoMergeDialog.tsx`: "Lockfiles regenerated: …" in the toasts and the stopped view.
- `README.md`: the two lines describing the conflict step.

## Evidence

- `npm run typecheck`, `npm run lint`: clean. `npm test`: 34 files, 323 tests passed.
- `e2e/ai-resolve`, `auto-merge`, `auto-rebase` specs: 6 passed. No e2e for the new toast line.
- New integration tests: without the AI; after the AI resolved the manifest; waits for other conflicts;
  tool missing or failing restores the markers; cancel restores them; rebase; real npm; full Auto Merge.
- Conflicted merges with the real tools, using the same arguments, by hand:
  - cargo 1.99: `itoa` pinned at 1.0.0 stayed pinned, both new dependencies added, `cargo metadata --locked` ok.
  - pnpm 12.11: both new dependencies present, `--frozen-lockfile --lockfile-only` ok.
  - uv: both dependencies present, `uv lock --check` ok.

## Corrections

- None.

## Deliberately not done

- **A dependency added by Theirs is re-resolved,** not copied at Theirs' pinned version, so it can land on a
  newer version inside its range.
- **No setting to turn it off, and no trust check.** Unlike the AI step (no tools, cannot touch the repo),
  this runs a package manager on the merged tree, and repo config is honoured: `.cargo/config.toml` can name
  a `rustc` wrapper and `uv lock` can run a build backend for dynamic metadata. Same exposure as running those
  tools in the checkout yourself, but the Resolve with AI and Auto Rebase buttons can reach it on someone
  else's branch.
- **A delete/modify conflict on a lockfile** still stops for a decision (for example a move from npm to pnpm).
- **Clean merges are not checked:** a lockfile that merged without conflict is not re-validated.
- **Not tried on Windows.** `.cmd` shims go through the existing `buildInvocation`.

## How to verify

```bash
npm run typecheck && npm run lint && npm test
npx vitest run tests/integration/resolveConflicts.test.ts tests/integration/autoMerge.test.ts
```

Manual check: Auto Merge a worktree whose branch and main both changed `package-lock.json`. Expect it to
finish with "Lockfiles regenerated: package-lock.json" and no AI call for that file.
