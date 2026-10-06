# Milestone 6 — Local changes & commit

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done

## Context

IDE-style Commit tool window: changed / unversioned files tree with a checkbox per file and per
hunk, diff per file, rollback per file / hunk, message editor with 50/72 guide, recent messages,
amend, sign-off, Commit and Commit-and-Push (push dialog from M4).

## Decisions

- **Checkbox = index state** (checked = fully staged, indeterminate = partly, empty = unstaged).
  The commit is exactly the index, so partial staging and the tree never disagree.
- **Hunk staging with generated patches:** `git diff [--cached] --no-renames -U3` parsed into hunks;
  the selected hunks + the diff header are re-emitted and applied with `git apply --cached
  [--reverse] --recount -` (stdin). Unstaged hunks come from index→worktree, so applying a subset
  onto the index needs no offset fixing. Discard hunk = `git apply --reverse` on the worktree.
  "\ No newline at end of file" lines are carried verbatim; CRLF bytes are untouched.
- **Paths through stdin** (`--pathspec-from-file=- --pathspec-file-nul`) for add/restore/rm --cached:
  no argv-length limit (Windows), no option injection. `clean`/`rm -f` lack that option → batched
  args after `--`.
- **Rollback semantics:** tracked → `restore --source=HEAD --staged --worktree`; added → `rm -f`;
  untracked → `clean -f`; renames restore both paths. Always confirmed (destructive).
- **Unborn repos:** unstage = `rm --cached`; "nothing staged" check skipped before the first commit.
- **Commit** via `git commit -F -` (stdin), `--amend`, `--signoff`; recent messages (20) stored per
  repo. Amend loads the last message (asks before replacing a draft).
- **No working-tree watcher:** watching every file hits inotify limits on large repos. Status is
  polled every 3 s only while the Commit view is visible, and refreshed on focus and after every
  operation / .git change. Polling commands are logged to the Git Console flagged `background`
  (hidden unless "Show background refreshes" is ticked; failures always shown) — the spec requires
  every command to be logged.
- **Ctrl+K** opens the Commit view (View menu too); a badge on the stripe shows the change count.

## Evidence

- `tests/integration/workingTree.test.ts` (6): status (modified/staged/renamed/deleted/untracked,
  spaces), stage/unstage incl. deletions and unborn repo, stage/unstage/discard single hunks,
  CRLF + missing final newline preserved through hunk staging, rollback of modified/added/
  renamed/untracked, commit refusing empty, sign-off, amend.
- `e2e/commit.spec.ts`: Ctrl+K, select file, stage only the second hunk, Ctrl+Enter commit →
  HEAD contains only that hunk, the other stays unstaged.

## Deliberately not done

- Line-level (sub-hunk) staging.
- Hunk staging for untracked files (stage them whole).
- Changelists (IDE-specific concept).

## How to verify

`npx vitest run tests/integration/workingTree.test.ts`, `npm run test:e2e`.
