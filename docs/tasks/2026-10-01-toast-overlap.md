# Toasts could not be closed while a dialog was open

- **Date:** 2026-10-01
- **Branch:** `fix/toast-overlap`
- **Status:** done

## Context

Toasts (sonner, bottom-right) sometimes sat on top of buttons and could not be
closed. Repro: open any modal dialog (e.g. Create New Branch), trigger an error
toast from it (create a branch name that already exists), try to hover / close
the toast — nothing reacts.

Root cause: Radix modals (`DismissableLayer` with `disableOutsidePointerEvents`)
set `pointer-events: none` on `<body>` while open. Sonner's toaster lives in
`<body>` and does not reset `pointer-events`, so it inherited `none`: clicks went
through the toast to the dialog overlay / buttons underneath, the close button
and hover-expand were dead, and the toast stayed until its timer (10–30 s for
errors/warnings) ran out.

## Decisions

- `[data-sonner-toaster] { pointer-events: auto; }` in `styles.css` — toasts are
  always interactive, modal or not.
- `DialogContent` ignores outside interactions whose target is inside the
  toaster (`onInteractOutside` → `preventDefault`), so closing a toast does not
  also dismiss the dialog (and lose what the user typed). Caller-supplied
  `onInteractOutside` is still called.

## Rejected alternatives

- Moving the toaster to another corner / top-center — every corner of this UI
  has buttons (header toolbar, diff toolbar, dialog footers); it only moves the
  overlap, and does not fix the dead close button.
- Rendering the toaster inside each dialog — many dialogs, and toasts raised
  after a dialog closes would need a second toaster.
- Esc-to-dismiss-all-toasts — Esc already closes dialogs/menus and cancels
  inline edits; one key doing two things is surprising. Not needed once toasts
  are clickable.

## What changed

- `src/renderer/src/styles.css` — toaster pointer-events override.
- `src/renderer/src/components/ui/dialog.tsx` — toast clicks are not "outside" clicks.
- `e2e/toasts.spec.ts` — regression test.

## Evidence

- New e2e failed before the fix: Playwright reported the dialog overlay
  "intercepts pointer events" when hovering the toast.
- With only the CSS fix (dialog guard reverted), the toast closes but the
  `expect(dialog).toBeVisible()` assertion fails — the guard is load-bearing.
- With both: `npm run typecheck`, `npm run lint`, `npm test` (225 passed),
  `npm run test:e2e` 21/22 passed; the one failure is
  `window-state.spec.ts` (maximize under the local window manager), which
  passed on the previous run of the same code and does not touch toasts/dialogs.

## Corrections

None.

## Deliberately not done

- Radix `DropdownMenu`/`ContextMenu` (also modal) still close when a toast is
  clicked; harmless (menus are transient), so not guarded.
- Toast durations unchanged.

## How to verify

```bash
npx electron-vite build && E2E_NO_SANDBOX=1 npx playwright test e2e/toasts.spec.ts
```

Manually: Branches panel → `+` → type an existing branch name → Create. The
error toast can be hovered and closed with its × while the dialog stays open.
