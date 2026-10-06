# Remotes view: friendly management of repository remotes

- **Date:** 2026-10-06
- **Branch:** `feat/remote-management`
- **Status:** done

## Context

Request: "manage the repository origins, easy to use and user friendly". M7 already shipped a
"Manage Remotes" dialog (Git menu only): one row per remote with five ghost buttons, edits through
the generic `prompt()` (no validation, no feedback), no way to set or clear a push URL from the UI,
no way to check a URL works, and passwords in URLs shown in clear. It was hard to find and gave no
guidance to someone who does not already know git's remote model.

## Decisions

- **Dedicated "Remotes" tool window** (cloud icon in the stripe, after Worktrees) instead of a
  modal: discoverable, stays open while fetching, room for context. Git menu "Manage Remotes…"
  and the remote-branch context menu open it; Git menu also gets "Add Remote…".
- **One card per remote**: name, provider badge (GitHub / GitLab / Bitbucket / Codeberg / Azure
  DevOps), protocol badge (orange when HTTP, git:// or a URL with a password), "tracked by current
  branch", fetch + push URL (push only when different), remote-branch count and how many local
  branches track it. Fetch / Open in browser / Edit inline; the rest in a ⋯ menu and the context
  menu (same action list): Test Connection, Copy URL, Switch to SSH/HTTPS, Prune Stale Branches,
  Remove. Double-click = edit. `origin` sorted first.
- **One Add/Edit dialog** (`RemoteDialog`): URL first (what people have in their clipboard), then
  name. Live hints under the URL ("GitHub · SSH · owner/repo", or warnings for non-git text,
  passwords, http, git://). Name validated live (git's ref rules + duplicate check) so the Save
  button is disabled before git is ever called. Name is suggested (origin → upstream → URL owner)
  until the user types one. Optional separate push URL; "Fetch its branches after adding" (on by
  default). Git errors are shown inside the dialog with stderr, not as a toast that hides the form.
- **Test Connection** = `git ls-remote --symref -- <url>`: reports branch / tag counts and the
  default branch, changes nothing, cancellable, 30 s timeout (SSH may otherwise wait on a host-key
  prompt). `--` makes an option-looking URL a path (verified: `fatal: strange pathname
  '--upload-pack=x' blocked`).
- **`remote:update`** applies rename + fetch URL + push URL in one IPC call and only runs what
  changed; pushUrl `null` (or equal to the fetch URL) unsets `remote.<n>.pushurl`
  (`config --unset-all`, exit 5 tolerated).
- **Redaction**: `https://user:token@…` is displayed as `user:•••@`; Copy URL still copies the
  real value (it is the user's own config). Open in browser builds the web URL without credentials.
- **Switch to SSH/HTTPS** only for well-known providers, where both URL forms are predictable.
  The push URL follows only when it was the same as the fetch URL.
- Tag "Push / Delete on Remote" with several remotes now uses a button chooser instead of a free
  text prompt.

## Rejected alternatives

- Keep improving the modal — too cramped for the per-remote context, and modal blocks the log.
- Derive web URLs for unknown SSH hosts (self-hosted GitLab often matches) — guesses wrong too
  often (ssh-only hostnames, ports); only https hosts and known providers get "Open".
- Validating names via an IPC `check-ref-format` round trip on every keystroke — local rules cover
  the practical cases; git stays authoritative on save.
- Rejecting URLs containing spaces outright — local folder paths legitimately contain spaces (see
  Corrections).

## What changed

- `src/shared/remotes.ts` (new): `parseRemoteUrl`, `redactUrl`, `urlHint`, `remoteNameError`,
  `suggestRemoteName`, `PROTOCOL_LABEL`.
- `src/main/git/tagsRemotes.ts`: `addRemote(…, pushUrl)`, `unsetPushUrl`, `updateRemote`,
  `parseLsRemote`, `testRemoteUrl`.
- `src/shared/types.ts`: `RemoteUpdate`, `RemoteTestResult`. `src/shared/ipc.ts`: `remote:add`
  takes `pushUrl`; new `remote:update`, `remote:test`. Handlers in `src/main/handlers/m7.ts`, API in
  `src/renderer/src/lib/api.ts`.
- `src/renderer/src/features/remotes/` (new): `RemotesView.tsx`, `RemoteDialog.tsx`,
  `remoteFlows.ts`.
- Wiring: `RepoView.tsx` (stripe + view), `modals.ts` (`remotes` → `remote` with optional
  `remote` to edit), `ModalHost.tsx`, `views.ts` (`showRemotes`), `BranchMenu.tsx`,
  `M7Dialogs.tsx` (old `RemotesDialog` removed, menu entries, `pickRemote` chooser).

## Evidence

- `tests/unit/remotes.test.ts` (9): URL parsing (scp/ssh:///https/Azure/local/file/garbage),
  redaction, hints, name rules, suggestions.
- `tests/integration/m7.test.ts` (+2): add with push URL (and no pushurl written when equal),
  update rename/URL/push set+unset, unknown remote, rename collision; `testRemoteUrl` on empty and
  populated bare repos (branches 2, tags 1, default `trunk`), missing repo → `GIT_FAILED`,
  option-like URL rejected, repository unchanged.
- `e2e/remotes.spec.ts`: empty state → add with hint + connection test → card with fetched branch
  → duplicate name blocked → edit to GitHub SSH + push URL → Switch to HTTPS → Remove (confirmed).
- `npm run typecheck`, `npm run lint`, `npx vitest run` (all green).

## Corrections

- First version warned "URLs cannot contain spaces" and disabled Save for any whitespace; that
  blocks valid local paths like `/home/me/My Repos/x.git`. Now only non-local URLs are warned and
  nothing is hard-blocked (git decides).

## Deliberately not done

- `remote.pushDefault` / per-branch push remote selection.
- Multiple fetch or push URLs per remote (only the first is shown/edited; `set-url` semantics).
- Fetch refspec / `tagOpt` / mirror settings editing.
- Credential management (stored passwords are only flagged, not migrated).

## How to verify

```bash
rtk npx vitest run tests/unit/remotes.test.ts tests/integration/m7.test.ts
rtk npx electron-vite build && E2E_NO_SANDBOX=1 rtk npx playwright test e2e/remotes.spec.ts
```

In the app: open a repo → cloud icon in the left stripe → Add Remote…, paste a URL, Test
Connection, Add. Edit with the pencil, ⋯ for Switch to SSH/HTTPS, Prune, Remove.
