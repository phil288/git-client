# Merge editor: +/− toggles to keep or remove each side

- **Date:** 2026-10-03
- **Branch:** `feat/conflict-hunk-picker`
- **Status:** done

## Context

When resolving conflicts, the merge editor gutters only offered `»`/`«` (apply) and `✕` (ignore), and only while a side was still pending. Once a side was applied it could not be taken back except with Ctrl+Z. Request: click `+` / `−` to choose which changes to keep or remove.

## Decisions

- New model actions `removeLeft` / `removeRight` in `src/shared/mergeModel.ts`: drop the side from `order` and mark it `ignored`, whatever its previous state. Re-adding with `apply*` appends it after the already-kept side (order reflects click order, as before).
- Gutter strips show a `+` / `−` pair for every chunk side that carries its own change (conflicts: both sides; `ours`/`theirs`: the changed side; `same`: left only, since both sides are identical). They stay visible after resolution so a choice can be flipped. Active state is filled (green `+` = kept, red `−` = removed), `aria-pressed` set.
- Pre-applied non-conflicting changes can now be removed too.
- Inline mode: each conflict zone gets the same `+`/`−` per side; zones now stay for resolved conflicts (struck-through / dimmed text) so they remain toggleable.
- Kept `data-testid="apply-<side>-<i>"` on `+` so existing e2e tests still work; `−` is `remove-<side>-<i>`.

## Rejected alternatives

- Per-line +/− within a chunk — much larger change (partial chunk content, model and block tracking); manual editing of the result covers it.
- Single toggle button per side — pending state (neither kept nor removed) would be ambiguous.

## What changed

- `src/shared/mergeModel.ts` — `removeLeft`/`removeRight` actions.
- `src/renderer/src/features/merge/MergeEditor.tsx` — gutter `+`/`−` toggles, `hasSideChange`, inline-zone toggles + styles.
- `tests/unit/mergeModel.test.ts` — remove/re-add test.
- `e2e/conflicts.spec.ts` — rebase test removes Theirs, then keeps both.

## Evidence

- `npm run typecheck`, eslint on touched dirs: clean.
- `vitest run tests/unit/mergeModel.test.ts`: 7 passed.
- `playwright test e2e/conflicts.spec.ts`: 3 passed.
- Screenshot checked: Yours `+` green, Theirs `−` red, result shows only Yours.

## Deliberately not done

- Toolbar "Ignore" for the current chunk still uses `ignoreLeft/Right` (only affects pending sides).

## How to verify

```bash
npm run typecheck && npx vitest run tests/unit/mergeModel.test.ts && npm run test:e2e -- e2e/conflicts.spec.ts
```

Manually: open a conflicted file in the merge editor, click `+` on Yours, then `−` on it — the lines leave the result; `+` brings them back.
