# Contributing to GitClient

Thanks for helping. Bug reports, feature ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/phil288/git-client/issues/new/choose) with your OS, GitClient
version (Help → About), `git --version`, the steps to reproduce, and the relevant lines from the
Git Console (`Alt+9`) — it shows the exact git commands that ran and their stderr.

Security problems: do not open a public issue, see [SECURITY.md](SECURITY.md).

## Development setup

Node.js 22.12+, npm 10+, git 2.30+.

```bash
npm install
npm run dev
```

Code layout, conventions and the step-by-step for adding a feature are in [AGENTS.md](AGENTS.md)
(written for AI agents, equally useful for people).

## Pull requests

1. Branch off `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep the change focused; match the style of the surrounding code.
3. Add tests: `tests/unit` for pure logic, `tests/integration` for git behaviour, `e2e/` for UI.
4. Run `npm run typecheck && npm run lint && npm test` (and `npm run test:e2e` for UI changes).
5. For a non-trivial change, add a decision record in `docs/tasks/` (copy `_TEMPLATE.md`) and a row
   to `docs/tasks/README.md`.
6. Describe *what* and *why* in the PR; include a screenshot for visible changes.

By contributing you agree that your work is licensed under the [MIT License](LICENSE).
