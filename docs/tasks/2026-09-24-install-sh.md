# Linux one-line installer (install.sh)

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold`
- **Status:** done (script + tests); depends on the milestone 10 release workflow for real assets

## Context

User asked for `install.sh` ahead of milestone 10, to the spec in section 11: `curl … | bash`,
`.deb` via apt by default, `--user` mode, version pinning, uninstall, SHA-256 verification.

## Decisions

- **Whole script inside `main()`, `main "$@"` on the last line**, `set -euo pipefail`.
- **Stable asset names set in `electron-builder.yml` now**, because the script depends on them.
  `${arch}` expands to `amd64` (deb) and `x86_64` (AppImage), so those targets have explicit
  `gitclient-linux-x64.*` names; `tar.gz` keeps `${arch}`. `dist:linux` builds `--x64` only;
  arm64 overrides the names on the command line (documented in the yml).
- **Mode selection:** `.deb` + apt on Debian/Ubuntu with sudo; automatic `--user` fallback on
  non-apt distros or when sudo is missing (with a notice).
- **Checksums:** `SHA256SUMS` from the same release, compared with `sha256sum`; mismatch aborts
  before anything is installed.
- **"latest" without API calls:** assets from `/releases/latest/download/`; the version for `--user`
  installs is read from the `/releases/latest` redirect and stored in `.installed-version`.
- **Private repos (`GITHUB_TOKEN`):** `/releases/latest/download` ignores tokens, so the script
  resolves the asset id via the releases API (parsed with grep; no jq) and downloads it with
  `Accept: application/octet-stream`. curl drops the auth header on the cross-host redirect.
- **Upgrade safety (`--user`):** extract to a temp dir, then swap directories; a failed download or
  checksum never touches the current install.
- **Sandbox (`--user`):** if `kernel.apparmor_restrict_unprivileged_userns=1` and neither our AppArmor
  profile nor a setuid `chrome-sandbox` exists, print the exact fix (AppArmor profile, same approach
  as the `.deb`; setuid as the alternative). Never launches or configures `--no-sandbox`.
- **apt and temp files:** apt's `_apt` user must read the local `.deb`, so the temp dir is `755` and
  the file `644`.
- **`<OWNER>/<REPO>`** is a `DEFAULT_REPO` constant (the script runs standalone, so it cannot read
  package.json); a Vitest test asserts it equals the `package.json` repository slug.
- **Test hooks:** `GITCLIENT_RELEASES_URL` / `GITCLIENT_API_URL` / `GITCLIENT_REPO` let tests (and
  mirrors) point the script elsewhere; `file://` works.

## Corrections

- The first version of the warning said the app "will not launch" whenever
  `kernel.apparmor_restrict_unprivileged_userns=1`. On this dev machine (restriction enabled,
  Electron 44) the installed `--user` build started fine, so the message now says the sandbox *may*
  fail and gives the fix to apply if it does. The detection is a heuristic, not a launch test.

## Follow-up: install from a local clone (same day)

User request: when the repository is already checked out (like the dev machine), install without
downloading.

- **Detection:** the directory of `BASH_SOURCE[0]` has `package.json` with `"name": "gitclient"` and
  `electron-builder.yml`. When piped from curl, `BASH_SOURCE[0]` is empty, so the remote path is
  unchanged.
- **Freshness:** `find <sources> -newer dist/<asset>` over `src/`, `build/`, `package.json`, the lock
  file, `electron-builder.yml` and `electron.vite.config.ts`. Missing or stale → build.
- **Build only what is installed:** `electron-builder --linux deb|tar.gz --x64` (not all three
  targets), after `npm run build`; `npm ci` first if `node_modules` is missing. Build output goes to a
  log; the last 40 lines are shown on failure. The script refuses to build as root, so the checkout
  never ends up with root-owned files (apt still gets sudo only for the install step).
- **No npm:** install the existing (possibly stale) package with a warning; if there is none, stop
  and say to install Node.js or use `--remote`.
- **Flags:** `--remote` forces a download, `--rebuild` forces a build; `--version` implies remote
  because a pinned tag only exists as a release. `--remote --rebuild` is rejected.
- **Checksum:** skipped for local builds (no release `SHA256SUMS`); said explicitly in the output.
  Version recorded as `v<package.json version>-local`.
- **Rejected:** detecting a checkout from the current directory (a `curl | bash` run inside some
  unrelated clone would silently install unreviewed local code); always building (6 minutes for all
  targets when an up-to-date package already exists).
- **Evidence:** 6 more tests (fake checkout + fake `npm` on `PATH`): up-to-date package installs
  with no npm calls and no download; stale sources → `ci`, `run build`, `exec --no -- electron-builder
  --linux tar.gz --x64 --publish never`; missing dist with `node_modules` present skips `ci`;
  `--rebuild`; `--remote`/`--version` go to the release URL; no-npm message. Total 14 pass.
  Real run in this checkout with a temp `HOME`: installed `dist/gitclient-linux-x64.tar.gz` as
  `v0.1.0-local` in ~3 s, no build, no download. shellcheck clean.

## Rejected alternatives

- **Parsing the API with jq / python:** not guaranteed on minimal systems; spec forbids jq.
- **AppImage as the `--user` payload:** needs FUSE 2, which Ubuntu 22.04+/24.04 do not ship by default.
- **Auto-applying the sandbox fix in `--user` mode:** it needs root, which `--user` promises not to use.

## Evidence

- `shellcheck -s bash install.sh` (v0.10.0): no findings.
- `tests/integration/installScript.test.ts` — 8 tests against a fake `file://` release: install
  (symlink, desktop entry, icon, version file, PATH warning), upgrade in place, checksum mismatch
  keeps the old install, missing release message, uninstall keeps settings, `--purge`, option
  validation, repo slug matches package.json, `main "$@"` last line.
- Real `npm run dist:linux` output (`gitclient-linux-x64.{deb,tar.gz,AppImage}`) published into a
  local `file://` release with a generated `SHA256SUMS`; `install.sh --user --version v0.1.0` with a
  temp `HOME` installed it, printed the PATH and sandbox notes, and the installed `gitclient`
  launched (ran until the 8 s timeout, no sandbox error).

## Deliberately not done

- `.deb` mode is not exercised by automated tests (needs root); test on fresh Ubuntu 22.04/24.04
  containers/VMs as described in milestone 10.
- No `shellcheck` npm script; CI (milestone 10) runs it.
- `install.ps1`, `release.yml` (which uploads assets + `SHA256SUMS`): milestone 10.

## How to verify

```bash
npx vitest run tests/integration/installScript.test.ts
bash install.sh --help
```
