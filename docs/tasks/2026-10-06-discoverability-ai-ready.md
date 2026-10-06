# Discoverability (SEO) and AI-agent readiness

- **Date:** 2026-10-06
- **Branch:** `docs/public-readme`
- **Status:** done (repo side); GitHub settings pending, see below

## Context

After the repository went public (see [2026-10-06-public-repo-readme](2026-10-06-public-repo-readme.md)),
the goal was to make GitClient findable by search engines, AI answer engines and GitHub search, and
easy for AI coding agents to work on. "GitClient" is a generic name, so ranking depends on the
descriptive phrases around it ("Git GUI for Linux", "IDE Git tools without the IDE",
"GitKraken / Sourcetree alternative").

## Decisions

- **README rewritten for the first screen**: keyword-bearing H1 ("free, open-source Git GUI for
  Linux and Windows"), badges, one-paragraph pitch, real screenshots, scannable Features list,
  "Who is it for?" and an FAQ (Q&A text is what AI answer engines quote). Maintainer-only content
  (publishing releases, testing installers) moved to `docs/RELEASING.md`.
- **Screenshots are generated, not hand-made**: `scripts/screenshots.mjs` drives the built app with
  Playwright on throwaway repos with fictional authors (`*@example.com`), so they can be refreshed
  after UI changes and never leak real identities.
- **GitHub Pages landing site** (`site/`, deployed by `.github/workflows/pages.yml`): the strongest
  SEO lever available — own canonical URL, title/description, Open Graph + Twitter cards,
  JSON-LD (`SoftwareApplication`, `SoftwareSourceCode`, `FAQPage`), `robots.txt`, `sitemap.xml`.
  Plain static HTML, no framework, light/dark via `prefers-color-scheme`.
- **AI-facing files**: `llms.txt` (llmstxt.org convention, root of repo and site), `AGENTS.md`
  (commands, layout, end-to-end feature recipe, hard rules) with `CLAUDE.md` importing it.
- **GitHub community profile**: `LICENSE` (MIT, matching `package.json`), `CONTRIBUTING.md`,
  `SECURITY.md`, issue forms, PR template, `CITATION.cff`. A complete profile ranks better in GitHub
  search and makes the repo look maintained.
- **Metadata keywords**: `package.json` description + `keywords`; Linux `.desktop` entry gets
  `GenericName` and more `Keywords` (GNOME/KDE app search).

## Rejected alternatives

- Using this repository's own history for the log screenshot — it showed the owner's real e-mail
  address in the commit details. Deleted those images; switched to a synthetic demo repo.
- A docs framework (Docusaurus, VitePress) for the site — one page does not justify a build step.
- `CODE_OF_CONDUCT.md` — the standard text (Contributor Covenant) is long third-party text; left
  for the owner to add from GitHub's template picker if wanted.
- Pointing `package.json` `homepage` at the Pages site — the update check and installers rely on the
  GitHub URL; left as the repository URL.

## What changed

New: `AGENTS.md`, `CLAUDE.md`, `llms.txt`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
`CITATION.cff`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`,
`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/pages.yml`, `site/{index.html,og.html,og.png,robots.txt,sitemap.xml}`,
`docs/images/{log-dark,log-light,merge-editor-dark}.png`, `docs/RELEASING.md`,
`scripts/screenshots.mjs`, `scripts/og-image.sh`.
Changed: `README.md`, `package.json` (description, keywords), `electron-builder.yml` (desktop entry).

## Evidence

- `npm run lint` clean; `npm test` 26 files / 237 tests passed.
- JSON-LD block parses as JSON; site rendered with headless Chrome at 1280 px and 390 px (no
  horizontal scroll, nav collapses to the GitHub link on phones).
- `node scripts/screenshots.mjs` completes (exit 0) and writes the three PNGs.

## Corrections

- The earlier record said no `LICENSE` existed; it is now added (MIT, "phil288 and GitClient
  contributors").
- Screenshot script: `page.screenshot` sometimes never gets a frame for an unfocused window on
  Wayland, and `app.close()` could hang. Fixed by focusing + `invalidate()` before capture,
  `capturePage` fallback, and a SIGKILL fallback on close.

## Deliberately not done (needs the owner, outward-facing)

- GitHub repo settings: description, website URL, topics, social preview image (`site/og.png`,
  upload via Settings → General), Pages source "GitHub Actions", private vulnerability reporting
  (Settings → Security), optionally Discussions.
- Submitting the site to Google Search Console / Bing Webmaster Tools, and listings on
  AlternativeTo, Flathub/Snapcraft, winget, awesome-lists — off-repo actions.
- The comparison table on the site reflects the competitors as known in 2026; review it occasionally.
- Install one-liners and download links work only after the first non-draft release.

## How to verify

- `npm run lint && npm test`
- `npm run build && node scripts/screenshots.mjs` → three PNGs in `docs/images/`, fictional authors only.
- Open `site/index.html` locally (images resolve after the Pages workflow assembles `_site`; to
  preview, copy `docs/images/*.png` to `site/images/` temporarily).
- After merge + enabling Pages: https://phil288.github.io/git-client/ loads; validate structured
  data with Google's Rich Results Test and the card with an Open Graph debugger.
