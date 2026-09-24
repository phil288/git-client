# Worktree management (create, remove with -f -f, merge into main)

- **Date:** 2026-09-24
- **Branch:** `feat/worktree-management`
- **Status:** done

## Context

The app could open linked worktrees (`RepoInfo.isLinkedWorktree`) but had no way to manage them. Request: manage worktrees easily from the UI — delete (including `git worktree remove -f -f`) and merge a worktree's branch into main.

## Decisions

- **New "Worktrees" tool window** (stripe icon under Stashes) listing `git worktree list --porcelain`: branch / detached, path, badges (main worktree, this tab, locked + reason, missing). Row buttons: open in new tab, *Merge into &lt;default&gt;*, lock/unlock, remove; right-click adds file manager / terminal / copy path / *Force Remove (-f -f)…*.
- **Linked-worktree bar** on top of any tab that is a linked worktree: *Merge into main…* and *Remove…* without leaving the tab. This is the one-click path for "I'm done with this feature".
- **Force levels are explicit**: `WorktreeForce = 0 | 1 | 2` (number of `--force`). The main process maps git's refusals to new/existing error codes — `DIRTY` ("modified or untracked files") and new `LOCKED` ("locked working tree") — so the UI can offer escalation to `-f -f` in one step. The UI only ever uses 0 or 2: `-f -f` covers both cases and a middle option added no value.
- **Remove dialog** shows uncommitted-change count (`repo:quickStatus` on the worktree path) and lock state; *Remove* stays disabled until *Force (-f -f)* is ticked when either is present. Optional *Also delete branch* (default on unless it is the default branch) reuses `deleteBranchFlow` (safe delete → confirm force → 10 s Restore).
- **Merge into main runs where main is checked out.** A merge needs a working tree; `mergeInto` finds the worktree whose branch is the target and runs the existing `merge()` there (backup ref + undo still apply). If the target is not checked out anywhere, only a fast-forward is done, via `update-ref` with the old value as a guard; a real merge or `--no-ff` is refused with guidance.
- **Default target** = `origin/HEAD`'s branch, else `main`, else `master` (`worktree:defaultBranch`).
- **Cleanup after merge** (checkbox, default on): only after a clean merge, remove the worktree (force 0, asks before `-f -f`) then safe-delete the branch from the worktree where the target is checked out (so `-d` sees it as merged).
- **`git worktree remove` runs from a surviving worktree** (main worktree first), so removing the worktree open in the current tab works; tabs showing a removed worktree are closed, its recents entry dropped, and the main worktree is opened if the active tab was closed.
- **Suggested path** `<main-parent>/<main-name>-<slug of branch>` (same convention as the user's CLI workflow), deduplicated with `-2`, `-3`…
- `addWorktree` surfaces git's `fatal:` line; the generic runner shows the first stderr line, which for `worktree add` is the useless "Preparing worktree (…)".

## Rejected alternatives

- **Temporary worktree to merge into an un-checked-out main** — conflicts would land in a hidden folder; refusing with guidance is clearer.
- **Squash merge in the worktree flow** — leaves a staged result in another worktree and the branch would not delete with `-d`; still available via the normal Merge dialog in the main worktree.
- **Auto-ticking Force when dirty/locked** — destructive; the user must tick it.

## What changed

- `src/main/git/worktrees.ts` — parse/list, suggest path, add, remove (force 0–2, DIRTY/LOCKED), lock/unlock, prune, default branch, `mergeInto`.
- `src/main/handlers/worktrees.ts`, `src/main/index.ts` — `worktree:*` IPC handlers; merge notifies both repos.
- `src/shared/ipc.ts`, `src/shared/types.ts` — channels, `WorktreeEntry`, `WorktreeForce`, `WorktreeMergeResult`, `LOCKED` error code.
- `src/renderer/src/lib/api.ts` — `api.worktree.*`.
- `src/renderer/src/features/worktrees/` — `WorktreesView` (+ `LinkedWorktreeBar`), `WorktreeDialogs` (add / remove / merge), `worktreeFlows`.
- `RepoView` (stripe + bar), `ModalHost` / `stores/modals` (3 modals), `BranchMenu` (*New Worktree from ‘x’…*).
- Tests: `tests/integration/worktrees.test.ts`, `e2e/worktrees.spec.ts`.

## Evidence

- `npm run typecheck` clean; eslint clean on touched files.
- `npm test`: 23 files, 209 tests pass (4 new).
- `npx playwright test`: 10/10 pass, including the new worktree spec (create via UI → commit → merge into main from the bar with cleanup → dirty + locked worktree removed with `-f -f`).

## Corrections

- First integration run failed with "Preparing worktree (checking out 'main')": the test tried to check out `main` while it was checked out in the main worktree (git refuses — correct), and the error text hid the real reason. Fixed the test and made `addWorktree` report the `fatal:` line.

## Deliberately not done

- No `worktree move` / `repair`.
- `.git/worktrees` changes are ignored by the repo watcher, so worktrees created from the CLI appear on focus / refresh (Refresh button in the view), not instantly.
- Merge with conflicts in another worktree: the toast offers to open that worktree; conflict resolution then happens there with the existing tools.

## How to verify

```bash
npm test -- tests/integration/worktrees.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktrees.spec.ts
```

Manually: open a repo → Worktrees stripe → *New Worktree…* → a new tab opens with the linked-worktree bar → commit → *Merge into main…* → worktree folder and branch are gone, main has the commit.
