# Fix "TextModel got disposed before DiffEditorWidget model got reset"

- **Date:** 2026-09-24
- **Branch:** `fix/diff-editor-dispose`
- **Status:** done

## Context

An "Unexpected error" toast appeared whenever the Monaco diff viewer unmounted
(switching file, toggling side-by-side/unified, closing the diff):
`TextModel got disposed before DiffEditorWidget model got reset`.

Root cause: `@monaco-editor/react` 4.7 `DiffEditor` cleanup disposes the
original/modified models first, then the editor. monaco-editor 0.56's
`DiffEditorWidget` listens to `onWillDispose` on its models and reports that
order as a bug via `onUnexpectedError`, which our global `error` handler in
`main.tsx` turns into a toast.

## Decisions

- Pass `keepCurrentOriginalModel` / `keepCurrentModifiedModel` so the wrapper
  only disposes the editor, and dispose the models ourselves afterwards.
- Hook the **inner modified editor's** `onDidDispose` and defer disposal with
  `queueMicrotask` — by then the whole widget has released the models.
- Models are stable for the editor's lifetime (the wrapper updates content via
  `setValue`, no `*ModelPath` props are used), so capturing them at mount is safe
  and nothing leaks.

## Rejected alternatives

- `DiffEditorWidget.onDidDispose` — the widget never fires it in 0.56 (emitter
  exists in `delegatingEditorImpl.js`, no `.fire()`).
- Keeping models without disposing them — leaks one pair of models per mount.
- Filtering the error in the global handler — hides the symptom, not the order bug.

## What changed

- `src/renderer/src/features/diff/DiffViewer.tsx` — keep-model props + `onMount`
  disposal helper.
- `e2e/smoke.spec.ts` — toggles unified/side-by-side and asserts no
  "Unexpected error" toast.

## Evidence

- New e2e assertion fails on old code (`Expected: 0, Received: 2` toasts),
  passes with fix. Full `npm run test:e2e`: 9 passed.
- `tsc -p tsconfig.web.json` and eslint clean.

## Deliberately not done

- `MergeEditor.tsx` uses plain `Editor`, which does not have this ordering check; untouched.

## How to verify

```bash
npm run test:e2e
```
Manually: open a commit, click a file, toggle unified/side-by-side, pick another file — no red toast.
