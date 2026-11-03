# Fix flaky AI temp-dir test on CI

- **Date:** 2026-11-03
- **Branch:** `main` (pushed directly; the user authorized this once because they were away)
- **Status:** done

## Context

CI run 41690011932 (`1d20058`) failed on Linux in `npm test`:
`tests/integration/ai.test.ts > abort kills the hanging CLI` got two new `gitclient-ai-*` dirs where
it expected one.

`ai.test.ts` checks that `runTool` cleans up its answer dir by listing `gitclient-ai-*` in
`os.tmpdir()`. Vitest runs test files in parallel, and `tests/integration/autoMerge.test.ts:133` also
runs codex, so `runTool` creates real `gitclient-ai-*` dirs in the same shared temp root at the same
time. A test bug, not an app bug: the extra dir belonged to another test file.

## Decisions

- Point `TMPDIR`/`TMP`/`TEMP` at a private dir under the test's own root in `ai.test.ts`. `os.tmpdir()`
  reads them on each call (POSIX uses `TMPDIR`, Windows `TEMP`/`TMP`), and `pool: 'forks'` keeps the
  change inside this file's process. The assertions stay as strict as they were.

## Rejected alternatives

- Disable file parallelism — slows every run to fix one file.
- Retry the test — hides the race, and a real leak could slip through.
- Make the temp prefix injectable in `runTool` — production change for a test-only problem.
- Change `autoMerge.test.ts` — fixes one collider only; any future codex test would bring it back.

## What changed

- `tests/integration/ai.test.ts`: private temp root.

## Evidence

- Before the fix, with a loop creating `gitclient-ai-*` dirs in the same `TMPDIR`: 3 of 12 tests in
  `ai.test.ts` failed, including the CI assertion (`to have a length of 1 but got 2`).
- See "How to verify" for the same check after the fix.

## Corrections

None.

## Deliberately not done

- No change to `runTool` or `autoMerge.test.ts`.
- Other tests in the file were not audited for shared state beyond the temp-dir count.

## How to verify

Run a loop creating `gitclient-ai-*` dirs in a private `TMPDIR` while running
`TMPDIR=<dir> npx vitest run tests/integration/ai.test.ts`: all 12 tests pass. Then
`npm run typecheck && npm run lint && npm test`.
