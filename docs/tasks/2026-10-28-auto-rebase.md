# Auto Rebase: rebase that resolves its own conflicts

- **Date:** 2026-10-28
- **Branch:** `feat/auto-rebase`
- **Status:** done

## Context

Resolve with AI ([2026-10-27-ai-resolve-conflicts.md](2026-10-27-ai-resolve-conflicts.md)) resolves
the conflicts of one stopped step. It never continues, so during a rebase you click Resolve with AI and
then Continue for every conflicting commit. That record lists "no rerun on the next rebase step" as
deliberately not done. The request: an auto rebase that resolves every conflict the smart way (Auto
Merge's rules) on its own.

## Decisions

- **One main-process loop** (`src/main/autoRebase.ts`, run by `branch:autoRebase` inside `ctx.ops.run`):
  1. start `git rebase <onto> [<branch>]` through the existing `rebase()` (it writes the `rebase` backup
     ref first), or resume the open rebase when `onto` is null;
  2. while a rebase is in progress: if the step has conflicts, run `resolveConflictsAuto` (the same
     function as Resolve with AI and Auto Merge), then `continueOperation`;
  3. finish when no rebase is left.
  It has one cancel signal, progress lines like `Step 2/5 “subject”: Resolving src/app.ts (1/1)…`, and is
  tested against real repos with the fake CLI.
- **Same conflict rules, no new settings.** Markdown keeps both sides, other text files go to the conflict
  AI tool from Settings, binary/submodule/non-Markdown delete-modify stop. Marker labels and intent hints
  are `resolveConflictsAuto`'s defaults for a rebase: "Yours" is the upstream, "Theirs" the replayed
  commit, with its subject as intent.
- **Stop policy (same as Auto Merge): keep the rebase open.** Any unresolved file stops the loop; files
  already resolved in that step stay staged, earlier steps stay applied. A stop without conflicts
  (`edit`/`break`/failed `exec`, only possible when resuming an interactive rebase) also stops. Cancel
  stops between files/steps and leaves the rebase open with a toast saying so.
- **Empty steps.** When a resolution leaves nothing to commit, git ≥ 2.26's merge backend drops the commit
  on `--continue` (verified on 2.53). Older git refuses; `continueStep` then skips the step when nothing
  is staged, which is what newer git does on its own.
- **Unlike Resolve with AI, it does continue.** The user asked for the whole rebase to run unattended.
  The way back is the backup ref: the success toast has Undo when this call started the rebase
  (`started`). A resumed rebase has no Undo (the backup ref belongs to whoever started it); Abort was
  available before clicking.
- **Entry points:**
  - Branch menu: `Auto Rebase ‘cur’ onto ‘x’` (`menu-auto-rebase`) and `Checkout and Auto Rebase onto
    ‘cur’` (`menu-checkout-auto-rebase`), next to the plain rebase items.
  - Operation banner: `Auto Rebase` (`banner-auto-rebase`) whenever a rebase is in progress, with or
    without conflicts, to finish a rebase that was started by hand or stopped earlier.
  - No confirmation, like Auto Merge: backup ref + Undo.
- **Shared running state.** `features/merge/aiResolve.ts`'s store now records `{ opId, kind }` per repo,
  and both Resolve with AI and Auto Rebase go through `exclusive()`: one AI operation per repo, a second
  click cancels. While either runs, the banner's Continue, Skip and Abort and the Conflicts dialog's
  actions are disabled (Skip/Abort were not disabled for Resolve with AI before; they race the same
  files either way).

## Rejected alternatives

- **Looping in the renderer** (Resolve with AI → Continue → repeat over IPC). Several round trips, a
  cancel per call, and the banner would flicker between steps.
- **`git rebase -X ours/theirs`.** Picks one side blindly; not the "smart" resolution requested.
- **Aborting the rebase on failure.** Throws away the steps that did resolve; Auto Merge's users picked
  "keep open".
- **A dialog with a step checklist like Auto Merge.** A rebase has no fixed steps; the status bar's
  progress line plus the result toast are enough.

## What changed

- `src/main/autoRebase.ts` (new): `autoRebase`, `continueStep`.
- `src/main/handlers/branches.ts`: `branch:autoRebase` handler.
- `src/shared/ipc.ts`, `src/shared/types.ts` (`AutoRebaseResult`), `src/renderer/src/lib/api.ts`.
- `src/renderer/src/features/merge/aiResolve.ts`: `{ opId, kind }` store, `exclusive()`, `useAiRunKind`,
  `autoRebaseFlow` with its toasts.
- `OperationBanner.tsx`: Auto Rebase button; Skip/Abort disabled during an AI run.
- `BranchMenu.tsx`: the two menu items.
- Tests: `tests/integration/autoRebase.test.ts` (7), `e2e/auto-rebase.spec.ts` (2).
- `README.md`: Branches feature line and milestone 4 row mention Auto Rebase.

## Evidence

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 34 files, 315 tests passed. `autoRebase.test.ts` covers: two conflicting steps (code → AI,
  md → union) with backup ref and commit order kept; clean rebase of another branch; resume of a rebase
  stopped by hand; AI leaving markers → stopped at step 1/3 with the rebase open; resolution that empties
  a commit → commit dropped; refusal to start over an open rebase (`DIRTY`) and to resume without one
  (`INVALID_ARGUMENT`); aborted signal → `CANCELLED`, rebase open.
- `npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/auto-rebase.spec.ts e2e/ai-resolve.spec.ts
  e2e/conflicts.spec.ts e2e/branches.spec.ts`: 10 passed. The new spec runs Auto Rebase from the branch
  menu and from the banner on a rebase stopped by hand; both finish with the expected file contents.

## Corrections

- None.

## Deliberately not done

- **The old-git skip fallback is not exercised by tests.** The test machine's git (2.53) drops the empty
  commit itself, so the fallback path never runs there.
- **No AI tool check before starting.** With no CLI, the first step with a non-Markdown conflict stops
  with the tool error as the reason, the rebase open.
- **No dirty-tree handling.** Like the plain Rebase item, a dirty working tree makes `git rebase` fail
  with git's message; no autostash.
- **No build/test run between steps.** AI-resolved code is committed into rewritten commits unreviewed;
  the toast lists the AI-resolved files ("worth a review") and Undo restores the backup.
- **Pull (rebase) is not automated.** Only the branch-menu rebase and the banner.

## How to verify

```bash
npm run typecheck && npm run lint && npm test
npx vitest run tests/integration/autoRebase.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/auto-rebase.spec.ts
```

Manual check (`npm run dev`):

1. On a feature branch with commits that conflict with main in a `.md` file and a source file,
   right-click `main` in Branches → **Auto Rebase ‘feature’ onto ‘main’**.
2. Expect: the status bar shows `Step n/m …` progress with Cancel; then a toast "Rebase of feature
   finished (N steps with conflicts resolved)" listing Markdown kept from both sides and AI-resolved
   files, with Undo.
3. Start a plain rebase that stops on conflicts; click **Auto Rebase** in the yellow banner; it finishes
   the remaining steps.
4. With the AI tool missing or returning markers, it stops with the rebase open and a warning toast
   with Resolve….
