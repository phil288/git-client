# Operation banner flicker (CI merge-conflict e2e failure)

- **Date:** 2026-10-01
- **Branch:** `fix/ci-merge-banner`
- **Status:** done

## Context

CI on `main` @ `cc60987` failed in the Linux e2e step:
`conflicts.spec.ts` › "merge conflict: Accept Theirs from the dialog, commit
with the prepared message". The test waits for `operation-banner` to disappear,
then reads `git log -1`; it got `Main change`, i.e. the merge commit did not
exist yet. A "Worker teardown timeout" followed because the failed test never
reached `app.close()`.

`2026-09-30-ci-e2e-fix.md` saw the same race in the rebase test and worked
around it in the test with `expect.poll`, noting "the banner can vanish during
a refresh". That symptom is an app bug, not only a test race:
`useOperationState` keys its query on the repo epoch. Every `repo:changed`
event creates a new query key with no data, `OperationBanner` gets
`data === undefined` and renders `null` until the refetch resolves. While a
merge/rebase is in progress (and git is writing `.git`), the banner blinks out.

## Decisions

- `placeholderData` keeps the previous op state while the new epoch refetches,
  so the banner only disappears once git says the operation is over. The test
  assertion `operation-banner` count 0 is then a real end-state signal.
- The placeholder is kept only when the previous query was for the same repo
  root: `RepoView` is not keyed per tab (`App.tsx` renders
  `<RepoView tab={activeTab} />`), so plain `keepPreviousData` would show one
  repo's banner on another tab until its state loaded.
- The rebase test keeps its `expect.poll` (harmless); its "banner can vanish"
  comment is removed since that no longer happens.

## Rejected alternatives

- `expect.poll` on the merge test's git log only — hides a visible UI flicker
  and leaves the banner assertion meaningless.
- Setting `placeholderData: keepPreviousData` globally in `queryClient` — every
  epoch-keyed view would carry state across the reused `RepoView`; too broad
  for a CI fix.
- Keying `RepoView` by tab — larger behaviour change (remounts all views on tab
  switch), out of scope.

## What changed

- `src/renderer/src/features/repo/OperationBanner.tsx` — same-root
  `placeholderData` on the op-state query.
- `e2e/conflicts.spec.ts` — drop the stale comment.

## Evidence

- CI trace (`playwright-test-results` artifact of run 36790168237): click on
  `continue-op` ends at 15081 ms, `toHaveCount(0)` on the banner passes at
  15110 ms, the git log assertion fails at 15118 ms — the banner vanished
  ~30 ms after the click, before the merge commit existed. After "Accept
  Theirs" the operation is still `merge`, so only missing query data explains a
  hidden banner.
- Local, unfixed code: merge test `--repeat-each=10` passes, also pinned to
  one core (`taskset -c 0`) — the race did not reproduce locally.
- Local, fixed code: `conflicts.spec.ts --repeat-each=8` → 24 passed; full
  `CI=true npm run test:e2e` → 20 passed, 1 failed (`window-state.spec.ts`, the
  known GNOME/Wayland difference from `2026-09-30-ci-e2e-fix.md`, green in CI);
  `npm test` 225 passed; typecheck and lint clean.

## Corrections

- `2026-09-30-ci-e2e-fix.md` classified the rebase-test failure as a test race.
  The underlying cause was this banner flicker.

## Deliberately not done

- Other epoch-keyed queries have the same empty-while-refetching behaviour;
  only the banner is fixed here.
- Specs call `app.close()` at the end of the test body, so a failed assertion
  leaves Electron running and adds a 60 s teardown timeout. Not changed.
- Could not reproduce the failure locally; the fix is confirmed by the trace
  timeline, not by a local red → green run.

## How to verify

Push the branch; the "Linux (typecheck, lint, tests, e2e)" job should be green.
Locally:

```bash
npx electron-vite build && CI=true npx playwright test e2e/conflicts.spec.ts --repeat-each=8
```
