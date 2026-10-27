# Resolve with AI on any conflict

- **Date:** 2026-10-27
- **Branch:** `feat/ai-resolve-conflicts`
- **Status:** done

## Context

Auto Merge ([2026-10-27-worktree-auto-merge.md](2026-10-27-worktree-auto-merge.md)) resolves conflicts
on its own: Markdown keeps both sides, other text files go to the AI CLI. That step was only reachable
through Auto Merge on a linked worktree. The request: whenever there are conflicts, offer a button that
runs the same script.

## Decisions

- **One implementation.** Step 4 of `autoMergeWorktree` moved out to `resolveConflictsAuto` in
  `src/main/resolveConflicts.ts`, and Auto Merge now calls it. Both paths have the same rules: Markdown
  union, delete/modify Markdown keeps the side that still has the file, both-deleted is removed,
  binary/submodule/non-Markdown delete-modify or rename stop for the user, and AI answers are checked
  the same way.
- **It works for every operation with conflicts:** merge, rebase, cherry-pick, revert, stash apply,
  squash merge.
  - Marker labels default to the conflict state's Yours / Theirs names (`sideLabels`). For a rebase,
    "Yours" is the upstream and "Theirs" is the replayed commit, which matches the prompt's
    "target" / "incoming" wording.
  - Intent hints: for a merge, the commit ranges Auto Merge used (`MERGE_HEAD..HEAD` / `HEAD..MERGE_HEAD`).
    For the other operations, the subject of the commit being applied.
  - Auto Merge still passes its own labels (target / branch), so its prompts are unchanged.
- **It only resolves and stages. It never continues or aborts.** Outside Auto Merge, continuing can need
  a merge message, or can replay more commits during a rebase. The user clicks Continue, which is now
  enabled. That keeps the AI's output one review step away from history.
- **A cancellable operation.** `conflicts:aiResolve(root, opId)` runs inside `ctx.ops.run`, so it shows in
  the status bar with Cancel, and clicking the button again cancels it.
- **Where the button is:** the operation banner (`banner-ai-resolve`, shown whenever there are
  conflicted files) and the Conflicts dialog (`ai-resolve`). Both read one small store
  (`features/merge/aiResolve.ts`), so they show the same running state. While it runs, the dialog's
  other actions and the banner's Continue are disabled, because they would race on the same files.
- **Result:** a toast with the same wording as Auto Merge: "Markdown kept from both sides…" and
  "Resolved by AI (worth a review)…". A warning toast lists what is left and why.

## Rejected alternatives

- **Calling `worktree:autoMerge` from the banner.** It needs a linked worktree and always merges into the
  default branch. It does not apply to a rebase or cherry-pick in progress.
- **Continuing the operation automatically when everything resolves.** For a rebase this would replay
  the next commit with nobody looking. Merges need a message. It is one extra click.
- **A copy of the resolve loop in the conflicts handler.** The two would drift apart.

## What changed

- `src/main/resolveConflicts.ts` (new): `resolveConflictsAuto`.
- `src/main/autoMerge.ts`: step 4 now calls it. Unused imports were dropped.
- `src/main/handlers/conflicts.ts`: the `conflicts:aiResolve` handler.
- `src/shared/ipc.ts`, `src/shared/types.ts` (`AiResolveResult`), `src/renderer/src/lib/api.ts`.
- `src/renderer/src/features/merge/aiResolve.ts` (new): the shared running state, the run/cancel action
  and the toasts.
- `OperationBanner.tsx` and `ConflictsDialog.tsx`: the "Resolve with AI" buttons.
- Tests:
  - `tests/integration/fakeAiCli.ts` (new): the fake CLI, pulled out of `autoMerge.test.ts`.
  - `tests/integration/resolveConflicts.test.ts` (new).
  - `e2e/ai-resolve.spec.ts` (new).
- `README.md`: the feature list now mentions Resolve with AI.

## Evidence

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 33 files, 308 tests passed. That includes `resolveConflicts.test.ts` (5 tests) and the 9
  unchanged Auto Merge integration tests, run against the refactor:
  - merge: md union + AI, merge left open;
  - rebase: labels and replayed-commit subject;
  - cherry-pick: no AI tool → md only and a reason, then with a tool;
  - AI leaves markers → kept unresolved;
  - aborted signal → CANCELLED.
- `npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/ai-resolve.spec.ts e2e/auto-merge.spec.ts
  e2e/conflicts.spec.ts e2e/worktree-conflicts.spec.ts e2e/smoke.spec.ts`: all passed. The new spec covers
  the banner button on a merge (Continue enabled afterwards, MERGE_HEAD kept) and the dialog button.

## Corrections

- None.

## Deliberately not done

- **No button in the 3-way merge editor for a single file.** The dialog and banner act on all conflicts.
- **The AI tool is not checked before clicking.** With no CLI installed, Markdown is still resolved and
  the toast gives the tool error for the rest.
- **No rerun on the next rebase step.** Each step's conflicts need another click.

## How to verify

```bash
npm run typecheck && npm run lint && npm test
npx vitest run tests/integration/resolveConflicts.test.ts tests/integration/autoMerge.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/ai-resolve.spec.ts
```

Manual check (`npm run dev`):

1. Start a merge or rebase that conflicts in a `.md` file and a source file.
2. Click **Resolve with AI** in the yellow banner, or in the Conflicts dialog.
3. Expect: the status bar shows the operation and can cancel it.
4. Then a toast lists the Markdown files kept from both sides and the files resolved by AI.
5. No conflicted files are left, and Continue is enabled.
