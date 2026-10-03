# Staging failed on an already-staged deletion

- **Date:** 2026-10-03
- **Branch:** `fix/stage-staged-deletion`
- **Status:** done

## Context
Staging a batch that contained a file whose deletion was already staged (porcelain `D.`: gone from both the
index and the worktree) failed with `fatal: pathspec '<path>' did not match any files`
(`git add -A --pathspec-from-file=- --pathspec-file-nul`). The whole batch aborted, and since the file stayed
in the list, every retry hit the same error — the user could not get out. Seen with
`apps/mobile/.claude/settings.json`.

Reproduced in a scratch repo: `git rm f && printf 'f\0' | git add -A --pathspec-from-file=- --pathspec-file-nul` → exit 128.

## Decisions
- `stageFiles` reads `workingStatus` first and only passes paths with something to stage:
  untracked, conflicted (add resolves them), or worktree status != `.`. Nothing left → no-op.

## Rejected alternatives

- `--ignore-missing` (git only allows it with `--dry-run`).
- `--ignore-errors` (only about unreadable files, not unmatched pathspecs).
- Catching the error and retrying path-by-path (slower, still noisy).

## What changed
- `src/main/git/workingTree.ts` — `stageFiles` filters out fully-staged/clean paths.
- `tests/integration/workingTree.test.ts` — regression: stage `[staged-deletion, untracked]` together.

## Evidence
- New assertion fails on the old code with `AppError: pathspec 'README.md' did not match any files`, passes with the fix.
- `tsc` clean.

## Corrections

None.

## Deliberately not done
- Extra `git status` per stage call (cheap, `--no-optional-locks`). Not measured on huge repos.

## How to verify
`npx vitest run tests/integration/workingTree.test.ts`. Manually: `git rm` a file, then tick it (plus another file) in the app → stages without error.
