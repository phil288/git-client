# Drop deleted branches from the Log Branch filter

- **Date:** 2026-09-24
- **Branch:** `fix/log-refs-refresh`
- **Status:** done

## Context

User report: after deleting a branch it should disappear from the Git Log toolbar area automatically. Investigation showed the ref labels in the log table already refresh (repo watcher → `repo:changed` → `['repo', root]` invalidation). The stale piece was the **Branch** filter: `query.revs` (per-tab UI state) kept `refs/heads/<deleted>`, so the chip kept showing it and the log was asked to walk a ref that no longer exists.

## Decisions

- `LogView` effect: whenever the refs query changes, drop any `refs/heads|remotes|tags/*` rev not present in the refs list. Other revs (`HEAD`, hashes) are left untouched.
- Fix at the query-state level rather than in `LogToolbar` so any view that sets `revs` benefits.

## Rejected alternatives

- Validating revs in the main-process `log` handler — hides the problem from the UI; the chip would still show the dead branch.

## What changed

- `src/renderer/src/features/log/LogView.tsx` — prune stale revs from the log query.
- `e2e/log-refs.spec.ts` (new) — labels vanish after delete from the panel, from the CLI (loose ref) and for a packed ref; a deleted branch is dropped from the Branch filter.

## Evidence

- Filter test fails without the fix (`Received string: "Branch: refs/heads/topic"`), passes with it.
- Typecheck + eslint clean; e2e results below.

## Corrections

- First hypothesis (log labels not refreshing after delete) was wrong: the label test passed on unmodified code.
- The first copy of this work was lost: it sat uncommitted in a worktree that was removed (outside this session) along with its branch. Restored onto a fresh `fix/log-refs-refresh` from `main` (`a138e84`); `LogView.tsx` was unchanged on `main` since the original base, so the fix applied as-is.

## Deliberately not done

- Deleting a local branch still leaves its `origin/<name>` remote-tracking label (correct git behaviour; fetch already runs with `--prune`). No "also delete tracked remote branch" option.

## How to verify

```bash
npm run test:e2e -- e2e/log-refs.spec.ts
```
Manually: Log → Branch ▾ → tick a branch → delete it (panel or `git branch -D`) → chip clears, full log shows.
