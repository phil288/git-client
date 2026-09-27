# Setting: default state of "Force (-f -f)" on worktree removal

- **Date:** 2026-09-27
- **Branch:** `feat/worktree-force-delete-setting`
- **Status:** done (unverified by tooling, see Evidence)

## Context

The Remove Worktree dialog always opened with "Force `git worktree remove -f -f`" unchecked. Users who routinely discard throwaway worktrees had to tick it every time. Requested: a setting that decides whether it starts checked.

## Decisions

- New boolean `Settings.worktreeForceRemove`, default `false` — keeps the safe behaviour for existing installs; `store.ts` merges `DEFAULT_SETTINGS` so old stores pick it up.
- Checkbox in Settings → Git, next to "Confirm large pushes".
- Dialog reads it once as the `useState` initializer (`useAppStore.getState()`), so the user can still untick per removal and a settings change does not flip an open dialog.

## Rejected alternatives

- Skipping the dialog / auto-forcing when the setting is on — too destructive; the warning banner and the explicit "Force Remove" button label stay.
- Applying it to the context-menu "Force Remove (-f -f)…" or the escalate-to-force prompt in `removeWorktreeFlow` — those are already explicit force actions.

## What changed

- `src/shared/types.ts` — `worktreeForceRemove` in `Settings` + `DEFAULT_SETTINGS`.
- `src/main/store.ts` — schema entry `{ type: 'boolean' }`.
- `src/renderer/src/features/settings/SettingsDialog.tsx` — "Force worktree removal by default" row.
- `src/renderer/src/features/worktrees/WorktreeDialogs.tsx` — `RemoveWorktreeDialog` initial `force` from settings.

## Evidence

`npm run typecheck`, eslint and vitest could not run: `node_modules` in this checkout is a self-referential symlink (`node_modules -> ../git-manager/node_modules`, ELOOP). Needs `npm ci` (after removing the link) before verifying.

## Corrections

None.

## Deliberately not done

- No new unit/e2e test; `e2e/worktrees.spec.ts` still exercises the default (unchecked) path.

## How to verify

1. `npm run typecheck && npm test`.
2. Settings → Git → tick "Force worktree removal by default".
3. Worktrees view → Remove on any worktree: Force is pre-ticked, button reads "Force Remove", untick works.
4. Untick the setting: dialog opens unchecked again.
