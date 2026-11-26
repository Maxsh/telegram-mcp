# Contributing

Thanks for helping! The full rules live in [AGENTS.md](AGENTS.md) and apply
to humans and AI agents alike. The short version:

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`), never push to `main`.
2. Every behavior change comes with tests; bug fixes start with a failing test.
3. `npm run build && npm test` must pass locally.
4. Open a PR with a Conventional Commit title and fill in the template.
5. CI must be green on Node 22/24/26 before merge (squash).
6. Add a `CHANGELOG.md` entry under `## [Unreleased]`.

Releases are cut by maintainers — see AGENTS.md → Releases.
