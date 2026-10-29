# Fix flaky worktree Refresh e2e on CI

- **Date:** 2026-10-29
- **Branch:** `fix/ci-worktree-refresh-e2e`
- **Status:** done

## Context

CI on `main` failed at `cd27e6d` (Auto Merge All), Linux job, one e2e test:
`e2e/worktree-nothing.spec.ts` › "Refresh re-counts uncommitted changes of another worktree", line 100.
That line checked that the badge still said "nothing to merge into main" one second after a file was
edited in the linked worktree, before Refresh is clicked. On CI the badge had already updated by itself
("nothing committed to merge · 1 uncommitted"). The Windows job and the other 38 e2e tests passed.

## Decisions

- **The check was a precondition, not the behaviour under test.** It was there to show that Refresh is
  what updates the badge ([2026-10-11-worktree-refresh-badges](2026-10-11-worktree-refresh-badges.md)).
  But the app does not promise the badge stays stale. The `repo:changed` handler in `App.tsx`
  invalidates `['quickStatus', <sibling path>]` by prefix, and that prefix also covers the badge's
  `['quickStatus', path, 'worktree']` key. So any watcher event for main refetches the badge.
- **Fix:** removed the one-second wait and the stale check. The final assertion (Refresh shows
  "1 uncommitted") stays. A comment explains why.

## Rejected alternatives

- **Retries in `playwright.config`.** That would hide every flaky test, not just this one.
- **Backdating file mtimes in the setup to avoid racy-git index rewrites.** This was not shown to be
  the trigger, and other triggers (any `.git` change in main) would remain.
- **Narrowing the `repo:changed` invalidation to skip the `'worktree'` key.** That changes app
  behaviour to suit a test, and refreshing on a repo change is wanted.

## Evidence

- CI run 40853351850: the only failure is line 100, which received the up-to-date text.
- I could not reproduce it locally on `origin/main`:
  - 5/5 runs alone,
  - 8/8 runs with all cores busy (`--repeat-each 8 --workers 2`),
  - 3/3 runs with the worktree specs in CI order.
- After the fix: typecheck and lint are clean, `npm test` passes 315/315, and
  `worktree-nothing.spec.ts --repeat-each 3` passes 6/6.

## Corrections

- The test comment said "no .git change, so no watcher event". The linked worktree's own edit causes
  none, but the app's own `git status` in main can rewrite `.git/index`, which the watcher reports.
  This is the most likely trigger, but it is **not confirmed**: the CI trace artifact
  (`playwright-test-results`) was not downloaded.

## Deliberately not done

- No change to app code.
- In the rare run where a background refresh lands before Refresh is clicked, the test can no longer
  tell whether Refresh did the work. In normal runs it still catches a broken Refresh.

## How to verify

```bash
npm run build && E2E_NO_SANDBOX=1 npx playwright test e2e/worktree-nothing.spec.ts --repeat-each 5
```
