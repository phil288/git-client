# Merge any branch into any branch, from more places

- **Date:** 2026-10-21
- **Branch:** `feat/branch-merge-any`
- **Status:** done

## Context

Worktrees could be merged into any target branch with safety rails: a commit count, a nothing-to-merge state, the merge run in whichever worktree has the target checked out, and a refusal to stack on an unfinished operation. A plain branch merge already existed, but it was weaker:

- It only merged into the current branch.
- It was reachable only from the Branches panel menu.
- It had no preflight and no operation-in-progress guard.
- It always offered **Undo**, even after "Nothing to merge". That Undo would have undone the *previous* operation.

The request was to merge branches, not just worktrees, from the branch right-click menu "and other places".

## Decisions

- **One merge core for branches and worktrees.** `mergeRefInto(source, target, mode)` in `src/main/git/worktrees.ts` takes any revision as the source (`refs/heads/x`, `refs/remotes/o/x`, `refs/tags/t` or a hash) and a local branch as the target. `wt.mergeInto` and `wt.commitsToMerge` are now thin wrappers that pass `refs/heads/<s>`.
  - It lives in `worktrees.ts`, not `branches.ts`. `worktrees.ts` already imports `merge` from `branches.ts`, so putting it in `branches.ts` would create an import cycle.
- **Where the merge runs:**
  - The target is checked out in a worktree, the current one included: merge there.
  - The target is checked out nowhere and can fast-forward: write a backup ref of the target first (new; the old worktree path had none), then `update-ref`.
  - Otherwise: throw the new `NEEDS_CHECKOUT` error code. The renderer avoids this case by calling `branch:mergePlan` first, asking "Check out ‘T’ and merge?", and running the normal `checkoutFlow`, which includes Smart Checkout for local changes.
- **Operation-in-progress guard.** It now also covers merges into the current branch, because the current worktree is just another host.
- **Squash** is offered only when the target is the current branch, so the staged result lands where the user is.
  - The main process allows squash into any hosted target.
  - The worktree handler still refuses squash, as before.
- **Undo** is offered only when commits were merged *and* the merge ran in this repository (`plan.isCurrent`, or the flow checked the target out here).
- **Detached HEAD:** the dialog offers "HEAD (detached)" as the target, which uses the old `branch:merge`.
- **`conflicts:preview`** takes an optional `into` branch, so the conflict preview works for targets other than HEAD (`merge-tree refs/heads/<into> <ref>`).
- **Entry points:**
  - **Branches panel menu**
    - "Merge ‘x’ into ‘cur’…" (as before).
    - "Merge ‘cur’ into ‘x’…" (new, for local branches).
    - "Merge into ‘cur’…" on the current branch, which opens the source picker.
  - **Log ref labels:** right-clicking a label opens the same branch menu (`LogRefMenu`, through `data-ref` on each chip).
  - **Log commit menu**
    - "Merge into ‘cur’…", which merges the commit itself.
    - A "Branch/Tag ‘x’ ▸" submenu per ref on the commit. This covers refs hidden behind "+N".
  - **Toolbar:** a **Merge…** button.
  - **Commit-view branch picker:** a hover merge icon on each row.
- The favorites logic was extracted into `useFavorites(root)` so the log's branch menu can toggle favorites too.

## Rejected alternatives

- **Merging in a temporary worktree** when the target is not checked out. Conflicts would have to be resolved in a hidden checkout; that is too surprising and too complex.
- **Fast-forward only** for targets that are not checked out (the old worktree rule). The user chose checkout-then-merge instead.
- **A separate "Merge ‘x’ into…" menu item.** It would be redundant, because the dialog's target `<select>` is editable.
- **A Git/VCS app menu entry.** There is no Git app menu today (File/View/Window only), and the toolbar button covers it.

## What changed

- **Main process**
  - `src/main/git/worktrees.ts`: `shortRef`, `mergePlan`, `mergeRefInto` and `commitsToMergeRev`; the worktree functions now delegate to them.
  - `src/main/git/conflicts.ts`: `previewMerge(…, into)`.
  - `src/main/handlers/branches.ts`: `branch:mergeInto` (notifies the repo the merge ran in) and `branch:mergePlan`.
  - `src/main/handlers/conflicts.ts`: preview `into`.
- **Shared**
  - `src/shared/types.ts`: `MergeIntoResult` (`WorktreeMergeResult` is now an alias), `MergePlan` and the `NEEDS_CHECKOUT` error code.
  - `src/shared/ipc.ts`: the new channels.
- **Renderer**
  - `lib/gitOps.ts`: `mergeBranchFlow` replaces `mergeFlow`. `checkoutFlow` now resolves to `boolean`.
  - `features/branches/BranchDialogs.tsx`: a new `MergeDialog`, with a source `RefSelect`, a target select, the where-it-runs note, the count or nothing-to-merge state, an uncommitted-changes warning and "Checkout and Merge". It also adds `useMergePlan`.
  - `stores/modals.ts`: the `merge` modal shape is now `{ source?, sourceLabel?, target? }`.
  - `BranchMenu.tsx`, `LogRefMenu.tsx` (new), `LogTable.tsx`, `LogView.tsx`, `RepoView.tsx`, `CommitMenu.tsx`, `RefLabels.tsx`, `RepoToolbar.tsx`, `BranchPicker.tsx`, and `BranchesPanel.tsx` (`useFavorites`).
- **Tests**
  - New `tests/integration/mergeInto.test.ts`.
  - New `e2e/branch-merge.spec.ts`.
  - `tests/integration/worktrees.test.ts`: the code for "not checked out, not fast-forwardable" changed from `INVALID_ARGUMENT` to `NEEDS_CHECKOUT`.

## Evidence

- `npm run typecheck` and `npm run lint` are clean.
- `npm test`: 30 files, 280 tests passed. That includes 8 new tests for a remote, tag or hash source, the current and other-worktree targets, a fast-forward with a backup, `NEEDS_CHECKOUT`, the DIRTY guard, squash, and the preview into another branch.
- `E2E_NO_SANDBOX=1 npm run test:e2e -- e2e/branch-merge.spec.ts` passed all 4 tests:
  - merge from the menu;
  - nothing to merge disables the button;
  - checkout-then-merge;
  - the log ref label menu.
- `npx playwright test` on the worktrees, worktree-nothing, worktree-conflicts, conflicts, branches, log-refs, rewrite and tags specs passed all 14 tests.

## Corrections

- The plan assumed branch merging did not exist. It did ("Merge ‘X’ into ‘cur’…" in the Branches panel menu), but only into the current branch and without preflight. The work generalised it rather than adding a second one.
- `e2e/branch-merge.spec.ts` passed locally but failed on CI (two tests timing out waiting for a
  2-parent commit): the fixture set the git identity only via `-c` on its own commands, so the
  app's `git merge` had no identity on a runner without global git config. Fixed by setting a
  repo-local `user.name`/`user.email` like the other specs. Reproduce locally with
  `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 E2E_NO_SANDBOX=1 npx playwright test e2e/branch-merge.spec.ts`
  (2 failed before, 4 passed after).

## Deliberately not done

- No Git/VCS application menu.
- The detached-HEAD path still uses `branch:merge`. Its Undo check relies on the "Nothing to merge" message prefix.
- No keyboard shortcut for Merge.

## How to verify

```
npm run typecheck && npm run lint && npm test
E2E_NO_SANDBOX=1 npm run test:e2e -- e2e/branch-merge.spec.ts
```

Manual check (`npm run dev`, repo with `main` + `feature`):

1. Right-click `feature` in the Branches panel or on its log label, choose **Merge ‘feature’ into ‘main’…**, and confirm the count is shown.
2. Choose **Merge ‘main’ into ‘feature’…**. You should get "will be checked out here first", then a checkout prompt.
3. Use the toolbar **Merge…**, pick an already-merged branch, and check that the button is disabled.
