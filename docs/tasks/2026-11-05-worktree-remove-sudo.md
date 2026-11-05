# Remove a worktree with sudo after "Permission denied"

- **Date:** 2026-11-05
- **Branch:** `feat/worktree-remove-sudo`
- **Status:** done

## Context

Auto Merge (and plain Remove) failed cleanup with
`failed to delete '<worktree>': Permission denied` when files inside the worktree were owned by
root (typically written by a container). The user asked to be prompted for the sudo password in
that case instead of being left with a kept worktree.

## Decisions

- **sudo only chowns, never deletes.** `sudo -S -k -p '' -- chown -R <uid>:<gid> -- <worktree>`
  gives the tree back to the user; the removal then runs unprivileged (`git worktree remove`,
  same force level, so git still refuses a dirty/locked worktree at force 0). No `rm -rf` as root.
- **Password handling:** typed into a masked prompt (`PromptOptions.password`), sent over IPC once,
  written to sudo's stdin only — never argv, env, logs, or the store. Multi-line passwords are
  refused (would feed sudo extra lines). `-k` makes sudo always read stdin as the password.
  Up to 3 tries on a wrong password, then a toast.
- **New error codes:** `PERMISSION_DENIED` (git stderr "Permission denied" on remove) and
  `AUTH_FAILED` (wrong password / not a sudoer, parsed from sudo stderr under `LC_ALL=C`).
- **Path trust:** `worktree:removeElevated` accepts only a listed linked worktree of the repo, or a
  path whose removal this main process itself saw denied (`deniedRemovals`). Never an arbitrary
  renderer path, never the main worktree.
- **Auto Merge:** result gains `worktreeRemoveDenied`; the dialog runs the sudo flow, then the safe
  branch delete, and reports as if cleanup had succeeded.
- Not offered on Windows (no sudo; ACL problems there look different).

## Rejected alternatives

- `pkexec` / polkit dialog — app would never see the password (nicer), but the user explicitly asked
  for a sudo password prompt, and polkit agents are not present on every desktop/WM.
- `sudo rm -rf <path>` — deletes as root with no git checks; one wrong path is catastrophic.
- `sudo git worktree remove` — runs git as root against the user's repo and leaves root-owned
  admin files behind.

## What changed

- `src/main/elevate.ts` — `sudoChown`, `sudoFailure` (stderr classifier).
- `src/main/git/worktrees.ts` — `PERMISSION_DENIED` mapping, `deniedRemovals`, `removeWorktreeElevated`.
- `src/main/handlers/worktrees.ts`, `src/shared/ipc.ts`, `src/renderer/src/lib/api.ts` — `worktree:removeElevated`.
- `src/main/autoMerge.ts`, `src/shared/types.ts` — `worktreeRemoveDenied`, new error codes.
- `src/renderer/src/stores/dialogs.ts`, `features/dialogs/DialogHost.tsx` — password/message/error prompt options.
- `features/worktrees/worktreeFlows.ts` — `removeWorktreeWithSudo`, used by Remove and Merge cleanup.
- `features/worktrees/AutoMergeDialog.tsx` — sudo cleanup after a denied removal.

## Evidence

- `npm run typecheck && npm run lint && npm test` — 35 files, 328 tests pass.
- Integration test reproduces the denial without root (read-only subdirectory), checks
  `PERMISSION_DENIED`, then elevated removal with a fake chown deletes the leftover.

## Corrections

- First assumption: after the denial the worktree is still registered, so retrying
  `git worktree remove` is enough. Wrong: git drops `.git/worktrees/<id>` even when deleting the
  work tree fails, leaving an unregistered, partially deleted directory. Hence `deniedRemovals` and
  the delete + `git worktree prune` path for leftovers.

## Deliberately not done

- No e2e test: it would need a real sudo password. Real sudo was not exercised in tests (a wrong
  password attempt counts toward faillock); `sudoFailure` is unit-tested on sudo's C-locale messages.
- `deniedRemovals` is in-memory: after an app restart a leftover directory is no longer accepted by
  the elevated path (the user deletes it by hand).
- A parent directory not writable by the user is not handled (chown targets the worktree only).

## How to verify

1. `mkdir -p <wt>/build && sudo touch <wt>/build/x` in a clean linked worktree.
2. Auto Merge it (or Remove): a "Permission denied" password dialog appears.
3. Wrong password → "Wrong password, try again."; right one → worktree removed, branch deleted.
4. `npx vitest run tests/integration/worktrees.test.ts tests/unit/elevate.test.ts`.
