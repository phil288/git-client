# One-click worktree Auto Merge

- **Date:** 2026-10-27
- **Branch:** `feat/worktree-auto-merge`
- **Status:** done

## Context

Linked worktrees are merged back into main often, and the merges often conflict. Doing it by hand took
many steps:

1. Commit in the worktree (the AI message was a separate button).
2. Open the Merge dialog.
3. Resolve each conflict in the 3-way editor.
4. Remove the worktree.

The request was for one button that runs the whole pipeline:

1. Commit everything with a generated message.
2. Merge into main, but block if main is not clean.
3. Resolve conflicts: when only `.md` files conflict, keep both sides. Anything else goes to the LLM
   chosen in Settings, with no human in the loop.
4. Commit the merge.
5. Delete the worktree and its folder.

## Decisions

- **The whole pipeline is one main-process operation** (`src/main/autoMerge.ts`, run by
  `worktree:autoMerge` inside `ctx.ops.run`).
  - It has one cancel signal and one progress stream, and it is easy to test with a fake CLI.
  - The step number travels in `percent` (`autoMergePercent` / `autoMergeStepOf` in
    `src/shared/autoMerge.ts`), so `ProgressEvent` did not change.
- **It is re-entrant instead of keeping state.** Clicking again after "blocked" or "stopped" carries on
  from where it stopped:
  - A clean worktree skips the commit.
  - If this branch's merge is still open in the target worktree (`pendingMerges`), it resumes at the
    resolve step.
  - If nothing is left to merge, it goes straight to cleanup.
- **The clean check counts everything in main's worktree** (staged, unstaged, untracked, or an operation
  in progress) and runs *before* merging, so nothing is touched while blocked.
  - The dialog lists the dirty files.
  - It auto-resumes once main has been seen dirty and then clean: it polls `quickStatus` every 2.5 s and
    also listens to `repo:changed`.
  - An operation in progress is not visible to `quickStatus`, so for that case only Retry resumes. This
    avoids a re-run loop.
  - User choice: auto-resume rather than Retry only.
- **Markdown is always resolved as keep-both, even when other files conflict too.**
  - `unionMerge` in `src/shared/mergeModel.ts` is the merge editor's `bothLR` applied to every conflict
    chunk: main's lines first, then the branch's.
  - A Markdown file deleted on one side keeps the side that still has the file.
  - The `.md` / `.markdown` matching is case-insensitive.
- **The LLM never edits files.** `runTool` keeps the existing read-only, no-tools CLI mode.
  - The prompt holds: diff3 markers around the conflicting regions only (`renderWithMarkers`), both
    branches' recent subjects as intent, and the editable instructions plus a fixed data guard.
  - The app writes the answer through `saveResolution`, which keeps encoding, EOL and the final newline.
  - The answer is rejected if it is empty, or if it still has `<<<<<<<` / `|||||||` / `=======` /
    `>>>>>>>` lines while the inputs had none.
  - Binary files, submodules, files over 200 KB, and non-Markdown delete/modify or rename conflicts are
    never sent.
- **Failure policy (user choice): stop and keep the merge open.**
  - Files that were already resolved stay staged.
  - The dialog offers Resolve… (the existing conflict tool), and the worktree is kept.
  - Cancelling also leaves the merge open.
- **Cleanup:** `git worktree remove` without force (git deletes the folder), then `branch -d` (user
  choice: safe-delete the branch). Cleanup problems after a successful merge become a warning, never a
  failure.
- **Settings (user choice):**
  - New `aiMergeTool` (`'same'` = the commit tool, `'auto'`, or a specific tool), default `'same'`.
  - New `aiMergeInstructions`.
  - The per-tool model is reused.
  - No migration was needed, because defaults are merged on read.
- **No confirmation step.** The click starts the operation, as requested. The way back is the
  `merge` backup ref that `mergeRefInto` → `merge()` already writes in the target worktree.
- **Merge mode `default`:** fast-forward when possible, otherwise a merge commit with git's default
  message.

## Rejected alternatives

- **Letting the agent CLI edit files with tools on.** It differs per tool, could run commands, and is
  harder to check. Sending the file and getting the file back keeps the CLI read-only.
- **Aborting the merge when the AI fails.** That throws away the resolutions that did work. The user
  picked "keep open".
- **Running the pipeline in the renderer** (like `mergeWorktreeFlow`). It would need several IPC round
  trips, a cancel per step, and the LLM loop across process boundaries.
- **Asking the AI about Markdown too, when other files conflict.** The rule "md = keep both" is
  predictable and cheap.

## What changed

- **`src/main/autoMerge.ts`** (new): the orchestrator.
- **`src/main/ai/resolveConflict.ts`** (new): the prompt and the per-file AI resolution and checks.
- **`src/main/ai/pickTool.ts`** (new): tool selection pulled out of `handlers/ai.ts`.
- **`src/main/operations.ts`**: `latestProgress()`, the deferred progress emit pulled out of `handlers/ai.ts`.
- **`src/main/handlers/worktrees.ts`**: the `worktree:autoMerge` handler. It records the commit message
  in repo prefs and notifies the root, the host and the worktree.
- **`src/shared/`**:
  - `autoMerge.ts` (new): md matching, answer cleaning, marker check, step labels.
  - `mergeModel.ts`: `unionMerge`.
  - `aiTool.ts`: `defaultMergeInstructions`, `AI_MERGE_DATA_GUARD`.
  - `types.ts`: settings and `AutoMergeResult`.
  - `ipc.ts`: the new channel.
- **`src/main/store.ts`**: schema entries for the two new settings.
- **Renderer:**
  - `AutoMergeDialog.tsx` (new): step checklist, blocked/stopped/error states, auto-resume.
  - Auto Merge buttons in the worktree row (`wt-auto-merge`), its context menu, and the linked-worktree
    bar (`bar-auto-merge`).
  - Settings › Tools: conflict tool select, model for that tool when it differs, and the prompt.
  - `worktreeFlows.ts` now exports `closeTabsFor` / `mainWorktree`.
- **Tests:** `tests/unit/autoMerge.test.ts`, `tests/integration/autoMerge.test.ts`,
  `e2e/auto-merge.spec.ts`.
- **`README.md`**: the feature lines now mention Auto Merge.

## Evidence

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 32 files, 303 tests passed.
  - `tests/unit/autoMerge.test.ts`: 10 tests.
  - `tests/integration/autoMerge.test.ts`: 9 tests (happy path; blocked then resumed; md only;
    code + md; separate merge tool; AI leaves markers → stopped → manual fix → re-run finishes; already
    merged → cleanup only; cancel during the AI call; refusals).
- `E2E_NO_SANDBOX=1 npx playwright test e2e/auto-merge.spec.ts`: passed. The flow was: dirty worktree
  committed, blocked on a dirty main, auto-resumed after cleaning, md kept both, `app.ts` resolved by the
  fake AI, worktree and branch gone, toast lists the AI-resolved file.
- Regression e2e run (`worktrees`, `worktree-conflicts`, `worktree-nothing`, `ai-commit`, `tabs`,
  `smoke`): 14 passed.

## Corrections

- The plan assumed the AI layer called an LLM API with keys. It actually shells out to installed coding
  CLIs (`claude`, `codex`, …) in read-only mode. The design reuses that, so there are no keys and no SDK.
- The plan proposed new `buildMarkedFile` / `hasConflictMarkers` helpers. `merge3.ts` already has
  `renderWithMarkers` and a `hasConflictMarkers` (which does not cover `|||||||`). Only `hasMergeMarkers`
  (with the diff3 base marker) was added.

## Deliberately not done

- **No build or tests run before the merge commit.** AI-resolved code is committed unreviewed, as
  requested. The success toast lists the AI-resolved files ("worth a review"), and the backup ref allows
  an undo.
- **Merge mode is fixed at `default`.** No no-ff option.
- **Files are sent to the AI one at a time.** No parallel calls, and no whole-merge context across files.
- **Non-Markdown delete/modify and rename conflicts stop for the user.** They need a decision, not a text
  merge.

## How to verify

```bash
npm run typecheck && npm run lint && npm test
npx vitest run tests/unit/autoMerge.test.ts tests/integration/autoMerge.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/auto-merge.spec.ts
```

Manual check (`npm run dev`):

1. Create a worktree.
2. In the worktree, change a `.md` file and a source file that main also changed, and leave one change
   uncommitted.
3. Click **Auto Merge** in the worktree bar.
4. Expect: an AI commit in the worktree, a merge commit on main with the md lines from both sides and the
   AI-resolved source file, and the worktree folder and branch gone.
5. Repeat with an untracked file in main's worktree. The dialog should block, list the file, and resume
   by itself once the file is removed.
