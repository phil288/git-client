# Remove third-party IDE vendor mentions

- **Date:** 2026-10-06
- **Branch:** `docs/neutral-ide-wording`
- **Status:** done

## Context

README, site, package metadata and desktop entry described GitClient as modeled on a specific IDE
vendor's Git tooling and named that vendor's individual IDE products. Using another company's
trademarks in product positioning, SEO keywords and FAQ copy risks trademark / implied-endorsement
issues. Goal: no vendor or product name anywhere in the tracked tree. This record itself avoids the
names on purpose so the verification grep stays empty.

## Decisions

- Replace with neutral wording ("IDE-style Git tooling", "classic IDE Git tooling") — keeps the
  positioning without naming a vendor.
- Drop the vendor/product entries from `package.json` keywords and the matching phrase from the
  site meta keywords.
- Code comments: strip the vendor reference, keep the technical description.
- Also removed the vendor-named monospace font from the CSS font stacks (app + site); it was only a
  fallback preference, the next font in the stack takes over.
- Older task records edited too, so the grep below is empty.

## Rejected alternatives

- Keeping the name with a "not affiliated" disclaimer — still uses the mark for marketing.
- Keeping the vendor-named font in font stacks (OFL font, low risk) — removal requested everywhere.

## What changed

README, AGENTS.md, llms.txt, package.json (description, keywords), electron-builder.yml (synopsis),
install.sh (.desktop Comment), site/index.html (meta, JSON-LD, hero, FAQ, font stack), feature
request issue template, renderer/main/shared doc comments, styles.css (palette comment, font stack),
one unit test name, six older task records.

## Evidence

`npm run typecheck`, `npm run lint` clean; `tests/unit/shortcuts.test.ts` passes (renamed test).

## Deliberately not done

- Git history still contains the old wording (rewriting published history not worth it).
- GitHub repo description/topics on github.com not touched — owner should check repo settings for
  vendor-named topics.
- Screenshots in `docs/images/` not re-checked for visible vendor text (none expected).

## How to verify

```bash
grep -rniI "jet[b]rains\|intelli[j]\|pychar[m]\|webstor[m]" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=dist --exclude-dir=release .
```

No output expected.
