# Worktrees Refresh re-checks the "nothing to merge" badges

- **Date:** 2026-10-11
- **Branch:** `fix/worktree-refresh-merge-status`
- **Status:** done

## Context

In the Worktrees view, a worktree with uncommitted edits kept showing "nothing to merge into main"
(no "· N uncommitted") after Refresh; only leaving the view and coming back updated it. The badge
(see [2026-10-06-worktree-nothing-to-merge](2026-10-06-worktree-nothing-to-merge.md)) derives from
`commitsToMerge` (`['repo', root, …]`) and the other worktree's `['quickStatus', path, 'worktree']`,
but the toolbar Refresh only called `refetch()` on the worktree list. Remounting the view refetched
the stale queries, hence the workaround.

## Decisions

- Refresh now runs `refreshRepo(root)` and invalidates `['quickStatus', w.path]` for every listed
  worktree — the same invalidation the `repo:changed` handler in `App.tsx` does.
- Regression e2e uses *uncommitted* edits: a commit in another worktree moves a shared ref, which the
  `.git` watcher already reports, so a commit-based test passed even without the fix.

## Rejected alternatives

- Polling worktree quickStatus — cost on every open Worktrees view for a rare need; Refresh is the
  explicit user signal.
- Watching other worktrees' working trees — the watcher deliberately covers `.git` only.

## What changed

- `src/renderer/src/features/worktrees/WorktreesView.tsx`: `refreshAll`, wired to the Refresh button
  (`data-testid="wt-refresh"`).
- `e2e/worktree-nothing.spec.ts`: "Refresh re-counts uncommitted changes of another worktree".

## Evidence

- New e2e fails on the old Refresh (final assertion, line 102), passes with the fix.
- `npm run typecheck && npm run lint && npm test`: 266/266 pass; worktree e2e specs 4/4 pass.

## Corrections

- First guess was a commit made in the worktree tab; the watcher already handles that. The user's
  case was uncommitted files, which no event reports.

## Deliberately not done

- Edits in another worktree still do not update the badge automatically; Refresh (or reopening the
  view) is needed.

## How to verify

`npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktree-nothing.spec.ts`. Manually: edit a
file in a clean sibling worktree, click Refresh in Worktrees → badge gains "· 1 uncommitted".
