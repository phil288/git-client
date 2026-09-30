# Reorder repo tabs by drag and drop; pin tabs

- **Date:** 2026-09-30
- **Branch:** `feat/tab-dnd-pin`
- **Status:** done

## Context

Repo tabs were fixed in opening order (new tabs go right after the active one) and every tab could be closed by a stray middle click. Request: move tabs around by drag and drop, and pin tabs.

## Decisions

- **Browser model for pinning:** pinned tabs form a contiguous group at the start of the strip. Pinning appends to that group; unpinning puts the tab first among the unpinned ones. Drag and drop moves a tab only within its own group — dropping outside it shows no indicator and is refused (no-drop cursor).
- **Pinned tabs are protected, not locked:** no close (X) button — a pin button that unpins instead — and middle click does nothing. Explicit closes still work: Ctrl+W, the context menu's Close, and worktree removal (`closeTabsFor`). Locking these would make a pinned tab of a deleted worktree unclosable.
- **"Replace" opens on a pinned tab open a new tab** (repo switcher click), so a pinned tab keeps its repo. New tabs never land inside the pinned group.
- **Tab context menu:** Pin/Unpin, Close, Close Other Tabs, Close Tabs to the Right. The bulk closes skip pinned tabs.
- **Native HTML5 drag and drop**, as already used in `RecentItem` and `RewriteDialogs`: no new dependency. Drop target = left/right half of the hovered tab; empty strip space after the tabs = the end. A 2px accent bar marks the drop point; the dragged tab dims.
- **Ordering rules are pure** (`src/shared/tabOrder.ts`) so they are unit tested without the store's `window.bridge`/IPC dependencies; `src/shared` is where other pure models (`mergeModel`) live.
- **Persistence:** `pinned` is saved in the session (`TabSession.pinned`, store schema, `session:save` sanitizer — only `true` is kept). Reorder and pin toggles are saved immediately, like open/close: `sameTabSet` now also compares pin state. `restore` re-sorts pinned first in case the file was hand-edited.

## Rejected alternatives

- `@dnd-kit` or similar — adds a dependency for a single horizontal strip that native DnD handles; the codebase has no DnD library.
- Icon-only compact pinned tabs (Chrome style) — repo avatars are two-letter initials, often ambiguous (e.g. several `GM` repos); keeping the name is clearer. Easy to revisit.
- Letting drag and drop pin/unpin a tab by dropping across the group boundary (Firefox style) — implicit and easy to trigger by accident; pinning stays an explicit action.

## What changed

- `src/shared/tabOrder.ts` — `pinnedCount`, `normalizeOrder`, `moveTab`, `setPinned`.
- `src/renderer/src/stores/tabs.ts` — `RepoTab.pinned`; `move`, `setPinned`, `closeOthers`, `closeToRight`; `open` respects the pinned group; restore/toSession/persist carry `pinned`.
- `src/renderer/src/features/tabs/TabBar.tsx` — draggable tabs, drop indicator, pin button, context menu; tab rendering split into a `Tab` component.
- `src/shared/types.ts`, `src/main/store.ts`, `src/main/index.ts` — `pinned` in the session type, schema and save sanitizer.
- `tests/unit/tabOrder.test.ts`, `e2e/tabs.spec.ts` — new.

## Evidence

- `npm run typecheck`, `npm run lint` clean.
- `npx vitest run tests/unit` — 15 files, 123 tests pass (6 new).
- `npx playwright test` — 19 pass, 1 fail: `window-state.spec.ts` (window not reported maximized after restart). It fails the same way in the main checkout on another branch, so it is environmental/pre-existing, not caused by this change. `e2e/tabs.spec.ts` covers drag reorder, pin via context menu, refused cross-group drop, Close Other Tabs keeping the pinned tab, and order + pin state surviving a restart.

## Corrections

- First e2e draft compared tab `innerText`, which also contains the avatar initials (`BE\nbeta`); the spec reads the repo folder from the tab's `title` instead.

## Deliberately not done

- No keyboard shortcut for reordering (e.g. Ctrl+Shift+PageUp/Down) or pinning.
- Dragging a tab out to a new window, or dropping a Recent repo onto the strip to open it.
- Ctrl+1…9 still count pinned tabs as ordinary positions (they come first, which matches browsers).

## How to verify

```bash
npm run test -- tests/unit/tabOrder.test.ts
npm run test:e2e -- e2e/tabs.spec.ts
```

Manually: open 3+ repos, drag a tab onto the left/right half of another — accent bar shows the drop point, tab moves on release. Right-click a tab → Pin Tab: it jumps to the front, shows a pin icon instead of X, ignores middle click; unpinned tabs cannot be dropped in front of it. Restart the app: order and pins are restored.
