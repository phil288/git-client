# Milestone 8 — Conflict resolution

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done

## Context

Conflicts from merge, rebase (incl. interactive/squash/reword), cherry-pick, revert, pull and stash
apply/pop, handled uniformly: banner, conflicts dialog with honest Yours/Theirs labels, simple-conflict
auto-resolution, a JetBrains-style 3-way merge editor, special conflict types, merge-tree preview,
rerere and external tool support.

## Decisions

- **Labels are computed, never raw ours/theirs.** Column/pane headings are always "Yours" (index
  stage 2) and "Theirs" (stage 3), each with a name and a detail derived from the operation:
  merge → `Yours: main (current branch)` / `Theirs: feature/x (being merged '…')`; rebase →
  `Yours: main (upstream)` / `Theirs: feature/x (your commit 'Fix login')` (git's inversion made
  explicit); cherry-pick/revert/stash/squash-merge have their own wording.
- **Conflict classification from `ls-files -u -z` stages** (base/yours/theirs present?, same SHA as
  base?, mode 160000?) → content, add/add, modify/delete (both directions), added-by-one-side,
  both-deleted, binary (NUL in first 8000 bytes of a stage blob), submodule. Gitlink SHAs are taken
  from the index entries because the submodule's commits are usually not in the parent's object DB
  (a real bug caught by the test).
- **Resolutions:** take a side = `checkout --ours/--theirs` + `add`, or `rm` when that side deleted
  the file, or `update-index --cacheinfo 160000,<sha>` for submodules; merge result written in the
  file's original encoding (BOM/UTF-16/latin1 preserved) and staged; "Mark as Resolved" only when no
  markers remain; rename conflicts: keep one path, remove the others.
- **Auto-resolve ("Resolve simple conflicts")** uses the shared line-based 3-way merge
  (`src/shared/merge3.ts`, written by a sub-agent and reviewed): only-one-side and identical changes
  merge, adjacent edits merge too (git conflicts on those), true overlaps remain. Output uses the
  file's EOL and final-newline state.
- **Merge editor model (`src/shared/mergeModel.ts`)** is pure: chunks with per-side state
  pending/applied/ignored and an application order (so » then « = "Yours then Theirs"). Initial
  result pre-applies non-conflicting changes (spec), conflicts keep the base text; Reset = base with
  every change pending (then the "Apply non-conflicting" buttons matter). Accept all Yours/Theirs
  *take* one side per chunk (whole-file equivalent), not "append".
- **Result tracking in Monaco:** each chunk's result block is a tracked decoration `[start, end)`;
  the model always carries one extra trailing line so blocks are uniform line ranges (stripped on
  save; the original final-newline state is restored). Every action is one undo stop and a snapshot
  of chunk states + block ranges is stored per `alternativeVersionId`, so Ctrl+Z/Ctrl+Y restore both
  text and chunk state. Manual edits are free.
- **Gutter strips** between panes draw connector curves (SVG bezier ribbons per chunk) and host the
  »/«/✕ buttons; scrolling any pane maps the top line through chunk anchors to the others.
- **Base** shown as a bottom overlay pane; **inline mode** hides the side panes and shows Yours/Theirs
  of each unresolved conflict in Monaco view zones with Accept buttons.
- **Save** warns if markers remain or conflicts are unresolved; closing unsaved work confirms.
- **After the last file:** the dialog switches to "All conflicts resolved — Continue <op>?" with the
  commit message editor pre-filled for merges and squash merges (MERGE_MSG / SQUASH_MSG);
  `merge --squash` conflicts (no operation marker) finish with a commit.
- **Preview:** `merge-tree --write-tree --name-only --no-messages -z` (framing checked) when git ≥ 2.38,
  hidden otherwise; shown in the Merge dialog.
- **rerere** per repository (`rerere.enabled` + `rerere.autoUpdate`); external tool via
  `git mergetool --no-prompt [--tool=<Settings>]` (falls back to `merge.tool`). Settings UI in M9.

## Evidence

- `tests/integration/conflicts.test.ts` (12): merge content conflict + labels + message; the same
  conflict in a rebase with inverted labels and stage contents; full flow resolve → continue →
  finished; modify/delete keep & delete; add/add (no base); binary choose Theirs byte-exact; CRLF
  preserved on save; auto-resolve adjacent edits (CRLF) with a true conflict left; stash-pop labels;
  submodule conflict resolved with a chosen SHA; merge-tree preview (no working-tree change); rerere.
- `tests/unit/merge3.test.ts` (51, sub-agent), `tests/unit/mergeModel.test.ts` (6).
- `e2e/conflicts.spec.ts`: rebase conflict → banner → dialog labels → merge editor » then « →
  counter 0 → Save → Continue → history correct; merge conflict → Accept Theirs → prepared message →
  merge commit.
- Screenshot of the editor: conflict + word highlights, adjacent edits pre-merged, connectors.

## Deliberately not done

- Character-level (intra-line) merging.
- 4-pane layout for Base (overlay pane instead, which the spec allows).
