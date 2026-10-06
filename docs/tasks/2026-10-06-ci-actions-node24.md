# CI: actions off Node 20, runner image pinned

- **Date:** 2026-10-06
- **Branch:** `fix/ci-actions-node24`
- **Status:** done

## Context

The Pages `deploy` job reported two annotations:

- warning: Node.js 20 is deprecated; `actions/checkout@v4`, `configure-pages@v5`,
  `deploy-pages@v4`, `upload-pages-artifact@v3` (and `upload-artifact@v4`, `setup-node@v4` used in
  ci/release) target Node 20 and are being forced onto Node 24.
- notice: `ubuntu-latest` migrates to Ubuntu 26 from 2026-10-19 (actions/runner-images#14748).

## Decisions

- Bump every first-party action to its latest major (all run on node24): `checkout@v7`,
  `setup-node@v7`, `upload-artifact@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`,
  `deploy-pages@v5`.
- Pin `ubuntu-latest` → `ubuntu-24.04` in ci, pages and release: the OS jump to 26 becomes a
  deliberate, tested change instead of a silent one (system libs for Electron/AppImage, xvfb,
  openbox, shellcheck all come from the image).

## Rejected alternatives

- Only the minimum Node-24 majors (checkout@v5 etc.) — no benefit over latest; same breaking notes.
- Leaving `ubuntu-latest` — notice is harmless, but a mid-release image change could break e2e or
  packaging with no code change on our side.

## What changed

`.github/workflows/ci.yml`, `pages.yml`, `release.yml`: action versions + `runs-on` labels.

Breaking notes checked against our usage:

- setup-node v5+: auto npm caching when `packageManager` is set — we already pass `cache: npm`.
- upload-pages-artifact v4+: excludes dotfiles — `_site` has none.
- upload-artifact v6+: needs runner ≥ 2.327.1 — GitHub-hosted runners only.

## Deliberately not done

- `windows-latest` left unpinned (no migration notice).
- Move to Ubuntu 26: separate task once tested.

## How to verify

Push the branch: CI and (after merge) the Pages deploy run with no Node 20 warning and no
ubuntu-latest notice.
