# Auto Merge All worktrees into main

- **Date:** 2026-10-29
- **Branch:** `feat/auto-merge-all-worktrees`
- **Status:** done

## Context

Request: "add an option to auto merge all worktrees on main". The one-click Auto Merge
([2026-10-27-worktree-auto-merge.md](2026-10-27-worktree-auto-merge.md)) works on one linked
worktree at a time. With several worktrees in flight, the user had to click each one and wait.

## Decisions

- **Queue in the renderer, no new IPC.** `AutoMergeDialog` now takes `worktrees: WorktreeEntry[]` and
  calls the existing `worktree:autoMerge` for each, in order. The main-side pipeline is unchanged and
  already re-entrant, so nothing new needed testing there. Single-worktree buttons pass a one-item list.
- **Sequential, stop at the first that needs the user.** Merges go into the same target worktree, so
  they cannot run in parallel. `blocked` (dirty main) keeps the auto-resume, and the queue carries on
  after it. `stopped` (conflicts the AI could not resolve) hands over to Resolve… as before.
- **Errors can be skipped.** A thrown error (locked, detached, cancelled…) offers **Skip to next**,
  which leaves that worktree as it is. `stopped` has no skip: its open merge would block every other one.
- **Confirmation for All only.** The single button still starts without asking (the earlier user choice).
  The bulk action removes many folders and branches, so it confirms with the list of branches.
- **Toolbar button** `Auto Merge All (N)` in the Worktrees view, shown when 2+ worktrees are eligible.
  Eligibility is the single button's rule (`canAutoMerge`): linked, on a branch, not locked or missing,
  not the default branch.
- **Resuming after a stop:** re-running All puts the worktree whose merge is open first (Auto Merge
  resumes it). Any other open merge (not from a queued branch) refuses with a toast.
- Each finished worktree still gets its own success toast (AI-resolved files listed per worktree).

## Rejected alternatives

- **A main-process `worktree:autoMergeAll` operation.** One more channel, a second result type and a
  merged progress stream, for no behaviour the renderer loop does not already give.
- **Continuing past a `stopped` worktree.** The open merge in main blocks every later one anyway.

## What changed

- `src/renderer/src/features/worktrees/AutoMergeDialog.tsx`: queue (`runOne`, index, "n of N" in the
  title, Skip to next on errors).
- `src/renderer/src/features/worktrees/WorktreesView.tsx`: `canAutoMerge`, `autoMergeAllFlow`, toolbar
  button `wt-auto-merge-all`.
- `src/renderer/src/stores/modals.ts`: `autoMerge` modal carries `worktrees`.
- `e2e/auto-merge.spec.ts`: new test — two worktrees (one with uncommitted work), both md-conflicting,
  merged in one go.

## Evidence

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 34 files, 315 tests passed.
- `E2E_NO_SANDBOX=1 npx playwright test e2e/auto-merge.spec.ts`: 2 passed.
- Regression: `worktrees`, `worktree-conflicts`, `worktree-nothing` e2e: 4 passed.

## Deliberately not done

- No summary toast at the end of the queue; the per-worktree toasts already say what happened.
- No choice of target branch: like the single Auto Merge, the target is the default branch.
- No entry in the linked-worktree bar; All lives in the Worktrees view only.

## How to verify

```bash
npm run typecheck && npm run lint && npm test
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/auto-merge.spec.ts
```

Manual: create two worktrees with commits, open the Worktrees view, click **Auto Merge All (2)**,
confirm. Both are merged into main and removed, one after the other.
