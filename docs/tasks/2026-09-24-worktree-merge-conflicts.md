# Worktree merge with conflicts could lose the branch's commits

- **Date:** 2026-09-24
- **Branch:** `fix/worktree-merge-conflicts`
- **Status:** done

## Context

Reported: "the worktree is not merging properly, I'm losing lots of commits … maybe when there are conflicts". Follow-up to [worktree management](2026-09-24-worktree-management.md).

## Root cause (reproduced)

*Merge into main* runs `git merge` in the worktree where `main` is checked out. On conflicts the merge stops **there**, but the linked worktree's tab showed nothing: its bar still offered *Merge into main…* and *Remove…*, and the conflict toast was covered by an info toast.

Reproduced in the real app (e2e probe):

1. Worktree `feat` with 3 commits and a conflicting change on `main`. Click *Merge into main*: conflicts. The worktree and branch were kept, as intended.
2. Click *Remove…* on the worktree bar. The worktree is removed. Branch delete: `-d` refuses (not merged into main's HEAD), then the generic "Branch not fully merged → Force Delete" prompt appears. It doesn't mention the unfinished merge, and the user believes the merge is done.
3. Force Delete, then abort the merge. **All 3 commits were unreachable from any ref.** Only MERGE_HEAD referenced them, and the abort removes it.

A second trap: in the conflict tool, "Yours" is `main` (the merge runs there) and "Theirs" is the worktree branch. From inside the worktree it's natural to read "Yours" as your own work. Accepting Yours drops the feature's changes, while its commits still show as merged.

## Decisions

- **Main-process guard on `branch:delete`** (force included): `assertNotBeingMerged` refuses when any worktree has a MERGE_HEAD that the branch contains and that is not yet merged into that worktree's HEAD. It sits at the IPC boundary, so every UI path is covered (worktree remove dialog, branch menu, multi-delete).
- **`worktree:pendingMerges`** lists unfinished merges across all worktrees with the branches they still depend on (`for-each-ref --contains <MERGE_HEAD> --no-merged <target HEAD>`).
- **`mergeInto` refuses** to start while the target worktree has an operation or conflicts in progress (`DIRTY`). Before, git's refusal was reported as new conflicts.
- **UI while a merge is pending:**
  - The linked-worktree bar turns into a warning: "Merge of X into main is unfinished in <path>. “Theirs” is X (this worktree), “Yours” is main". It offers Resolve Conflicts… / Open main / Abort Merge…, and Merge/Remove are hidden.
  - The Worktrees view row gets an "unfinished" badge and Resolve…; Remove and Force Remove are hidden. Abort is in the context menu.
  - The Remove dialog shows a blocking notice, and Remove is disabled.
  - `removeWorktreeAndBranchFlow` checks again before removing.
- The conflict toast after merge now says the worktree and branch were kept, explains Theirs/Yours, and offers Resolve… (it opens the conflict tool on the main worktree).
- The pending-merge query polls every 3 s only while a merge is pending, because resolving happens in another tab whose refresh doesn't reach this tab's queries.

## Rejected alternatives

- **Running the merge in the linked worktree** (merge main into feat, then fast-forward main): this changes the user's branch history and still needs `main` updated where it is checked out. Rejected.
- **Guard only in the renderer**: other delete paths (branch menu, multi-delete) would still lose commits.
- **Auto-cleanup after the user finishes resolving**: implicit destructive action long after the click. The user presses Merge again (it reports "Already up to date") and cleanup runs then.

## What changed

- `src/main/git/worktrees.ts`: `pendingMerges`, `assertNotBeingMerged`, operation check in `mergeInto`.
- `src/main/handlers/branches.ts`: guard in `branch:delete`.
- `src/main/handlers/worktrees.ts`, `src/shared/ipc.ts`, `src/shared/types.ts` (`PendingMerge`), `src/renderer/src/lib/api.ts`.
- `src/renderer/src/features/worktrees/*`: pending-merge bar, row state, Remove dialog block, abort flow, conflict toast.
- Tests: 2 new integration cases in `tests/integration/worktrees.test.ts`; new `e2e/worktree-conflicts.spec.ts`.

## Evidence

- Before the fix, the e2e probe printed `feat exists after abort: false`, `feat tip reachable from any ref: (none)`.
- After the fix: `npm test` 213/213 passes. `npx playwright test` 14/14 passes. The new spec covers:
  - conflict, then bar in pending mode with no Remove/Merge;
  - the row is blocked;
  - Abort, then the branch is intact;
  - merge again, resolve, the bar clears, merge + cleanup, and all 3 feature commits end up in `main`.

## Corrections

- The first reply's investigation found no orphaned commits from this feature in `git-manager`, `website-live` or `dev-vsense-k3s`. Every commit in `git-manager` is still reachable. The loss is real, but it needs the conflict → Remove → Force Delete → abort sequence, which the user confirmed ("when there are conflicts").
- Unrelated finding: `dev-vsense-k3s` has orphaned `81b64c7 feat: split sort` / `27009a3 Merge branch 'feat/split-sort'`, dropped by `reset: moving to origin/main` at 20:28:34, before the worktree feature existed. Recover with `git branch recover/split-sort 81b64c7` if needed (a later `4aa886d feat: split sort` exists on main).

## Deliberately not done

- The generic "Branch not fully merged" prompt in `deleteBranchFlow` is unchanged. The server guard now stops the dangerous case before it appears.
- Rebase / cherry-pick in progress are not tracked: git already refuses to delete a branch that is being rebased in a worktree.

## How to verify

```bash
npm test -- tests/integration/worktrees.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktree-conflicts.spec.ts
```
