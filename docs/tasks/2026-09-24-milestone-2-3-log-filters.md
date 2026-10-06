# Milestones 2 & 3 — Log, commit graph, search & filters

- **Date:** 2026-09-24
- **Branch:** `feat/m1-scaffold` (all milestones stacked, uncommitted, per user instruction)
- **Status:** done

## Context

IDE-style "Log" tab: paged history with a lane graph that stays smooth at 100k+ commits, ref labels,
commit details with changed files, Monaco diff, then text/branch/user/date/path filters and Go to.

## Decisions

- **One `git log` process per query, streamed** (`LogSessions`, main). stdout is parsed record by
  record (`%x1e` + NUL fields) and handed out in 2,000-commit pages; the process is paused above
  10k buffered commits and resumed below 4k. No `--skip` re-walks. Sessions die when consumed,
  closed, or idle for 10 min.
- **`--date-order`** (children before parents, incremental with commit-graph files).
- **"On current branch"** is computed while streaming: a commit is on HEAD's history iff it is HEAD
  or a parent of one already seen (pending-set propagation). No `rev-list HEAD` of the whole repo.
- **Graph layout in `src/shared/graph.ts`** (pure, incremental): lanes hold the awaited hash; lanes
  waiting for the same commit converge at it; first parent continues the lane; extra parents join an
  awaiting lane or open a free one; lanes never shift sideways; trailing free lanes are dropped.
  Rows carry top-half and bottom-half edges; rendered as one small SVG per visible row.
- **Graph hidden for text/author/date filters** (the rows would be disconnected); kept for branch
  and path filters (`--parents` enables git's parent rewriting for pathspecs).
- **Text search is done in main, not by git:** it must match message OR hash prefix OR author,
  but git ANDs `--grep` with `--author`. While a text filter is active the format adds `%B`.
  Regex is JS syntax; invalid regex → `INVALID_ARGUMENT` before git starts.
- **Author filter uses `--fixed-strings --regexp-ignore-case`**; "me" = `git config user.email`.
- **Revisions after `--end-of-options`** (git ≥ 2.24); `--branches/--remotes/--tags` must stay
  before it (they're options) — found by a failing test.
- **File contents via `cat-file --batch-check` + `cat-file blob`**, raw bytes decoded with BOM
  detection, UTF-8 validation and a latin1 fallback so bytes round-trip (needed by M8's merge save).
  Blobs at commit hashes are cached forever in TanStack Query (immutable); worktree/index are not.
- **Monaco bundled locally:** `editor.api` + Monarch basic languages + one editor worker, no
  language services. Codicon CSS is imported through a Vite alias because `editor.api` does not pull
  it in and the package's `exports` map hides the `.css` path (icons rendered as boxes before).
- **Log model cache (renderer):** up to 8 models keyed by (repo, query). On `repo:changed` a fresh
  model loads in the background and replaces the visible one after its first page (no flash).
- **Per-tab UI state:** query, selection, pane sizes live in the tab's `ui` record (persisted).

## Rejected alternatives

- `git log --skip=N -n 2000` per page: re-walks history each page; seconds per page on big repos.
- Computing reachability with `git rev-list HEAD`: megabytes of hashes over IPC on large repos.
- `--grep` + `--author` for text search: wrong semantics (AND).
- Full `monaco-editor` import: pulls TS/JSON/CSS language workers we do not need.

## Evidence

- `tests/unit/graph.test.ts` (9): linear, merge, tips, octopus, crossing, lane reuse, paging
  equivalence, missing parents, 100k commits < 1.5 s.
- `tests/integration/log.test.ts` (10): paging, parents, current-branch flags, topological order,
  branch/text/regex/case/author/path filters, hash-prefix and author text search, invalid regex,
  `--end-of-options`, empty repo, closing mid-stream, refs (peeled annotated tags, HEAD), details,
  renames, binary numstat, containing refs, encodings (CRLF, BOM, latin1), index vs worktree.
- E2E: CLI-opened repo shows the log row, details and a Monaco diff.
- Screenshots (dark/light) checked: lanes, merge edge, labels, dimmed off-branch commit, filters.

## Deliberately not done

- Combined diff of non-contiguous selections is "oldest parent → newest" (like the IDE), not a
  union of individual commits.
- Text-search highlighting inside the subject.
- Column resizing (fixed widths).

## How to verify

`npm test`, `npm run test:e2e`, then `npm run dev`, open any repository: scroll a long history,
filter with the toolbar, Ctrl+F / Ctrl+Shift+F / Ctrl+G, click a commit and a file.
