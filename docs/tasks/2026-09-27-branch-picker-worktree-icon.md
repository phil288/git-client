# Mark worktree branches in the commit toolbar branch picker

- **Date:** 2026-09-27
- **Branch:** `feat/branch-picker-worktree-icon`
- **Status:** done

## Context

The branches panel already badges local branches checked out in another worktree ([2026-09-24-branch-worktree-badge](2026-09-24-branch-worktree-badge.md)), but the compact branch picker in the Commit tool window toolbar did not: every local branch showed the same `GitBranch` icon.

## Decisions

- Same source and rule as the panel: `useWorktrees(root)`, branches held by a worktree *other than* this tab's current branch.
- The row's leading icon becomes `FolderTree` (the worktree icon used elsewhere) instead of `GitBranch`; red when the worktree is prunable. Row tooltip gives the path, `(main)`, `(missing, prunable)`.
- Picking such a branch opens its worktree in a new tab instead of running `checkoutFlow` — git refuses to check out a branch already checked out in another worktree, so checkout could only fail.

## Rejected alternatives

- Extra trailing badge next to the ahead/behind counts (panel style) — the picker rows have a free leading icon slot; replacing it keeps rows uncluttered.

## What changed

- `src/renderer/src/features/branches/BranchPicker.tsx` — worktree map, icon, tooltip, pick → open worktree.
- `e2e/worktrees.spec.ts` — in the linked worktree tab, the picker's `main` row shows the worktree icon.

## Evidence

- `npm run typecheck` clean, eslint clean on `BranchPicker.tsx`.
- `npm run test:e2e -- e2e/worktrees.spec.ts` passes.

## Left undone

- Prunable worktree: picking still tries to open the missing path (same as the panel badge click).

## How to verify

Open a repo with a linked worktree, Commit tool window → branch picker: the branch held by the other worktree shows a folder-tree icon; clicking it opens that worktree in a new tab.
