# Milestone 9 — Polish, OS integration, performance

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (stacked, uncommitted)
- **Status:** done (Windows-only parts verified by review + CI only)

## Decisions

- **Settings dialog** (File → Settings…, Ctrl+,): theme, reopen session, date format, update check,
  git executable (pick / auto-detect), default pull mode, auto-fetch (off/5/15 min), large-push
  confirmation (destructive actions always confirm, not configurable), per-repository rerere,
  external merge tool (shows `git config merge.tool`), editor/terminal commands, scan depth,
  Explorer entry (Windows) / Nautilus-Nemo script (Linux). Every change is saved immediately.
- **Auto-fetch** in main: `git fetch --all --prune --quiet` for every open repository (the watcher's
  roots), sequential, logged as background, failures ignored, `GIT_TERMINAL_PROMPT=0` and
  `GCM_INTERACTIVE=never` so it can never prompt.
- **Windows jump list** (`app.setJumpList`): Pinned + Recent Repositories, launching the exe with the
  path (single-instance forwards it as a new tab); refreshed whenever recents change.
- **Explorer "Open in GitClient"** toggle writes/removes the same HKCU keys as `build/installer.nsh`
  via `reg.exe` spawned with argument arrays.
- **Nautilus / Nemo script** (Linux) installed into `~/.local/share/{nautilus,nemo}/scripts` for file
  managers the account uses; launches `$APPIMAGE` or the executable. Percent-decoding of the current
  folder URI uses POSIX awk with `LC_ALL=C`.
- **Error handling:** error boundaries around each repository view and the welcome screen; global
  `unhandledrejection` / `error` handlers become toasts with details.
- **Keyboard shortcuts** dialog (Help); Help → Check for Updates wired for M10.
- **Log paging:** first page 2,000 commits (fast first paint), later pages 10,000; End loads the rest
  and jumps to the last commit.

## Corrections

- The first Nautilus script used `printf %b` with `\xHH`; `/bin/sh` on Ubuntu is dash, which only
  supports octal escapes — the unit test that actually runs the script caught it.
- Reaching the end of a 100k history took 14 s with 2,000-commit pages one scroll at a time; now
  1.5 s (bigger later pages + End = load rest).

## Evidence — performance (this machine, git 2.53, synthetic repo)

`npm run test:perf` (100,000 commits, side branch merged every 50 commits, 20 tags, commit-graph):

| Measurement | Result |
| --- | --- |
| Build repo with fast-import | 10.6 s |
| First page (2,000 commits) | 131 ms |
| Stream all 100,000 commits | 1.35 s |
| Graph layout of all rows | 115 ms (max 2 lanes) |
| Text search over all messages | 1.19 s |

Electron UI on the same repo (Playwright): launch → first rows 1.5–1.9 s; End (load all 100k and
jump) 1.5 s; 20× PageUp 0.45 s; renderer JS heap ≈ 92–103 MB.

Other tests: `tests/unit/fileManagerScript.test.ts` runs the generated script under /bin/sh with
selection, percent-encoded URI (incl. UTF-8) and empty input.

## Deliberately not done / not verifiable here

- A Linux-kernel-sized clone (~1.3M commits) was not benchmarked (network/disk); the streaming design
  never loads more than requested plus a 10k buffer.
- Jump list, Explorer entry and NSIS PATH changes are untested on real Windows (CI builds only).
- Final Windows packaging happens in the release workflow (no Windows machine here); Linux packages
  were built locally (AppImage, .deb, .tar.gz).
