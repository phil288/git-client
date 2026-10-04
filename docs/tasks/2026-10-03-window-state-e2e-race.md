# window-state e2e read bounds before the WM resized (CI flake)

- **Date:** 2026-10-03
- **Branch:** `fix/window-state-e2e`
- **Status:** done

## Context

After the toast fix (`2026-10-03-toast-blocks-dialog-footer.md`) landed, CI run
37126783827 failed only `e2e/window-state.spec.ts`: after `unmaximize()` the
window measured `[1280, 1005]` (maximized size on the 1280x1024 Xvfb minus the
openbox title bar) instead of `[1000, 700]`. The 2026-10-01 toast record had
already seen this test fail once locally and pass on rerun.

Two candidate causes:

1. Test race: `isMaximized()` flips to false before openbox's ConfigureNotify
   with the restored size arrives; the test read `getBounds()` once, immediately.
2. App race: in launch 2 the `resize` from `maximize()` arrives before the
   maximized state, so `track()` in `src/main/window.ts` persists the maximized
   size as the normal bounds.

## Evidence

- Reproduced the CI environment in Docker (`node:22-bookworm` + xvfb + openbox,
  `CI=1`). Instrumented spec logged the persisted `windowState` before launch 3
  and the bounds immediately vs 1.5 s after unmaximize: 12/12 runs under
  `--cpus=1` plus 4 busy-loop processes → persisted state always
  `{1000x700, maximized: true}`, bounds always 1000x700. Could not reproduce the
  failure; no evidence for cause 2.
- After the fix: spec 5/5 in the container; typecheck and eslint clean; full e2e
  suite in the container 21/22 — the one failure (`rewrite.spec.ts`) came from a
  global git identity I injected in that container run and passes on its own; untouched here.

## Decisions

- Poll the restored size (`expect.poll`) instead of a single read. Fixes cause 1.
  If cause 2 were real, the poll would still fail (persisted bounds would be
  wrong), so this does not mask an app bug.

## Rejected alternatives

- Hardening `track()` against cause 2 (debounce / roll back on `maximize`) —
  no evidence it happens; speculative complexity.
- `test.retry` / skipping the test on CI — hides real regressions.

## What changed

- `e2e/window-state.spec.ts` — size after unmaximize is polled.

## Deliberately not done

- Cause 2 not ruled out with certainty (not reproducible). If it reappears,
  the poll fails with the persisted size; check `gitclient-state.json`.

## How to verify

```bash
npx electron-vite build && E2E_NO_SANDBOX=1 npx playwright test e2e/window-state.spec.ts
```
