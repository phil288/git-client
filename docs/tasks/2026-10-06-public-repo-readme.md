# Repository made public: fill in repo slug, update README

- **Date:** 2026-10-06
- **Branch:** `docs/public-readme`
- **Status:** done

## Context

The GitHub repository `phil288/git-client` was switched to public. The README and installers still
carried the `<OWNER>/<REPO>` placeholder, so the one-liner install commands, release links and the
in-app update check (which reads `package.json` "repository") did not work.

## Decisions

- Replaced the placeholder in all four files the README listed (`package.json`, `install.sh`,
  `install.ps1`, `README.md`), not only the README — the README alone would document install
  commands whose scripts still pointed at `<OWNER>/<REPO>`, and a test enforces that the scripts
  match `package.json`.
- Kept `GITHUB_TOKEN` support but reworded it from "needed if the repository is private" to
  optional (higher API rate limit, private forks).
- Turned "Placeholders to replace before publishing" into a "Forking" section (same file list,
  plus the `GITCLIENT_REPO` override) and added a short "Contributing" section and CI/release badges.

## Rejected alternatives

- Removing `GITHUB_TOKEN` handling from the installers — still useful for rate limits and forks.

## What changed

- `README.md`: real slug in commands/links, badges, token wording, Forking + Contributing sections.
- `package.json`: `homepage`, `repository.url`.
- `install.sh`, `install.ps1`: `DEFAULT_REPO` / `$DefaultRepo`, header comments, token help text.

Left as-is on purpose: `tests/unit/versions.test.ts` and `src/shared/versions.ts` use
`<OWNER>/<REPO>` as a literal test input/doc for placeholder detection.

## Evidence

`npx vitest run tests/integration/installScript.test.ts tests/unit/versions.test.ts` — 18 passed.

## Deliberately not done

- No `LICENSE` file exists although `package.json` says MIT; a public repo without one is not
  actually licensed. Left for the owner to add.
- Install one-liners only work once a non-draft release exists.

## How to verify

`grep -rn '<OWNER>' README.md package.json install.sh install.ps1` returns nothing;
`npm test` passes.
