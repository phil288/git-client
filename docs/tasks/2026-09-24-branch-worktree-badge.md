# Mark branches checked out in a worktree

- **Date:** 2026-09-24
- **Branch:** `feat/branch-worktree-badge`
- **Status:** done

## Context

The branches panel gave no hint that a local branch was checked out in another worktree, so a user could try to check it out (git refuses) or delete it without knowing a worktree holds it.

## Decisions

- Badge = `FolderTree` icon (same icon as the Worktrees stripe and view), after the branch label, on local branch rows only — in every section (Favorites, Recent, Local, search results).
- Source is the existing `['repo', root, 'worktrees']` query (`useWorktrees`), so `refreshRepo` already invalidates it; no new IPC.
- The tab's own current branch is not badged: it is already bold, and "checked out here" is not news. Only branches held by *another* worktree are marked (matched by `w.branch !== currentBranch`, which avoids path-normalisation issues when comparing `w.path` to the tab root).
- Tooltip shows the worktree path, `(main)` for the main worktree, `(missing, prunable)` when its directory is gone (icon turns red). Clicking the badge opens that worktree in a new tab.

## Rejected alternatives

- Text chip ("worktree") like `gone` — too wide for the 22px tree rows next to ahead/behind and no-upstream icons.
- Adding a `worktree` field to `Ref` in the main process — heavier, duplicates data the worktree query already has.

## What changed

- `src/renderer/src/features/branches/BranchesPanel.tsx` — worktree lookup map + badge button.
- `e2e/worktrees.spec.ts` — in the linked worktree tab, `main` has the badge and the tab's own `feat/e2e` does not.

## Evidence

- `npm run typecheck` clean, eslint clean on touched files.
- `playwright test e2e/worktrees.spec.ts e2e/branches.spec.ts`: 4 passed.

## Corrections

None.

## Deliberately not done

- Blocking checkout/delete of a worktree-held branch in `BranchMenu` — git already refuses with a clear error; can add later.
- A worktree added outside the app shows up only after the next repo refresh (same as the Worktrees view).

## How to verify

```bash
npm run typecheck
npm run test:e2e -- e2e/worktrees.spec.ts
```

Manually: `git worktree add ../repo-x -b feat/x`, refresh — `feat/x` shows the tree icon; hover shows the path; click opens it in a new tab.
