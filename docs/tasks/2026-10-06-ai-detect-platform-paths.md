# AI CLI detection: target-platform path rules

Date: 2026-10-06 · Status: done

## Context
CI run 37505626462 failed on the Windows job only: `tests/unit/aiPrompt.test.ts` >
"finds cursor under either binary name and honours overrides" got `null` instead of
`/home/u/.local/bin/cursor-agent`. `src/main/ai/detect.ts` takes a `platform` argument but
used the host's `node:path` `join`/`delimiter`, so on a Windows host a `linux` lookup built
`\home\u\.local\bin\cursor-agent` and never matched.

## Decisions
- `searchDirs`/`resolveBinary` pick `path.win32` or `path.posix` from the `platform` argument
  (`pathFor`). Runtime behaviour is unchanged (platform defaults to the host); the function is
  now honest about the platform it is asked to model.
- The win32 test built its expected paths with host `join`; switched to `win32.join` so it
  passes on Linux too.
- Rejected: loosening the test (normalising slashes) — it would hide the same bug in code.

## Verify
`npx vitest run tests/unit/aiPrompt.test.ts`, `npm run typecheck && npm run lint && npm test`
(all green locally on Linux); Windows CI job on the PR.

## Left undone
Not verified on a Windows host locally; relies on CI.
