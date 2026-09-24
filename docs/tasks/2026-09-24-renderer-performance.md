# Renderer performance pass (log table, tab state, Monaco)

- **Date:** 2026-09-24
- **Branch:** `perf/app-speed`
- **Status:** done

## Context

User report: "the application is a bit slow and laggy". Measured before
guessing, against a synthetic repo (42,000 commits, a merge every 10 commits,
tags/branches, 30 modified + 1 untracked file) generated with `git fast-import`,
driven by a throwaway Playwright/Electron harness that reads CDP
`Performance.getMetrics` and samples `Profiler` during scroll and arrow-key
navigation, with `GIT_TRACE` counting spawned git processes.

## Findings (root causes, by measured cost)

1. **Date formatting in every log row.** `formatDate` / `absoluteDate` used
   `toLocaleString(locale, options)`, which builds a new `Intl.DateTimeFormat`
   per call. Two calls per visible row (~90 rows incl. overscan) per render.
   Profile: ~720 ms self time during 30 wheel scrolls, ~830 ms during 20
   arrow presses — the top two JS functions by far.
2. **Whole-app re-render on every per-tab UI write.** `App` selected the
   active `RepoTab` object; `setUi` (selection, pane size, filters) replaces
   that object, so each selection change re-rendered App → RepoView → LogView
   → toolbar, branches panel, details, and every visible log row.
3. **Commit details fetched for every row passed over.** Holding ↓ fired 2
   `diff-tree` processes (+ the "containing" query) per row.
4. **Monaco in the startup bundle.** `App` imported `@/lib/monaco` eagerly;
   the main renderer chunk was 3.33 MB, ~2.7 MB of it Monaco.
5. Git Console re-rendered up to 1,000 entries per logged command.

Not a problem (checked): idle log view spawns 0 git processes; the status poll
already uses `--no-optional-locks`, so it does not touch `.git/index` and
cannot trigger the watcher → epoch → log reload loop.

## Decisions

- Cache three module-level `Intl.DateTimeFormat` instances in `lib/format.ts`.
- Extract a `memo`ized `LogRow`; row handlers go through refs so they are
  stable. The full-date tooltip is set lazily on `mouseenter` instead of being
  formatted for every row on every render.
- Views receive `TabRef` (`id`, `path`, `name`) instead of `RepoTab`; App and
  RepoSwitcher select it with `useShallow(selectActiveTabRef)`. Per-key UI
  state is still read through `useTabUi`, which was already the only reader
  of `tab.ui`.
- `useSettledValue` (new hook) feeds the details panel: an isolated change
  (click) passes immediately, a burst faster than 150 ms only delivers the
  value it settles on. No added latency for single clicks.
- `LazyDiffViewer` / `LazyMergeEditor` wrap the real components with
  `React.lazy` + `Suspense`; `lib/monaco` (which also calls
  `loader.config({ monaco })`, preventing a CDN load) is now only reached
  through those chunks. Every importer uses the lazy wrappers.
- `Entry` in the Git Console is `memo`ized; `upsert` searches from the end.

## Rejected alternatives

- Plain trailing debounce on the selection → details: adds delay to every
  click. The "settled" variant only delays bursts.
- Custom equality on `useTabsStore` via `zustand/traditional`: `useShallow`
  over a 3-field identity object does the same with what is already used.
- Reducing virtualizer overscan: rows are memoized now; overscan was not in
  the profile.

## What changed

- `src/renderer/src/lib/format.ts` — cached formatters.
- `src/renderer/src/features/log/LogTable.tsx` — memoized `LogRow`, stable handlers, lazy tooltip.
- `src/renderer/src/stores/tabs.ts` — `TabRef`, `selectActiveTabRef`.
- `App.tsx`, `switcher/RepoSwitcher.tsx` — `useShallow(selectActiveTabRef)`; App no longer imports Monaco.
- `RepoView`, `LogView`, `BranchesPanel`, `StashView`, `BlameView`, `FileHistoryView`, `ChangesView` — prop type `RepoTab` → `TabRef`.
- `hooks/useSettledValue.ts` (new); `LogView.tsx` uses it for `CommitDetailsPanel`.
- `features/diff/LazyDiffViewer.tsx`, `features/merge/LazyMergeEditor.tsx` (new); importers switched
  (`ChangesBrowser`, `ChangesView`, `LogView`, `FileHistoryView`, `CommitMenu` (type), `ConflictsDialog`).
- `features/console/GitConsole.tsx` — memo `Entry`, `findLastIndex`.

## Evidence

Same harness, same repo, before → after (wall time includes Playwright overhead):

| Scenario | Before | After |
| --- | --- | --- |
| 60 wheel scrolls: renderer script time | 2.97 s | 0.81 s |
| 60 wheel scrolls: total task time | 6.1 s | 3.4 s |
| 40 × ArrowDown: wall | 5.96 s | 1.46 s |
| 40 × ArrowDown: task / script | 4.67 s / 3.19 s | 0.91 s / 0.37 s |
| `diff-tree` processes during navigation | 82 | 10 |
| Main renderer chunk | 3.33 MB | 0.65 MB |
| First diff open (loads Monaco chunk) | — | ~0.46 s |

`npm run typecheck`, `eslint`, `vitest` (202 passed), `playwright test` (9 passed, incl. conflicts/merge editor).

## Corrections

- Initial suspicion was a watcher feedback loop (status poll → index write →
  `repo:changed` → log reload). Wrong: status uses `--no-optional-locks` and
  the idle log view spawned 0 git commands in 10 s.
- "First rows visible" after launch did not measurably change (~2.4–2.6 s both
  before and after; noise dominates). The bundle cut is real but that metric
  is dominated by Electron start + `git log`.

## Deliberately not done

- Remaining scroll cost is mostly native (paint/"program"), not JS; the SVG
  `GraphCell` per row could be replaced by a canvas if it matters later.
- Commit view polls `git status --untracked-files=all` every 3 s by design; on
  very large working trees that may be worth making adaptive.
- `TabBar` still re-renders on every UI write (it subscribes to `tabs`); it is
  a handful of elements, not worth the complexity.
- The profiling harness was kept out of the repo (it depends on a generated
  repo); method is described in Context.

## How to verify

```bash
npm run typecheck && npx eslint . && npx vitest run && npm run test:e2e
```

Manually: open a large repo, hold ↓ in the log — selection should move
smoothly and the Git Console (with background refreshes shown) should show
`diff-tree` only for the row you stop on. Open a diff: a brief "Loading diff…"
on the first open only.
