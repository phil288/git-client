# Commit view: branch picker and stage-all

- **Date:** 2026-09-24
- **Branch:** `feat/branch-switcher`
- **Status:** done

## Context

From the Commit tool window you could not change branch (you had to go to Git Log → Branches panel) and staging everything meant ticking the "Changes" and "Unversioned Files" section boxes separately.

## Decisions

- New `BranchPicker` component (`features/branches/BranchPicker.tsx`) in the Commit toolbar: shows current branch (short SHA when detached), opens a popover with fuzzy search, keyboard nav (↑/↓/Enter), "New Branch…" entry, local branches (current first, then by tip date) then remote branches.
- Checkout goes through the existing `checkoutFlow`, so Smart/Force checkout on local changes and error reporting behave exactly like the Branches panel.
- Remote branches already tracked by a local branch are hidden (the local entry covers them) to keep the list short.
- Stage-all is a tri-state checkbox at the left of the Commit toolbar covering tracked + unversioned, non-conflicted files (equivalent to `git add -A`); clicking when fully staged unstages all. Reuses existing `api.wt.stage/unstage`, no new IPC.
- Picker reads the shared `['repo', root, 'info' | 'refs']` queries directly instead of importing `useRepoInfo`/`useRefs` to avoid a RepoView ↔ ChangesView import cycle.

## Rejected alternatives

- Reusing `BranchMenu` context menu — it is per-ref actions, not a picker.
- Making the title-bar `RepoSwitcher` branch text clickable — that widget already opens the repo list; splitting its click target is less discoverable.
- A separate `git add .` IPC — stage with the explicit path list is identical in effect and already handles the index refresh.

## What changed

- `src/renderer/src/features/branches/BranchPicker.tsx` (new)
- `src/renderer/src/features/changes/ChangesView.tsx` — toolbar: stage-all checkbox, branch picker
- `e2e/branches.spec.ts` — two new tests

## Evidence

- `npm run typecheck`, `eslint` clean.
- `npm run test:e2e -- e2e/branches.spec.ts e2e/commit.spec.ts` → 4 passed.
- `npm test` passes.

## Corrections

None.

## Deliberately not done

- No per-branch actions (merge/rebase/delete) in the picker; those stay in the Branches panel.
- No tags in the picker (detached checkout is a rarer flow, available from Log).
- Conflicted files are excluded from stage-all (same as section checkboxes); resolve via the conflicts dialog.

## How to verify

```bash
npm run test:e2e -- e2e/branches.spec.ts
```
Manually: open Commit view → click the branch label in the toolbar → type part of a branch name → Enter. Tick the leftmost toolbar checkbox → all files staged, "N of N staged".
