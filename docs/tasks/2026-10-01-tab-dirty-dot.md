# Dirty dot on repo tabs

- **Date:** 2026-10-01
- **Branch:** `feat/tab-dirty-dot`
- **Status:** done

## Context

Nothing in the tab strip showed that a repository had uncommitted work. With several repos and worktrees open, you had to open each tab to find leftover changes. Each tab now shows a small dot after its title when **any** worktree of that repo (main or linked) has staged, unstaged, untracked or conflicted changes.

## Decisions

- New hook `useDirtyWorktreeCount(root)` (`features/tabs/useDirtyWorktreeCount.ts`): takes the paths from `useWorktrees(root)` (skipping bare and prunable entries) and runs `repo:quickStatus` on each one with `useQueries`. It returns how many are dirty. Until the worktree list loads, it checks only the tab's own path.
- It reuses the `['quickStatus', path]` cache key of the welcome-screen recents, so both share one result, and the existing `repo:changed` prefix invalidation of `['quickStatus', root]` already reaches it.
- **Polling, 15 s, plus refetch on window focus.** `RepoWatcher` watches only `.git`, not the working tree, so editing a file sends no event. React Query stops the interval while the window is hidden. `quickStatus` goes through main's `statusLimiter`, so many tabs × worktrees cannot flood git.
- On `repo:changed`, `App.tsx` now also invalidates `quickStatus` for every cached worktree of that root. A commit in a linked worktree moves a shared ref under the common dir, which the main tab's watcher does see, so the dot clears right away instead of waiting for the next poll.
- Dot: `size-1.5 rounded-full bg-warning` right after the name. Warning/amber reads as "modified", and the accent blue is already used for the active tab underline. The tooltip on the dot says "Uncommitted changes" or "…in N worktrees".

## Rejected alternatives

- Putting the dirty info in the tab `title`: the e2e helper `tabNames` parses that title, and a tooltip on the dot is more specific.
- Invalidating every `['quickStatus']` query on each `repo:changed`: this would refetch the whole recents list on every auto-fetch.
- Watching working trees with chokidar: too heavy for large repos (node_modules and so on). The watcher file already defers that.

## What changed

- `src/renderer/src/features/tabs/useDirtyWorktreeCount.ts`: new hook.
- `src/renderer/src/features/tabs/TabBar.tsx`: dot + `data-testid="repo-tab-dirty"`.
- `src/renderer/src/App.tsx`: invalidates sibling-worktree quickStatus on `repo:changed`.
- `e2e/tabs.spec.ts`: a repo with a dirty linked worktree shows the dot; after a commit in that worktree the dot clears.

## Evidence

- `npm run typecheck`: clean. ESLint on the touched files: clean.
- `npm test`: 225 passed.
- `playwright test e2e/tabs.spec.ts e2e/worktrees.spec.ts`: 3 passed.

## Corrections

None.

## Deliberately not done

- No count or number in the tab, only a dot. The count is in the tooltip.
- Edits in the working tree show up within ≤15 s (or on window focus), not instantly.

## How to verify

```bash
npm run test:e2e -- e2e/tabs.spec.ts
```

Manually: open a repo, `git worktree add ../x -b x`, `touch ../x/foo`. Within 15 s (or on refocus) the repo tab shows an amber dot. Commit in `../x` and the dot disappears.
