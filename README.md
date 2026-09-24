# GitClient

A cross-platform (Ubuntu + Windows) desktop Git client modeled on the Git tooling in JetBrains IDEs:
the Log tab, Branches popup, Commit tool window, interactive rebase dialog and the 3-way merge tool.

## Install

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/<OWNER>/<REPO>/main/install.sh | bash
```

On Debian/Ubuntu this downloads the `.deb`, verifies its SHA-256 against the release's `SHA256SUMS`,
and installs it with `apt` (it asks for `sudo` and says why). apt pulls in dependencies (including
`git`), the menu entry, the `gitclient` command and the Chromium sandbox/AppArmor setup.

Options (pass after `bash -s --`):

| Option | Env var | Effect |
| --- | --- | --- |
| `--user` | | No sudo: installs into `~/.local/share/gitclient`, `~/.local/bin/gitclient` and a menu entry. Default on non-Debian distros. |
| `--version v1.2.0` | `GITCLIENT_VERSION` | Install that release instead of the latest |
| `--uninstall` | | Remove GitClient (settings in `~/.config/GitClient` are kept) |
| `--uninstall --purge` | | Also delete settings |
| `--quiet` | `GITCLIENT_QUIET=1` | Only errors and the result |
| | `GITHUB_TOKEN` | Needed if the repository is private |

```bash
curl -fsSL https://raw.githubusercontent.com/<OWNER>/<REPO>/main/install.sh | bash -s -- --user --version v0.1.0
```

**From a clone of this repository** the installer uses your local build instead of downloading:

```bash
./install.sh            # .deb from dist/ via apt
./install.sh --user     # tar.gz from dist/ into ~/.local
```

If `dist/gitclient-linux-x64.{deb,tar.gz}` is missing or older than the sources (`src/`, `build/`,
`package.json`, lock file, builder/vite config), it builds just that package first
(`npm ci` if `node_modules` is missing, `npm run build`, `electron-builder`), as your user, never as
root. `--rebuild` forces a build; `--remote` (or `--version`) downloads a release instead. Local
builds have no release `SHA256SUMS`, so that check is skipped and the version is recorded as
`v<version>-local`.

Running the installer again upgrades. On Ubuntu 23.10+/24.04 a `--user` install cannot ship the
AppArmor profile the Chromium sandbox needs; the installer detects this and prints the exact
one-line fix (it never launches with `--no-sandbox`).

### Windows

The PowerShell one-liner (`irm … | iex`) arrives with milestone 10.

### Manual download

Every release on the [Releases page](https://github.com/<OWNER>/<REPO>/releases) has stable asset names:
`gitclient-linux-x64.deb`, `gitclient-linux-x64.tar.gz`, `gitclient-linux-x64.AppImage`,
`gitclient-windows-x64-setup.exe`, plus `SHA256SUMS`. The latest is always at
`https://github.com/<OWNER>/<REPO>/releases/latest/download/<asset>`.

> The release workflow that publishes these assets (and `SHA256SUMS`) is part of milestone 10;
> until it exists, `install.sh` has nothing to download.

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| 1 | Scaffold, secure IPC, GitService + git detection + console, packaging config, welcome screen, recents/pins/groups, open/init/clone/scan, tabs, repo switcher, quick switcher, session restore, single instance + CLI | **done** |
| 2 | Log & commit graph | planned |
| 3 | Search & filters | planned |
| 4 | Branches | planned |
| 5 | History rewriting | planned |
| 6 | Local changes & commit | planned |
| 7 | Stash, file history, blame, tags, remotes | planned |
| 8 | Conflict resolution | planned |
| 9 | Polish & OS integration | planned |
| 10 | Distribution & installers | planned |

## Requirements

- **Node.js 22.12+** and npm 10+ (for development only; the packaged app bundles its own runtime)
- **git 2.30+** on `PATH` (or in a standard install location; configurable)
  - Ubuntu: `sudo apt install git`
  - Windows: `winget install --id Git.Git -e`

## Development

### Ubuntu (22.04 / 24.04)

```bash
sudo apt install git
npm install          # also downloads the Electron binary
npm run dev          # starts Electron with hot reload
```

To run the AppImage you build yourself, Ubuntu 22.04+ needs FUSE 2: `sudo apt install libfuse2` (22.04) or `libfuse2t64` (24.04).

### Windows 10/11

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
npm install
npm run dev
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite dev server with HMR for the renderer |
| `npm run build` | Production build into `out/` |
| `npm run preview` | Run the production build |
| `npm run typecheck` | `tsc` for main/preload/tests and for the renderer (strict) |
| `npm run lint` | ESLint (includes a rule that forbids `exec()` and `shell: true`) |
| `npm test` | Vitest: parsers and pure logic, plus integration tests on throwaway repos in a temp dir |
| `npm run test:e2e` | Builds, then runs Playwright smoke tests against the real Electron app |
| `npm run dist:linux` | AppImage + `.deb` + `.tar.gz` in `dist/` (run on Linux) |
| `npm run dist:win` | NSIS installer in `dist/` (run on Windows) |
| `npm run icons` | Regenerates `build/icon.png` |

E2E tests on a CI runner, or where the Chromium sandbox cannot start from `node_modules`, need
`E2E_NO_SANDBOX=1` (only the tests pass `--no-sandbox`; the app itself never does).

### Opening repositories from the command line

```bash
gitclient .                 # the packaged app (the .deb installs /usr/bin/gitclient)
gitclient ~/src/project     # a second launch opens a new tab in the running window
```

## Architecture

```
src/shared/      IPC contracts (types.ts, ipc.ts) and pure helpers (fuzzy, display, shortcuts)
src/main/        Electron main process: lifecycle, single instance, menu, IPC handlers
  git/           GitRunner (spawn, argument arrays only), GitService, parsers, git detection, command log
  repos/         recents model + service, folder scan, .git watcher (chokidar)
src/preload/     contextBridge: typed invoke/on with channel allowlists
src/renderer/    React 19 + Tailwind 4 + shadcn/ui-style components, Zustand, TanStack Query
tests/           Vitest unit + integration tests (temp repos)
e2e/             Playwright Electron smoke tests
```

- **Security:** `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP in production builds,
  IPC sender validation, channel allowlists, navigation and window.open blocked, all permissions denied.
- **Git access:** only through `GitRunner.run(args[])`, which calls `child_process.spawn(gitPath, args)`
  without a shell. ESLint fails the build on `exec`/`execSync` imports and `shell: true`.
- **Parsing:** only machine formats (`--porcelain=v2 -z`, `--format` with `%x00`/`%x1e`).
- **Git Console:** every command, its duration, exit code and stderr (View → Git Console, `Alt+9`).
- **State:** `electron-store` JSON (`gitclient-state.json` in the user data dir) with a JSON schema and
  migrations; writes are atomic (temp file + rename). An invalid file is moved aside, never deleted.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open folder/repository |
| `Ctrl+E`, `Ctrl+Shift+O` | Recent repositories (quick switcher) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Jump to tab N (`Ctrl+9` = last) |
| `Ctrl+W` | Close tab |
| `Alt+9` | Toggle Git Console |

## Placeholders to replace before publishing

`<OWNER>/<REPO>` is read from the `repository` field of `package.json`. Files containing it:

- `package.json` (`homepage`, `repository.url`) — the source of truth
- `install.sh` (`DEFAULT_REPO`, header comments) — a unit test fails if it differs from `package.json`
- `README.md` (install commands, releases link, this note)

Milestone 10 adds `install.ps1` and the workflows, which will be added to this list.

## Task records

Design decisions per task live in [`docs/tasks/`](docs/tasks/README.md).
