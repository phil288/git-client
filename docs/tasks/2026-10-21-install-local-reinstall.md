# install.sh silently kept the old app when reinstalling a local build

- **Date:** 2026-10-21
- **Branch:** `fix/install-local-reinstall`
- **Status:** done

## Context

After adding "Open Terminal in Repository", `bash install.sh` from the clone finished with
"GitClient 0.1.0 installed", yet the running app had no new menu item.
`/opt/GitClient/resources/app.asar` was still dated 22:10, before the feature commit, while
`dist/gitclient-linux-x64.deb` (rebuilt later) contained the new strings.

Cause: a local build keeps `package.json`'s version (0.1.0). `apt-get install ./x.deb` with the
same version already installed prints "gitclient is already the newest version (0.1.0)" and
installs nothing; the script then reported success from `dpkg-query`.

## Decisions

- Pass `--reinstall` to apt-get when installing a local build (`source=local`). A local build is by
  definition "the code in this checkout now", so same-version replacement is the intent.

## Rejected alternatives

- `--reinstall` for remote installs too — a published version is immutable, so re-running for the
  same release should stay a no-op.
- Stamping a unique version into local builds (e.g. `0.1.0+local.<sha>`) — touches electron-builder
  config and the version shown in About; more change than the bug needs.
- `dpkg -i` instead of apt-get — loses apt's dependency resolution.

## What changed

- `install.sh` `install_deb`: adds `--reinstall` for local sources.
- `tests/integration/installScript.test.ts`: deb-mode test with stubbed `sudo`/`apt-get`/`dpkg`
  asserting `install -y --reinstall … gitclient-linux-x64.deb`.

## Evidence

- `apt-get install -s ./dist/gitclient-linux-x64.deb` → "already the newest version", 0 installed;
  with `--reinstall` → "1 reinstalled".
- New test: fails with the line removed (1 failed / 15 passed), passes with it (16/16).
- lint, typecheck clean.

## Corrections

- The earlier suggestion `sudo dpkg -i dist/…deb` would have worked (dpkg reinstalls same versions),
  but `install.sh` — the documented path — did not.

## Deliberately not done

- No real apt install in tests (needs root). `--user` mode was unaffected: it overwrites
  `~/.local/share/gitclient` unconditionally.

## How to verify

```bash
npx vitest run tests/integration/installScript.test.ts
bash install.sh            # from the clone, in a normal terminal (needs sudo)
ls -l /opt/GitClient/resources/app.asar   # timestamp = now
```
