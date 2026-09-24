# Tags view and compare any branches / tags

- **Date:** 2026-09-24
- **Branch:** `feat/tags`
- **Status:** done (e2e written, not run — run interrupted)

## Context

Request: list all tags, compare tags with each other, and compare tags with branches. Tags could be created, pushed and deleted since milestone 7, but only from the branches tree / Log. There was no tag list. The Compare dialog was fixed to the two refs it was opened with.

## Decisions

- **New "Tags" tool window** (stripe icon under Stashes). It uses `tag:list` (`for-each-ref refs/tags`) and returns `TagEntry`: peeled commit, annotated flag, tagger, date, full annotation message and commit subject. Each field is NUL-separated and each record ends with RS (`%1e`), because annotation messages can span several lines. For annotated tags the date is the tagger date; for lightweight tags it is the committer date.
- **Version-aware sort** by default (`compareVersionNames` in `shared/versions.ts`). Numeric runs are compared as numbers, so v1.10 > v1.9, and a pre-release sorts below its release (`-rc.1` < release). The suffix only counts as a pre-release when it starts with a letter, so `release-2024-01` is not split. Date and Name sorting are also available. The chosen sort is kept per tab.
- **Selecting a tag** shows its details and a built-in `ComparePanel` against the **previous tag by version**, which is the "what's in this release" view. You can change the base to any branch, tag or HEAD with `RefSelect`. "Previous" always uses version order, whatever sort the list uses.
- **Compare two tags:** tick two checkboxes, then click *Compare*. The newer tag goes on the left. Ticking a third tag replaces the older tick.
- **Compare dialog is now editable:** both sides use `RefSelect` (HEAD, local, remote, tags), and there is a swap button. Every existing entry point (branch menu, commit menu) gets this for free. Added *Git → Compare Branches & Tags…* (HEAD vs newest tag) and *Compare with…* on the current branch's menu.
- **Full ref names** (`refs/tags/x`, `refs/heads/x`) are passed to git, so a tag and a branch with the same name are not ambiguous. There is an integration test for this.
- **`CompareResult` gains `countA` / `countB`** (`rev-list --left-right --count`) and `mergeBase`. The commit lists are still capped at 1000, so tabs now show the exact count and the list ends with "… and N older commits". Tag ranges can easily go past 1000.
- Double-clicking a commit in a compare list shows it in the Log.
- The compare query key now includes the repo epoch, so results refresh after repo changes.

## Rejected alternatives

- **Deriving the tag list from `repo:refs`**: it has no tagger or annotation message, and adding those to every ref listing would slow down the Log's refs query.
- **Plain `localeCompare({numeric})` for versions**: it puts `v2.0.0` before `v2.0.0-rc.1`.
- **A separate "Compare refs" dialog**: making the existing dialog editable covered it and kept one code path.

## What changed

- `src/main/git/tagsRemotes.ts`: `listTags`, `parseTags`.
- `src/main/git/branches.ts`: `compare` returns counts and the merge base.
- `src/shared/types.ts` (`TagEntry`, `CompareResult`), `src/shared/ipc.ts`, `src/main/handlers/m7.ts`, `src/renderer/src/lib/api.ts`: `tag:list`.
- `src/shared/versions.ts`: `compareVersionNames`.
- `src/renderer/src/features/tags/TagsView.tsx` (new), `features/common/RefSelect.tsx` (new).
- `features/branches/BranchDialogs.tsx`: `ComparePanel` extracted; `CompareDialog` is editable.
- `features/repo/RepoView.tsx` (stripe), `RepoToolbar.tsx` (Git menu entry), `branches/BranchMenu.tsx` (*Compare with…* on the current branch).
- Tests: `tests/unit/versions.test.ts`, `tests/integration/branches.test.ts`, `tests/integration/m7.test.ts`, `e2e/tags.spec.ts`.

## Evidence

- `npm run typecheck` clean. ESLint clean on touched files.
- `npm test`: 23 files, 211 tests pass (2 new tests, plus new assertions in existing ones).
- `npm run build` passes.
- `e2e/tags.spec.ts` **not run yet**: the build+e2e run was interrupted.

## Deliberately not done

- No tag filter in the Log toolbar, and no "tags only" branch-tree section changes.
- No remote-only tags (`ls-remote --tags`); the view lists local tags only.
- No "compare with working tree" in the Tags view detail pane. *Show Diff with Working Tree* is in the tag's context menu.

## How to verify

```bash
npm test -- tests/integration/branches.test.ts tests/integration/m7.test.ts tests/unit/versions.test.ts
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/tags.spec.ts
```

Manually: open a repo with tags → Tags stripe → select a tag → commits since the previous tag appear. Change *Compare with* to a branch. Tick two tags → *Compare*. In the dialog, swap sides or pick a branch on either side.
