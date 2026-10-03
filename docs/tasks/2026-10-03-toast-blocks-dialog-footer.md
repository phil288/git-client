# Toast blocked "Continue rebase" (CI conflicts e2e failure)

- **Date:** 2026-10-03
- **Branch:** `fix/ci-failure`
- **Status:** done

## Context

CI (`e2e/conflicts.spec.ts` › rebase conflict) failed since `1e3ede7 fix: toast
overlap`: clicking `continue-op` timed out because the
"app.txt resolved" success toast (raised by the merge editor on save)
"intercepts pointer events". The toast sits bottom-right, exactly over the
conflicts dialog footer.

Root cause: the toast-overlap fix set `[data-sonner-toaster] { pointer-events: auto }`.
Before it, inside a Radix modal the toaster inherited `pointer-events: none`
from `<body>`, so toasts were click-through over dialogs. After it, any toast
blocks whatever dialog button is beneath it. Real UX regression, not a flake:
users right after saving a merge could not click Continue for ~4 s.

## Decisions

- Replace the toaster-wide override with `[data-sonner-toast] button { pointer-events: auto }`.
  Inside a modal the toast body stays click-through (pre-`1e3ede7` behaviour for
  dialog buttons), while the close × and action buttons stay clickable (the
  goal of `1e3ede7`). Outside modals nothing changes (sonner's own default).
- Hovering the close button still bubbles `mouseenter` to the toast, so it
  pauses/expands.
- `DialogContent`'s `onInteractOutside` toaster guard kept: clicking × must not
  dismiss the dialog.

## Rejected alternatives

- Dismissing toasts in the e2e test before clicking Continue — hides a real bug.
- Dropping the merge editor's "resolved" toast — whack-a-mole; any dialog-time
  toast can cover any footer.
- Moving the toaster — already rejected in the 2026-10-01 record.

## What changed

- `src/renderer/src/styles.css` — pointer-events override narrowed to toast buttons.
- `e2e/toasts.spec.ts` — no longer hovers the toast body (it is click-through in
  a modal by design); clicks × directly.

## Evidence

- Before: CI run 37125031628 — 1 failed (conflicts rebase), 21 passed.
- After (local): `npm run typecheck`, `npm run lint` clean; `npm test` 225 passed;
  `npx playwright test` 22/22 passed.

## Corrections

- The 2026-10-01 record said toasts should be fully interactive in modals;
  that blocked dialog footers. Only their buttons need to be.

## Deliberately not done

- Hovering the toast body inside a modal no longer pauses/expands it (only
  hovering its buttons does). Acceptable trade-off.

## How to verify

```bash
npx electron-vite build && E2E_NO_SANDBOX=1 npx playwright test e2e/toasts.spec.ts e2e/conflicts.spec.ts
```
