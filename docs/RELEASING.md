# Releasing and testing the installers

## Publishing a release

1. Bump the version and tag it: `npm version 0.2.0` (commits `package.json` and creates `v0.2.0`).
2. Push the commit and the tag: `git push --follow-tags`.
3. `.github/workflows/release.yml` checks that the tag matches `package.json`, creates a draft release,
   builds Linux x64 (deb, AppImage, tar.gz), Windows x64 (NSIS) and — best effort — Linux arm64,
   uploads everything under the stable names above (plus electron-updater metadata), generates
   `SHA256SUMS`, then publishes the release (tags with a `-`, e.g. `v0.2.0-beta.1`, become
   pre-releases so `/releases/latest` keeps pointing at a stable one).

The repository needs "Read and write" workflow permissions (Settings → Actions → General) for
`GITHUB_TOKEN` to create releases. The Windows installer is not code-signed (SmartScreen will warn).

## Testing the one-liners before publishing

Do this after the first release exists (a draft is not enough: `/releases/latest` ignores drafts).

**Ubuntu 22.04 and 24.04 in Docker** (installs and checks the package; no GUI):

```bash
docker run --rm -it ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates sudo >/dev/null && curl -fsSL https://raw.githubusercontent.com/phil288/git-client/main/install.sh | bash && dpkg -s gitclient | grep -E "^(Status|Version)" && test -x /usr/bin/gitclient && echo OK'
```

Repeat with `ubuntu:22.04`, and with `| bash -s -- --user` (as a non-root user:
`useradd -m u && su - u -c '…'`) to exercise the tar.gz path, `--version v…`, and `--uninstall`.

**Ubuntu desktop VM** (to see the app and the sandbox handling): a fresh 24.04 VM (e.g.
`multipass launch 24.04 --name gc` + a desktop, or a VirtualBox/GNOME Boxes VM), run the one-liner,
start GitClient from the menu, then run it again to test the upgrade path; try `--user` too and
check the AppArmor hint.

**Windows 11**: use Windows Sandbox (Windows Features → "Windows Sandbox", fresh every time) or a VM.
Open PowerShell (5.1 is the default there) and run the `irm … | iex` line; check the Start menu,
`gitclient` in a *new* terminal, the Explorer entry, then `$env:GITCLIENT_UNINSTALL = '1'` and the
one-liner again. Install Git with `winget install --id Git.Git -e` first, or verify the warning.

Everything in the scripts can also be pointed at a mirror: `GITCLIENT_RELEASES_URL` accepts
`file://` URLs, which is how `tests/integration/installScript.test.ts` tests `install.sh` offline.
