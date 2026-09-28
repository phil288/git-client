# Search and editing in the 3-way merge editor

- **Date:** 2026-09-28
- **Branch:** `feat/merge-editor-search-edit`
- **Status:** done

## Context

User asked for search in each pane of the merge editor (Yours / Result / Theirs) and for manual editing. Ctrl+F did nothing in any pane.

Root cause: `src/renderer/src/lib/monaco.ts` imports only `monaco-editor/editor/editor.api`, which ships **no editor contributions** — no find widget, no clipboard/context-menu actions, no line/word operations, no multi-cursor. The result pane was already `readOnly: false`, but editing was bare (typing only).

## Decisions

- Register the needed contributions via `monaco-editor/features/<name>/register` (the 0.56 per-feature entry points): find, clipboard, contextmenu, linesOperations, wordOperations, multicursor, comment, cursorUndo, bracketMatching. Global — the diff viewer gets Ctrl+F too.
- Each pane header gets a search button (Result also gets a replace button) that runs Monaco's `actions.find` / `editor.action.startFindReplaceAction` on that pane. Each editor has its own find widget, so search is per section. Keyboard: Ctrl+F / Ctrl+H inside a pane.
- Yours / Theirs / Base stay read-only (find works, replace disabled there).
- The global Ctrl+F handler in `LogToolbar` already skips events from `.monaco-editor`, so no conflict.

## Rejected alternatives

- `import 'monaco-editor'` (full `editor.main`) — pulls every contribution plus TS/CSS/HTML/JSON language services and their workers; project deliberately avoids that.
- Custom React search box above each pane — duplicates Monaco's find (regex, case, whole word, match count, highlights) for no gain.
- Making Yours/Theirs editable — chunk model (`oursStart`/`theirsStart`, word diffs, connectors) is computed from the fixed side texts; editing them would require re-running `merge3` and resetting the result. Not requested explicitly; all manual edits belong in Result.

## What changed

- `src/renderer/src/lib/monaco.ts` — register Monaco contributions.
- `src/renderer/src/features/merge/MergeEditor.tsx` — `openFind` helper; search button in Yours/Result/Theirs/Base headers, replace button in Result; header hint mentions Ctrl+F / Ctrl+H.
- `e2e/conflicts.spec.ts` — new test: three find widgets open, match count shown, replace-all in Result, typed line, saved file content checked.

## Evidence

- `npx playwright test e2e/conflicts.spec.ts` — 3 passed.
- `npm test` — 219 passed. `tsc -p tsconfig.web.json` and `eslint .` clean.

## Corrections

- First version of the e2e test applied only Yours; save then stopped on the "unresolved conflicts" confirm. Test applies both sides now.

## Deliberately not done

- Editing Yours/Theirs panes (see rejected).
- Cross-pane search (one query across all three) — per-pane widgets cover it.

## How to verify

```bash
npm run build && npx playwright test e2e/conflicts.spec.ts
```

Manually: open a conflicted file in the merge editor, click the magnifier in any pane header (or Ctrl+F in the pane) → Monaco find widget with match count. In Result, Ctrl+H / replace button → replace; type, cut/paste, Ctrl+D multi-cursor, Alt+↑/↓ move line all work; Ctrl+Z still restores chunk states.
