# Milestone 5 — History rewriting

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done

## Context

Reword / squash / fixup / drop / reorder non-HEAD commits, reset, revert, cherry-pick, patches,
interactive rebase dialog, rebase-in-progress mode, backup refs + undo, reflog viewer — implemented
exactly as the spec prescribes (scripted non-interactive `git rebase -i`).

## Decisions

- **`runRewrite` (main, `git/rewrite.ts`)** writes a todo file and runs `git rebase -i` with
  `GIT_SEQUENCE_EDITOR='<electron>' '<userData>/helpers/sequence-editor.cjs'` and
  `ELECTRON_RUN_AS_NODE=1`; the script copies our todo over git's. `GIT_EDITOR` is `true` (Unix) or
  the no-op script (Windows). The editor strings are shell-quoted because git runs them through its
  POSIX shell (also Git for Windows' sh); git itself is still spawned with an argument array.
- **Messages:** reword = `pick` + `exec git commit --amend --no-edit -F '<file>'`; squash = `fixup`
  (no editor ever opens) + one exec amend with the combined message after the group's last commit.
  Message files live in `<gitdir>/gitclient/messages/` because a rebase that stops on a conflict
  still needs them when it continues; they are removed when no rebase is in progress.
- **Reword HEAD** uses `git commit --amend --only -F -` so staged changes are not folded in.
- **Pre-flight** (`checkRewrite`): only commits reachable from HEAD; pushed = any rewritten commit is
  an ancestor of `@{u}` → warning dialog (force push with lease needed); merges in range → confirm
  `--rebase-merges` (then `transform` mode: git generates the todo, the script only changes the
  actions/exec lines of picked commits; reordering refused); dirty tree → "Stash and Continue" uses
  `git rebase --autostash` (git stashes and pops).
- **Backup refs** before every rewrite/reset/undo-commit/cherry-pick/revert (+ merge/rebase/pull
  from M4). **Undo Last Operation** = `reset --keep <newest backup of this branch ≠ HEAD>`; if that
  would overwrite local changes → `DIRTY` → destructive confirmation → `reset --hard`. The used backup
  ref is deleted, so repeated undos walk further back.
- **Sequencer (`git/sequencer.ts`)** reads rebase-merge/rebase-apply/MERGE_HEAD/CHERRY_PICK_HEAD/
  REVERT_HEAD (step N/M, head-name, onto → branch name, current commit subject) and implements
  continue/skip/abort. Continue refuses while unmerged paths remain. Merge continue asks for the
  commit message (pre-filled from MERGE_MSG). Conflicts without an operation = stash apply → abort
  is `git reset --merge`.
- **Operation banner** in every repo view: title, conflicted count, step, Continue/Skip/Abort
  (abort always confirms). M8 adds "Resolve Conflicts…" through `outcomeActions.resolveConflicts`.

## Corrections

- The rebase test helper looked commits up in HEAD's history only; after switching branches it
  returned nothing. Fixed in the test (`log --all`), not the product.

## Evidence

- `tests/integration/rewrite.test.ts` (13): reword non-HEAD (exec amend, multi-line body, backup
  ref), reword HEAD keeps staged changes, squash with edited message, fixup + drop + reorder,
  invalid plan, edit → stopped → continue, DIRTY vs autostash, pushed detection, merges refused
  without / reworded with `--rebase-merges` (merge kept), conflict → resolve → continue → conflict →
  continue → done, abort restores, skip, reset modes + undo, undo DIRTY/hard, undo commit, cherry-pick
  and revert (conflict as outcome + abort), patches, reflog.
- `e2e/rewrite.spec.ts`: reword a non-HEAD commit through the context menu and message dialog with
  the real Electron binary as sequence editor, then Git → Undo Last Operation restores it.
- Screenshots: interactive rebase dialog (merge warning), merge-conflict banner.

## Deliberately not done

- Per-commit author editing.
- Squash across merge commits (refused with an explanation).
- Windows no-op editor path is exercised only by CI (M10).

## How to verify

`npx vitest run tests/integration/rewrite.test.ts`, `npm run test:e2e`; in the app right-click
commits in the Log.
