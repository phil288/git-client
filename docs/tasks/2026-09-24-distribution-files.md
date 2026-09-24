# Distribution files: CI, release workflow, install.ps1, NSIS include

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold`
- **Status:** done (files written and validated offline); needs a real tag push and a Windows machine for end-to-end proof

## Context

Milestone 10 distribution. `install.sh` already exists and depends on stable release asset names plus a
`SHA256SUMS` asset, but nothing published them yet. This task adds:

- `.github/workflows/ci.yml`: checks on every push and PR (Linux + Windows).
- `.github/workflows/release.yml`: on `v*` tags, builds and uploads the installers, then `SHA256SUMS`.
- `install.ps1`: Windows version of `install.sh` (`irm … | iex`).
- `build/installer.nsh`: electron-builder NSIS hooks for the per-user PATH and the Explorer menu entry.

## Decisions

- **CI: two jobs, `concurrency` cancels superseded runs, `permissions: contents: read`.**
  - Linux runs typecheck, lint, Vitest, `shellcheck install.sh` and `xvfb-run -a npm run test:e2e` with
    `E2E_NO_SANDBOX=1`. Playwright traces are uploaded when the job fails.
  - Windows runs typecheck and Vitest (unit and integration tests catch path and CRLF problems). It sets
    `core.autocrlf false` before checkout, because the runner image sets it to `true` globally, and that
    would also change the git repositories the integration tests create.
  - `install.ps1` is checked three ways on Windows. The script is parsed with the **Windows PowerShell
    5.1** parser, which rejects `??`, ternaries and `&&`, and with the PowerShell 7 parser. `-Help` is run
    under both editions (no network). `Invoke-ScriptAnalyzer -Severity Error` fails the job on errors.
- **Release: a draft first, then publish.** `verify-version` checks that the tag equals `v` +
  `package.json` version. `create-release` runs `gh release create --draft --verify-tag
  --generate-notes`. The build jobs run `electron-builder --publish always` with the GitHub provider
  given on the command line (`-c.publish.provider=github -c.publish.owner=… -c.publish.repo=…
  -c.publish.releaseType=release`), so `electron-builder.yml` keeps `publish: null` and needs no
  placeholder. When a draft with the tag exists, electron-builder uploads into it (checked in
  `electron-publish/out/gitHubPublisher.js`: `getOrCreateRelease` returns an existing draft). The
  `checksums` job builds `SHA256SUMS` and uploads it, then publishes the release (`--latest`, or
  `--prerelease` for tags that contain `-`). This avoids three problems:
  1. Parallel jobs racing to create duplicate releases (electron-builder lists releases, then creates one).
  2. A public "latest" release without `SHA256SUMS`, which would make both installers fail the checksum
     check in the minutes between upload and checksum job.
  3. A half-published release when the Windows build fails. The release then stays a draft.
- **electron-updater metadata is untouched.** electron-builder still uploads `latest.yml`,
  `latest-linux*.yml` and `*.blockmap`. The checksum job downloads only `*.deb`, `*.AppImage`,
  `*.tar.gz` and `*-setup.exe`, so metadata and an older `SHA256SUMS` are never hashed. The job also
  fails if any of the four x64 assets is missing.
- **`SHA256SUMS` format:** `sha256sum` output (`<hash>  <name>`), sorted with `LC_ALL=C`. This is the
  format both installers parse (`install.sh` awk; `install.ps1` splits on whitespace and strips a leading
  `*`).
- **Linux arm64 is best effort.** It is cross-built on `ubuntu-latest` with `continue-on-error: true`,
  and the deb/AppImage names are overridden on the command line. The `checksums` job runs if
  `needs.build.result == 'success'`, whatever the arm64 result.
- **Release builds run under bash on Windows.** PowerShell splits native arguments like
  `-c.publish.owner=x` at the dots.
- **`EP_GH_IGNORE_TIME=true`** lets a re-run upload to a release published more than 2 h ago.
  electron-builder refuses that by default.
- **install.ps1**
  - All logic is in `Install-GitClient`, called on the last line.
  - A script-level `param()` (`-Version`, `-Uninstall`, `-Quiet`, `-Help`) is forwarded into the
    function. Environment variables cover `irm | iex`: `GITCLIENT_VERSION`, `GITCLIENT_UNINSTALL=1`,
    `GITCLIENT_QUIET=1`, `GITHUB_TOKEN`, `GITCLIENT_REPO`, `GITCLIENT_RELEASES_URL`,
    `GITCLIENT_API_URL` and `NO_COLOR`.
  - `$DefaultRepo = '<OWNER>/<REPO>'` uses the same literal form as `install.sh`.
  - Compatible with PowerShell 5.1 and 7:
    - TLS 1.2 is forced on 5.1.
    - `-UseBasicParsing` and `-UserAgent` replace a `User-Agent` header.
    - `$ProgressPreference` is set to `SilentlyContinue`, because the 5.1 progress bar slows downloads.
    - `Set-StrictMode -Off` is set inside the function, so a caller's strict mode cannot break it.
    - The script is ASCII only, because 5.1 reads BOM-less files as ANSI.
  - **No `exit` under `irm | iex`,** because it would close the user's window. Errors are printed and
    `$LASTEXITCODE` is set to 1. `exit 1` is used only when the script runs as a file (`$PSCommandPath`
    set).
  - Private repositories are resolved with the API (`Invoke-RestMethod`, `releases/tags/<tag>` or
    `releases/latest`), then downloaded with `Accept: application/octet-stream`. Both editions drop the
    `Authorization` header on the redirect to the signed URL.
  - `file://` release URLs are copied directly, for testing against a mirror, as in `install.sh`.
  - Install: download the setup exe and `SHA256SUMS`, check with `Get-FileHash`, run `Start-Process
    /S -Wait`, then read `DisplayVersion` from the HKCU uninstall key and print how to launch (Start menu,
    or `gitclient` in a new terminal). Warns if Git for Windows is missing and suggests
    `winget install --id Git.Git -e`.
  - Uninstall: uses `QuietUninstallString` (or `UninstallString`) from the HKCU uninstall key, adds
    `/currentuser /S` if missing, waits, and then polls for up to 60 s until the key disappears.
    The NSIS uninstaller starts a copy of itself from %TEMP%. `Start-Process -Wait` waits for child
    processes, and the poll covers the rest. The settings folder `%APPDATA%\GitClient` is kept and
    reported.
- **installer.nsh**
  - `customInstall` adds `$INSTDIR` to `HKCU\Environment\Path` (`WriteRegExpandStr`) if it is not there
    already. It also writes `HKCU\Software\Classes\Directory[\Background]\shell\GitClient` with the command
    `"$INSTDIR\gitclient.exe" "%V"` and the exe as the icon.
  - `customUnInstall` removes both.
  - Only built-in instructions are used, plus LogicLib and WinMessages. The PATH entry is found with a
    character loop, not `StrContains.nsh`. That file has no include guard, and the assisted installer
    also includes it.
  - **PATH safety:** if `Path` exists but cannot be read in full (longer than `NSIS_MAX_STRLEN`), or would
    grow beyond it, the include only prints a `DetailPrint` and does not touch it. Otherwise a truncated
    read would be written back and destroy the user's PATH. It tells "absent" from "too long" by listing
    the values with `EnumRegValue`. Matching ignores case and a trailing `\`. When it adds the entry, it
    appends to the original string, so the rest of PATH is left unchanged byte for byte.
  - **Upgrades:** electron-builder runs the old uninstaller with `--updated` (`installUtil.nsh`,
    `uninstallOldVersion`). `customUnInstall` therefore does nothing when `${isUpdated}` is set. On an
    electron-updater upgrade, `customInstall` does not re-create the Explorer entry, so turning it off in
    Settings survives auto-updates.
  - **`-WX`:** electron-builder compiles with warnings as errors, and an unreferenced function is a
    warning. Installer functions and `un.` functions are therefore guarded by `BUILD_UNINSTALLER`. The
    uninstaller is compiled in its own pass, in which only `customUnInstall` is inserted.

## Rejected alternatives

- **Let each build job create the release (as the spec first said).** This risks duplicate releases and a
  public release with no `SHA256SUMS`. See the "draft first" decision.
- **Setting `publish:` in `electron-builder.yml`.** It would need the `<OWNER>/<REPO>` placeholder filled
  in, and local `dist:*` builds would pick it up. Command-line `-c.publish.*` overrides do the job; they
  were checked to merge over `publish: null`.
- **Third-party NSIS plugins (EnVar and similar).** Not bundled with electron-builder.
- **`StrContains.nsh`.** It has no include guard, and electron-builder's assisted installer
  (`oneClick: false`) also includes it, so switching installer modes would cause a duplicate definition.
  It also only does a substring match, which would give a false positive for `…\gitclient-old`.
- **A native `ubuntu-24.04-arm` runner for arm64.** It would be more reliable, but the task asked for a
  cross-build. It is a one-line change later: `runs-on: ubuntu-24.04-arm`, free for public repos.
- **Downloading actionlint or pwsh for local checks.** They were not installed, and nothing was
  downloaded for them (see Evidence).

## What changed

- `.github/workflows/ci.yml` (new)
- `.github/workflows/release.yml` (new)
- `install.ps1` (new)
- `build/installer.nsh` (new; electron-builder picks it up automatically from `buildResources`)

`docs/tasks/README.md` is not edited by this task. The index row is added separately.

## Evidence

- **YAML:** both workflows parse with `js-yaml` from `node_modules`. Every bash `run:` block was
  extracted, with `${{ }}` replaced, and checked with `bash -n`: no errors.
- **CLI overrides:** `configureBuildCommand(createYargs())`, then `normalizeOptions`, then app-builder-lib
  `getConfig` on the real `electron-builder.yml`. With the arm64 command line, the merged config has
  `publish = {provider: github, owner, repo, releaseType: release}`, `deb.artifactName =
  gitclient-linux-arm64.deb` and `appImage.artifactName = gitclient-linux-arm64.AppImage`.
- **SHA256SUMS:** the generation pipeline was run on dummy files. The output was sorted `hash  name`
  lines, and `install.sh`'s awk lookup returned the right hash.
- **NSIS:** electron-builder's own toolchain was fetched into `~/.cache/electron-builder` (`nsis-3.0.4.1`
  and `nsis-resources-3.4.1`; checksum-verified by electron-builder, the default toolset in 26.x). A
  harness used electron-builder's `NsisScriptGenerator` to emit the real header (StdUtils include and
  the `isUpdated`/… flag macros), then `!include`d `build/installer.nsh`. It inserted `customInstall` in
  an install section and `customUnInstall` in an `un.` section, like `installSection.nsh` and
  `uninstaller.nsh`. `makensis -WX` compiled both passes (installer, and uninstaller with
  `-DBUILD_UNINSTALLER`) with **exit 0 and no warnings**.
- **install.ps1:** `pwsh` is not available here, so it was checked by review and grep: ASCII only, no
  `??`, `&&`, `||` or ternary. CI parses it with both PowerShell parsers and runs PSScriptAnalyzer.

## Corrections

- Initial assumption: `/S` alone is enough for the uninstall wait. In fact the NSIS uninstaller re-launches
  itself from %TEMP% unless `_?=` is given, so the script also polls for the uninstall key to disappear.
- Initial assumption: a `User-Agent` entry in `-Headers` works everywhere. Windows PowerShell 5.1 treats
  it as a restricted header. The script uses `-UserAgent` instead.

## Deliberately not done

- **No end-to-end run.** Nothing has been tested on real Windows: the NSIS PATH/registry code at runtime,
  `install.ps1` install/upgrade/uninstall, and PSScriptAnalyzer results. The first CI run and the first
  tag push are the real test.
- **No `-Purge` for `install.ps1`** (`install.sh` has `--purge`). Uninstall reports the settings folder
  so the user can delete it.
- **No Explorer opt-out marker.** A non-updater reinstall (for example re-running `install.ps1`)
  re-creates the Explorer entry even if it was turned off in Settings. A fix would need the app to write
  an opt-out value that the installer reads.
- **No code signing.** SmartScreen will warn on the unsigned setup exe.
- **No Vitest test for `install.ps1`'s `$DefaultRepo`.** It is written in the same literal form, so the
  existing `installScript.test.ts` check can be extended.

## How to verify

1. Push a branch: the **CI** workflow runs `linux` and `windows`. Both should pass. The Windows job
   prints the `install.ps1 -Help` text twice (5.1 and 7) and `PSScriptAnalyzer: no errors`.
2. Push a tag that does not match: `git tag v9.9.9 && git push origin v9.9.9`. `verify-version` fails
   with "Tag v9.9.9 does not match package.json version …". Delete the tag afterwards.
3. `npm version <x.y.z>`, then `git push --follow-tags`. The Release workflow creates a draft, the
   builds upload into it, and `checksums` uploads `SHA256SUMS` and publishes. The release should list
   `gitclient-linux-x64.{deb,AppImage,tar.gz}`, `gitclient-windows-x64-setup.exe`, `latest.yml`,
   `latest-linux.yml`, the blockmaps and `SHA256SUMS`. arm64 assets appear if that job succeeded.
4. On Windows: `irm https://raw.githubusercontent.com/<OWNER>/<REPO>/main/install.ps1 | iex`. It should
   print "Checksum verified" and "OK GitClient x.y.z installed". A new terminal can then run
   `gitclient`, and right-clicking a folder shows "Open in GitClient".
5. `$env:GITCLIENT_UNINSTALL='1'; irm … | iex` removes it, including the PATH entry and the Explorer
   entry. Check with `(Get-ItemProperty HKCU:\Environment).Path`.
