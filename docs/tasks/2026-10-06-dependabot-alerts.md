# Fix open Dependabot security alerts

- **Date:** 2026-10-06
- **Branch:** `fix/security-alerts`
- **Status:** done

## Context

GitHub listed 8 open Dependabot alerts, all transitive npm deps in `package-lock.json`:

| Alert | Package | Severity | Pulled in by | Runtime? |
| --- | --- | --- | --- | --- |
| #1–#4, #7 | dompurify 3.4.8 | low/medium (XSS edge cases) | `monaco-editor@0.56.0` (exact pin) | yes, renderer |
| #6 | source-map-js 1.2.1 | high (DoS) | tailwind / postcss | build only |
| #5 | http-cache-semantics 4.2.0 | high | electron-builder → `@electron/get` → got → cacheable-request | build only |
| #8 | sprintf-js 1.1.3 | medium (DoS) | electron-builder → `@electron/get` → global-agent → roarr | build only |

Code scanning has no analysis configured; secret scanning is disabled — nothing to fix there.

## Decisions

- `overrides` in `package.json`: `dompurify ^3.4.16`, `http-cache-semantics ^4.3.0`. Monaco pins
  DOMPurify exactly, so an override is the only way to move it; patch-level within 3.4.x.
- http-cache-semantics 4.3.0 is outside the advisory range (`<= 4.2.0`) even though the advisory
  lists no "first patched" version; cacheable-request accepts `^4.0.0`.
- source-map-js: plain `npm update` to 1.2.2 (lockfile only, ranges already allow it).

## Rejected alternatives

- Bump `monaco-editor` to 0.57.0 — still pins vulnerable dompurify 3.4.15, so it would not close
  the alerts and adds editor-upgrade risk.
- `npm audit fix --force` — downgrades electron-builder to an old major.

## What changed

`package.json` (`overrides`), `package-lock.json`.

## Evidence

- `npm audit`: only remaining finding is sprintf-js (8 moderate entries, all the same root).
- `npm run typecheck`, `npm run lint`, `npm test` (266 passed), `npm run build` green.
- e2e (Monaco-touching): ai-commit, commit, conflicts, worktree-conflicts, smoke — 11 passed.

## Corrections

None.

## Deliberately not done

- **sprintf-js (#8)**: no patched release exists (1.1.3 is latest). Only reached from electron-builder's
  Electron download path at build time, with no attacker-controlled format strings. Remains open;
  dismiss as "tolerable risk" on GitHub or wait for an upstream fix / electron-builder dropping roarr.

## How to verify

```bash
npm ci
npm ls dompurify source-map-js http-cache-semantics
npm audit
```

Expect dompurify 3.4.16, source-map-js 1.2.2, http-cache-semantics 4.3.0; audit shows only sprintf-js.
