# Milestone 4 — Branches

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done

## Context

IDE-style Branches popup + sidebar: tree, search, favorites/recent, ahead/behind, checkout (smart),
create/rename/delete/restore, merge, rebase, compare, diff with working tree, fetch/pull/push,
upstream management.

## Decisions

- **Main module `git/branches.ts`**; handlers in `handlers/branches.ts`. Every mutating handler calls
  `notifyRepoChanged` so views refresh even before the watcher fires.
- **Conflicts are an outcome, not an error** (`runMayConflict`): merge/rebase/pull/stash-pop that stop
  with unmerged paths return `{status:'conflicts'}`; the UI shows a toast with "Resolve…" (M8 hook).
- **Checkout with local changes:** git's "would be overwritten" stderr maps to `LOCAL_CHANGES`; the
  UI offers Smart Checkout (stash → checkout → pop, conflicts reported, stash kept) / Force /
  Cancel. Remote branches: create the tracking branch first, then the same flow.
- **Delete:** `-d` first; "not fully merged" → `NOT_MERGED` → explicit destructive confirmation →
  `-D`. The SHA is kept for a 10 s "Restore" toast action.
- **Rename on remote:** push `refs/heads/new` with `--set-upstream`, then delete the old remote
  branch — only when the user ticks the box.
- **Push only with `--force-with-lease`** (never `--force`), destructive confirmation; `--porcelain`,
  `--follow-tags` for "push tags", `--set-upstream` when the branch has none.
- **Backup refs** (`refs/gitclient-backup/<branch>/<ms>-<op>`, newest 20 kept) are created before
  merge, rebase and pull — the undo foundation for M5. "Checkout and rebase onto current" backs up
  the rebased branch, not the current HEAD.
- **Editors:** `git/editors.ts` writes `noop-editor.cjs` and `sequence-editor.cjs` into
  `userData/helpers` and exports the env (`GIT_EDITOR`=`true` on Unix / the no-op script under
  `ELECTRON_RUN_AS_NODE=1` on Windows). Needed here for rebase continue; M5 uses the sequence editor.
- **Recent branches** from the HEAD reflog (`checkout: moving from A to B`), 5 shown.
- **Favorites** per repository in the state file (`repoPrefs`, keyed by normalised path).
- **Upstream status** from `for-each-ref %(upstream:track,nobracket)` ("ahead N, behind M" / "gone").

## Follow-up: delete several branches at once (user request, same day)

- **Selection:** Ctrl/Cmd+click toggles, Shift+click selects a range (in display order), plain click
  selects one and filters the log as before; Esc clears. A "N selected — Delete… / Clear" bar
  appears; the Delete key and the context menu ("Delete N Selected Branches…") act on it.
- **Flow (`deleteBranchesFlow`):** one confirmation listing the branches (destructive style when
  remote branches are included); local branches are safe-deleted (`-d`); those refused as
  "not fully merged" get a second, explicit force-delete confirmation; remote branches are deleted
  with one `git push <remote> --delete a b c` per remote (`deleteRemoteBranches`). The current
  branch and tags are skipped. One toast offers "Restore N local" (recreates every deleted local
  branch at its old SHA); remote deletions cannot be undone from the app (said in the dialog).
- **Evidence:** integration test deletes two of three remote branches in one push;
  `e2e/branches.spec.ts` selects three branches with Ctrl+click, deletes them, confirms the force
  delete of the unmerged one, and checks only `keep` and `main` remain.

## Rejected alternatives

- Checking cleanliness before checkout: git already knows exactly which files would be overwritten;
  a dirty tree often checks out fine.
- `git switch`: `checkout` covers detach/track/force uniformly and exists in every supported git.

## Evidence

- `tests/integration/branches.test.ts` (10 tests, real repos + bare remote): checkout / LOCAL_CHANGES
  / force / smart (with and without conflicts), create with invalid name, rename, NOT_MERGED, force
  delete + restore, merge `--no-ff` + backup ref, `--ff-only` refusal, `--squash`, conflict outcome
  (MERGE_HEAD), rebase and "checkout and rebase" (+ backup on the right branch), compare both ways +
  files, fetch/pull/push, force-with-lease refusal, remote rename, remote delete, remotes list,
  unset upstream, recent branches.
- Screenshot: tree with folders, recent, no-upstream markers, branch filter, context menu, toolbar.

## Deliberately not done

- "Update" (fetch + fast-forward) for non-current branches.
- Conflict preview in the merge dialog arrives with M8 (hook `mergePreview`).
- Tag actions in the branch menu arrive with M7 (hook `tagMenuItems`).

## How to verify

`npx vitest run tests/integration/branches.test.ts`; in the app, right-click branches in the Log
sidebar; double-click to check out with local edits present to see Smart/Force checkout.
