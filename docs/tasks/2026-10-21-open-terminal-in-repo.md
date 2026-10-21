# Open a terminal in the current repository

- **Date:** 2026-10-21
- **Branch:** `feat/open-terminal`
- **Status:** done

## Context

Request: open a bash console in the current repository. The launcher already existed
(`src/main/osOpen.ts` `openInTerminal`, IPC `shell:openInTerminal`, honouring
Settings → Terminal command), but it was only reachable from the Worktrees view and the
Welcome screen's recent-repo context menu. With a repository open there was no direct way.

## Decisions

- Reuse `shell:openInTerminal` — no new IPC, same security path (spawned directly, no shell,
  path validated in main).
- Entry points: a **Terminal** button in the repo toolbar (next to Fetch/Pull/Merge/Push),
  **View → Open Terminal in Repository**, and **Alt+F12** (JetBrains' terminal shortcut, in line
  with the IDE-style Alt+9 console). The shortcut goes through `shortcutFor` like the others so it
  is unit-testable and is suppressed while a modal dialog is open.
- "Bash" = the user's terminal emulator with its default shell. On Linux the user's login shell
  is used (bash for most); a specific shell/terminal can be forced via Settings → Terminal command.

## Rejected alternatives

- Embedded terminal pane (xterm.js + node-pty) — native module per platform, a PTY inside the
  sandboxed app, and much larger surface for a feature an external terminal already covers.
- Hard-coding `bash` — wrong on Windows and for users with another shell; the configurable
  terminal command already covers it.

## What changed

- `src/shared/types.ts` — `MenuCommand` gains `'open-terminal'`.
- `src/shared/shortcuts.ts` — Alt+F12 → `'open-terminal'`.
- `src/main/menu.ts` — View menu item with Alt+F12 accelerator.
- `src/renderer/src/App.tsx` — handles `'open-terminal'` for the active tab's repo path (no-op on
  the Welcome screen).
- `src/renderer/src/features/repo/RepoToolbar.tsx` — Terminal button (`data-testid="toolbar-terminal"`).
- `src/renderer/src/features/settings/ShortcutsDialog.tsx` — lists Alt+F12.
- `tests/unit/shortcuts.test.ts` — Alt+F12 mapping.

## Evidence

`npm run typecheck`, `npm run lint` clean; `npm test` 280/280 passing.

## Corrections

None.

## Deliberately not done

- No e2e: clicking the button would launch a real terminal window on the test machine. Launcher
  logic itself is unchanged and already covered by existing code paths.
- Not verified manually in the running app in this task.

## How to verify

1. `npm run dev`, open a repository.
2. Click **Terminal** in the toolbar, or press Alt+F12, or View → Open Terminal in Repository:
   a terminal window opens with its working directory at the repo root.
3. With Settings → Terminal command set (e.g. `kitty --directory .` or `gnome-terminal`), that
   command is used instead.
