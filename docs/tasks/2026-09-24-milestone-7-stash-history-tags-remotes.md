# Milestone 7 — Stash, file history, blame, tags, remotes

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done

## Decisions

- **Stash:** list via `stash list --format=%gd%x00%H%x00%ct%x00%gs`; files = diff `stash^1..stash`
  plus the untracked commit `stash^3` (shown separately). Push with message / include untracked /
  keep index; "nothing to stash" detected by comparing the top entry before/after (git exits 0).
  Apply/Pop optionally `--index` ("Reinstate index"); pop conflicts are an outcome and the stash is
  kept (git's behaviour, said in the message). Drop is confirmed. Branch from stash.
- **File history:** `log --follow --name-status -z` with the log format; framing verified
  empirically (`…subject\0\n<status>\0<path>[\0<new>]\0`), path per revision tracked across renames;
  diff of each revision vs its first parent.
- **Blame:** `blame --porcelain` parsed (header + key/values once per commit + TAB line); gutter
  shows hash/author/date on the first line of each block, background tint by age (newest most
  green), uncommitted lines marked "local"; clicking opens the commit in the Log
  (`logPendingGoTo` → `LogView.goTo`, which pages until the commit is loaded).
- **Views:** Stashes in the tool stripe; File History and Annotate appear in the stripe when opened
  (closable), from the Commit view and the Log's changed-files context menus.
- **Tags:** lightweight / annotated (`-F -` message via stdin), validated with
  `check-ref-format refs/tags/<name>`, push, delete local (confirm), delete on remote (confirm).
  New Tag on commits; tag actions in the branches tree menu.
- **Remotes:** list/add/edit URL/push URL/rename/remove (confirm)/prune/fetch in a Manage Remotes
  dialog (Git menu). `remote add -- name url` so names/URLs can never be options.

## Evidence

- `tests/integration/m7.test.ts` (6): stash push/list/files incl. untracked/apply/pop/branch/drop,
  stash-pop conflict keeps the stash and is detected as operation-less conflict, history across a
  rename into a folder with spaces, blame incl. "Not Committed Yet" and blame at a revision, tags
  (lightweight/annotated/invalid/push/delete remote/delete), remotes (add/set-url/push-url/rename/
  prune/remove).
- `e2e/m7.spec.ts`: stash + pop through the Stashes view; Show History and Annotate from the Commit
  view context menu.

## Deliberately not done

- Blame "ignore whitespace / follow moves" options.
- Stash of selected files only.
