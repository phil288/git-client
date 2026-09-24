# Worktree "merge" of uncommitted work: fake success, then offered to destroy it

- **Date:** 2026-09-24
- **Branch:** `fix/worktree-merge-nothing`
- **Status:** done

## Context

Reported after [the conflict fix](2026-09-24-worktree-merge-conflicts.md): "I tried merging one of the existing branches, didn't get a message, didn't get anything. On main, the merge did not exist."

## Evidence from the user's repo

- The running app was the installed `/opt/GitClient` build of 22:52, which already had the conflict fix (`worktree:pendingMerges` is in `app.asar`).
- `refs/gitclient-backup/main/*-merge` at 22:55:18 and 22:55:50: the merge ran twice. `main` didn't move.
- Both worktree branches (`feat/branch-worktree-badge`, `fix/log-refs-refresh`) had **0 commits** that main didn't have. All their work was **uncommitted** in the worktrees (4–6 modified/new files each). A merge only moves commits, so git answered "Already up to date". main not moving was correct.

## Root cause (reproduced, `e2e/worktree-nothing.spec.ts` probe)

1. `merge()` turned git's "Already up to date" into a **"Merged feat"** success toast.
2. The cleanup option (on by default) then went ahead. `git worktree remove` refused (dirty), and the flow offered **"Force Remove (-f -f)"**: one click from permanently deleting all the uncommitted work. The user cancelled, which from their side looked like "nothing happened".
3. The dialog's one-line note ("only committed work is merged") was easy to miss.

## Decisions

- **`mergeInto` counts `target..source` first.** At 0 it returns `merged: 0` with "Nothing to merge: every commit of X is already in Y". No backup ref, no git merge. On success the message says how many commits were merged. `WorktreeMergeResult.merged` is new.
- **`merge()` (also used by the regular Merge dialog)** reports "Nothing to merge" instead of "Merged" when `HEAD..ref` is empty.
- **Merge dialog** shows "N commits of X will be merged into Y", computed live via the new `worktree:commitsToMerge`. At 0 it shows a red "Nothing to merge" block. If there are uncommitted changes it adds "Commit them first" and a **Commit changes in this worktree…** button that opens that worktree's Commit view. The Merge button is disabled and labelled "Merge N commits".
- **Cleanup never discards work.**
  - The cleanup checkbox is disabled while the worktree is dirty.
  - The flow re-checks `quickStatus` after merging. If the worktree is dirty it keeps it and says why: the changes were not merged, commit them and merge again.
  - Removal in the cleanup path uses `askForce = false`, so it can no longer escalate to `-f -f`.
- After a merge, if uncommitted changes remain, a warning toast always says they were not merged.

## Rejected alternatives

- **Auto-commit or stash the uncommitted work before merging**: silently creating commits on the user's behalf is surprising, and the message would be generic. Pointing the user at the Commit view is explicit.
- **Keep offering force removal after a merge**: that's the step that almost destroyed the user's work. Force removal stays available only through the explicit Remove dialog.

## What changed

- `src/main/git/worktrees.ts`: `commitsToMerge`, early "nothing to merge", `merged` count in results.
- `src/main/git/branches.ts`: `merge()` reports "Nothing to merge".
- `src/main/handlers/worktrees.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/renderer/src/lib/api.ts`: `worktree:commitsToMerge`, `WorktreeMergeResult.merged`.
- `src/renderer/src/features/worktrees/WorktreeDialogs.tsx`: commit count, nothing-to-merge block, Commit-first button, cleanup disabled when dirty.
- `src/renderer/src/features/worktrees/worktreeFlows.ts`: no cleanup on `merged: 0` or on a dirty worktree, never forces, explicit warnings.
- `src/renderer/src/lib/views.ts`: `showCommitView`.
- Tests: new integration cases (worktrees "nothing to merge", branches re-merge message). New `e2e/worktree-nothing.spec.ts`. `e2e/worktree-conflicts.spec.ts` now finishes with Remove, because an empty second merge is refused.

## Evidence

- Probe before the fix (screenshot): a "Merged feat" toast plus a "Worktree has local changes → Force Remove (-f -f)" dialog, with main unchanged.
- After the fix: `npm test` 219/219 passes. e2e: 15/16 pass. `window-state.spec.ts` (not touched here) fails only in the full run and passes alone, so it depends on test order. Flagged separately.

## Corrections

- The previous fix assumed the reported "loss" was only the conflict path. This report is a different path: a no-op merge reported as success, followed by an offer to force-remove.

## Deliberately not done

- The two real worktrees in `git-manager` (`../git-manager-branch-worktree-badge`, `../git-manager-log-refs`) were left untouched. Their uncommitted work is intact.

## How to verify

```bash
npm test -- tests/integration/worktrees.test.ts tests/integration/branches.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktree-nothing.spec.ts e2e/worktree-conflicts.spec.ts
```

In the app: open a worktree that has only uncommitted changes and click *Merge into main…*. The dialog says "Nothing to merge", Merge is disabled, and *Commit changes in this worktree…* opens its Commit view.
