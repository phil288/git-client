# Worktree count badge on the tool-window stripe

- **Date:** 2026-09-30
- **Branch:** `feat/worktree-count-badge`
- **Status:** done

## Context

The Worktrees icon in the left tool-window stripe gave no hint that linked worktrees exist. The Commit icon already shows a change count; the Worktrees icon should show how many worktrees exist besides the main one.

## Decisions

- Count = worktrees with `!isMain` from the existing `useWorktrees(root)` query (`['repo', root, 'worktrees']`). The query is already mounted by `BranchesPanel` / `BranchPicker`, so the badge adds no extra `git worktree list` call.
- Prunable (missing-folder) worktrees are counted: they still exist in git's bookkeeping and are listed in the view until pruned.
- Generalised the stripe badge into a `badges: Partial<Record<RepoViewKind, number>>` map instead of a second hard-coded `s.id === …` branch; same styling and `99+` cap as the Commit badge.
- Added `data-testid="stripe-<id>-badge"` for e2e.

## Rejected alternatives

- A separate badge colour for worktrees — kept the existing accent pill for visual consistency with the Commit count.

## What changed

- `src/renderer/src/features/repo/RepoView.tsx` — worktree count, badge map, testid.
- `e2e/worktrees.spec.ts` — asserts no badge initially, `1` after creating a worktree, `1` with the dirty one, none after removal.

## Evidence

- `tsc --noEmit -p tsconfig.web.json`: clean. ESLint on `RepoView.tsx`: clean.
- `playwright test e2e/worktrees.spec.ts e2e/worktree-nothing.spec.ts`: 2 passed.

## Corrections

None.

## Deliberately not done

- Inside a linked worktree tab the count still includes that worktree itself (it is "a worktree other than main"). Not excluded.

## How to verify

```bash
npm run test:e2e -- e2e/worktrees.spec.ts
```

Manually: open a repo, `git worktree add ../x -b x`, refresh — Worktrees stripe icon shows `1`.
