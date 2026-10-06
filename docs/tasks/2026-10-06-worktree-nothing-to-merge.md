# Worktree list shows when there is nothing to merge

- **Date:** 2026-10-06
- **Branch:** `feat/worktree-nothing-to-merge`
- **Status:** done

## Context

The Worktrees view and the linked-worktree bar always offered "Merge into main", even when the
branch had no commit that main lacked. You only found out after opening the merge dialog.

## Decisions

- Reuse the existing `worktree:commitsToMerge` IPC (`rev-list --count def..branch`) through a shared
  `useCommitsToMerge` hook; the merge dialog uses the same hook and query key, so both share one cache entry.
- Two states: **nothing to merge into main** (green: every commit is already in main and the tree is clean)
  and **nothing committed to merge · N uncommitted** (amber: work exists but is not committed, and a merge never takes it).
- The uncommitted count (`quickStatus`) is only fetched for rows that are 0 ahead, so a long list
  does not run a status in every worktree.
- Row: badge shown and the "Merge into main" button hidden. The context-menu item stays, so you can still merge
  into another branch or reach the dialog's "Commit changes…" shortcut.
- Linked-worktree bar: a status label is added and the Merge button becomes ghost but stays. The dialog's
  commit-first flow and the existing e2e flows depend on it.

## Rejected alternatives

- Computing ahead counts inside `listWorktrees`: that function is used by many main-process paths
  (remove, merge, pending merges), and each call would then run an extra `rev-list` for every worktree.
- Disabling the bar's Merge button: this blocks the "Commit changes…" path that the dialog offers.

## What changed

- `src/renderer/src/features/worktrees/WorktreeDialogs.tsx`: `useChangedCount` is exported (with an `enabled` flag),
  and `useCommitsToMerge` is new. The merge dialog now uses `useCommitsToMerge`.
- `src/renderer/src/features/worktrees/WorktreesView.tsx`: `useNothingToMerge`, a `success` badge tone,
  the row badge (`wt-nothing-to-merge`) and the bar label (`bar-nothing-to-merge`).
- `e2e/worktree-nothing.spec.ts`: asserts the bar and row before the commit, that the label is gone after a commit,
  and the bar label after the merge.

## Evidence

`npm run typecheck && npm run lint` clean; `npm test` 266 passed; worktree e2e specs
(`worktree-nothing`, `worktrees`, `worktree-conflicts`) 3/3 pass.

## Corrections

None.

## Deliberately not done

- No badge when the default branch is unknown: there is no target to compare against.
- Freshness across tabs uses the existing query invalidation. A commit made from another tab shows up on that tab's next refresh.

## How to verify

`npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktree-nothing.spec.ts`. Manually: create a worktree
without committing, then open Worktrees. The row shows a green "nothing to merge into main" badge and no Merge button.
Edit a file and the badge turns amber with the uncommitted count.
