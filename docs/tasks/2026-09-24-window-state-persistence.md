# Remember main window size and maximized state

- **Date:** 2026-09-24
- **Branch:** `feat/window-state`
- **Status:** done

## Context

The main window always opened at 1400×900, centered. A user who maximized the
app and restarted it got a normal window back.

## Decisions

- Persist `windowState: { bounds, maximized }` in the existing electron-store
  file (`gitclient-state.json`), schema-validated like the rest.
- Save once, on the window `close` event — no write per resize/move.
- Maximize in `ready-to-show` before `show()`, so the window appears maximized
  instead of flashing at normal size first.
- `bounds` are the *normal* (un-maximized) geometry, so un-maximizing after a
  restart returns to the size the user last chose.
- Normal bounds are tracked from `resize`/`move` events while not
  maximized/minimized/fullscreen, not read from `getNormalBounds()` at close.
- Saved bounds are dropped (default size, centered) when they overlap no
  display work area by at least 100×100 px — an unplugged monitor or a
  resolution change never opens the window off-screen. Logic is pure
  (`restorableBounds`) and unit-tested.

## Rejected alternatives

- `electron-window-state` package — one more dependency for ~40 lines.
- Storing in `settings` — it's UI state, not a user-editable setting.

## What changed

- `src/main/windowState.ts` — new: `WindowState` type, `restorableBounds()`.
- `src/main/window.ts` — `createMainWindow(saved, onClose)`: restores bounds,
  maximizes before show, tracks normal bounds, reports state on close.
- `src/main/store.ts` — `windowState` key with schema + default.
- `src/main/index.ts` — passes store state in, saves it on close.
- `tests/unit/windowState.test.ts`, `e2e/window-state.spec.ts` — new.

## Evidence

- `vitest run tests/unit/windowState.test.ts` — 5 passed. Typecheck and eslint clean.
- `playwright test e2e/window-state.spec.ts e2e/smoke.spec.ts` — 4 passed:
  resize → restart keeps 1000×700; maximize → restart opens maximized;
  un-maximize → back to 1000×700.

## Corrections

- Assumed `getNormalBounds()` returns the un-maximized bounds on all
  platforms. On Linux it returned a frame-inclusive size for a maximized window
  (1024×724 instead of 1000×700), so the window would grow on every maximized
  restart. Replaced with event-based tracking.
- A first implementation of this task was lost: it lived uncommitted in a
  worktree (`../git-manager-window-state`) that was removed. Redone on a plain
  branch in the main checkout.

## Deliberately not done

- Fullscreen state is not persisted (reopens maximized or normal).
- No per-display DPI rescaling of saved bounds.

## How to verify

```bash
npm test && npm run typecheck && npm run lint
E2E_NO_SANDBOX=1 npm run test:e2e -- e2e/window-state.spec.ts
```

Manual: maximize the app, quit, reopen → opens maximized; un-maximize → last
normal size.
