# Fix open Dependabot alerts (vite, vitest, electron, dompurify, transitive)

- **Date:** 2026-10-27
- **Branch:** `fix/dependabot-vulns`
- **Status:** done

## Context

GitHub listed 7 open Dependabot alerts (#9–#15), all dev-scope:

| Alert | Package | Severity | Relationship | Fixed in |
| --- | --- | --- | --- | --- |
| #9–#11, #14, #15 | vite 7.3.6 (incl. bundled launch-editor advisories) | low → high | direct | 7.3.7 |
| #12, #13 | @vitest/mocker 5.0.1 | medium | via vitest | 5.0.3 |

`npm audit` reported more than GitHub had indexed yet (9 total: 2 critical, 4 high, 3 moderate):

| Package | Severity | Pulled in by | Runtime? |
| --- | --- | --- | --- |
| dompurify 3.4.16 | critical | `monaco-editor@0.56.0` (exact pin, already overridden) | yes, renderer |
| electron 44.4.5 | high | direct | yes, the app itself |
| undici 6.28.1 / 7.29.1 | high | node-gyp, `@electron/get` | build only |
| zod 4.6.5 | high | eslint-plugin-react-hooks | lint only |
| fast-uri 3.1.8 | moderate | electron-builder → ajv | build only |

Fixed all of them, not only the GitHub-listed ones, since they would surface as alerts next.

## Decisions

- Raise direct ranges: `electron ^44.9.3`, `vite ^7.3.7`, `vitest ^5.0.5` (pulls `@vitest/mocker` 5.0.5).
  All patch/minor within the current major.
- Raise the existing `dompurify` override to `^3.4.17` (Monaco still pins exactly; see
  [2026-10-06 record](2026-10-06-dependabot-alerts.md) for why the override exists).
- undici, zod, fast-uri: `npm audit fix` (lockfile only; parent ranges already allow the patched versions).

## Rejected alternatives

- `npm audit fix --force` — it proposes downgrading `monaco-editor` to 0.55.1, a breaking change, to
  shed the vulnerable DOMPurify. The override does the same job without touching Monaco.
- Bumping `monaco-editor` to 0.57.0 — not needed for the fix; adds editor-upgrade risk.

## What changed

`package.json` (three dev ranges + `overrides.dompurify`), `package-lock.json`.

## Evidence

- `npm audit`: `found 0 vulnerabilities`.
- `npm ls`: vite 7.3.7, vitest/@vitest/mocker 5.0.5, electron 44.9.3, dompurify 3.4.17,
  undici 6.29.1 / 7.30.1, zod 4.6.7, fast-uri 3.1.9.
- `npm run typecheck`, `npm run lint`, `npm test` (303 passed), `npm run build` green.
- e2e (Electron runtime + Monaco-touching): smoke, commit, conflicts, worktree-conflicts, ai-commit — 13 passed.

## Corrections

None.

## Deliberately not done

- sprintf-js (left open in the 2026-10-06 record) no longer appears in `npm audit`; nothing to do.
- Dependabot alerts close automatically once the branch merges to `main`; not dismissed manually.

## How to verify

```bash
npm ci
npm audit
npm ls vite vitest @vitest/mocker electron dompurify undici zod fast-uri
```

Expect 0 vulnerabilities and the versions listed under Evidence.
