# AGENTS.md

Rules for anyone changing this repository — AI coding agents and humans alike.
They are mandatory. If a rule blocks you, stop and ask instead of working
around it.

## Project at a glance

- MCP server (stdio) for Telegram, TypeScript (strict), ESM, Node >= 22.
- `src/index.ts` — entry point only (console suppression, stdio wiring).
- `src/server.ts` — `TelegramMCPServer`: all tool logic. No side effects on
  import. Seams for tests: `handleToolCall()`, `buildToolCatalog()`,
  `createTelegramClient()`.
- `tests/*.test.ts` — unit tests (`node:test` + `tsx`), fake client in
  `tests/fakes.ts`. No network, no credentials.
- `scripts/test-server.ts` — smoke test (spawns built server, checks `tools/list`).
- `scripts/live-check.ts` — manual E2E against real Telegram. Never in CI.

## Commands

```bash
npm ci                # install (exact lockfile)
npm run build         # tsc, strict — must pass with zero errors
npm test              # unit + smoke (smoke needs a build first)
npm run test:unit     # unit tests only
npm run test:ci       # unit tests under c8 -> reports/ + coverage/
npm run ci:summary    # render the CI summary locally (stdout)
```

## 1. Every change goes through a pull request

- **Never commit or push directly to `main`.** Create a branch, push it,
  open a PR against `main`.
- Branch names: `<type>/<short-kebab-description>`, e.g. `feat/search-pagination`,
  `fix/hasmore-short-batch`, `docs/readme-badges`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `ci: …`, `chore: …`.
  Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- One concern per PR. Fill in the PR template (what / why / how tested).
- A PR may be merged only when CI is green on all Node versions.
- Prefer **squash merge**; the PR title becomes the commit on `main`, so it
  must be a valid Conventional Commit.
- Never force-push `main`, never rewrite published tags.

## 2. Every change comes with tests

- **New feature or tool** → unit tests for the happy path, input validation,
  and error paths, through `handleToolCall()` (the real dispatch path).
- **Bug fix** → first a test that fails without the fix, then the fix.
- **New tool** → also update `buildToolCatalog()` expectations in
  `tests/catalog.test.ts`, the README tool reference and the response schemas.
- **Refactor** → existing tests must pass unchanged; no behavior change
  without a test that pins it.
- Tests must be deterministic: no network, no real Telegram, no wall-clock
  dependence (use `mock.timers` / fixed dates), no ordering dependence.
- Use the fake client in `tests/fakes.ts`; extend it rather than mocking ad hoc.
- Coverage must not drop: keep lines >= 90% and do not lower the CI
  thresholds to make a PR pass.
- Before pushing: `npm run build && npm test` must be green locally.
- Changes touching Telegram API calls should also be verified once with
  `scripts/live-check.ts` by someone with credentials; mention the result in
  the PR.

## 3. Code rules

- TypeScript strict; no `any` in new code unless unavoidable at the gramjs
  boundary, and then narrowed immediately.
- Validate every tool input with zod; keep the zod schema and the advertised
  JSON schema in sync (a test enforces this).
- **stdout is the MCP protocol channel.** Never write to stdout from server
  code; diagnostics go nowhere or to stderr behind the existing suppression.
- Tool responses are a single compact JSON text block. Response shapes are a
  public contract: add fields freely, but removing/renaming a field is a
  breaking change (see Releases).
- Fail loudly: unresolvable channels and invalid input return errors, never
  silent empty results.
- Keep `src/server.ts` free of import-time side effects.
- Update `README.md` in the same PR when behavior, parameters or responses
  change, and add an entry under `## [Unreleased]` in `CHANGELOG.md`.

## 4. Security

- Never commit, print, log or paste credentials: `TELEGRAM_API_ID`,
  `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, phone numbers, 2FA passwords,
  or anything from `~/.secrets/`.
- `.env` is gitignored; only `.env.example` with placeholders is committed.
- Test fixtures use fake ids and fake session strings only.
- Report vulnerabilities privately (see `SECURITY.md`), not in public issues.

## 5. Releases

Versioning is [SemVer](https://semver.org/). While the version is `0.x`,
minor bumps may contain breaking changes; from `1.0.0` on:

| Change | Bump |
|---|---|
| Removed/renamed tool, parameter or response field; changed default | **major** |
| New tool, parameter or response field; new capability | **minor** |
| Bug fix, docs, internal refactor, dependency patch | **patch** |

The release is cut from `main` only, via a PR plus a tag:

1. Open a PR `chore(release): vX.Y.Z` that
   - bumps `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`),
   - moves the `## [Unreleased]` entries in `CHANGELOG.md` into
     `## [X.Y.Z] - YYYY-MM-DD` and updates the compare links at the bottom.
2. Merge it after CI is green.
3. Tag the merge commit on `main` and push the tag:
   ```bash
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. `.github/workflows/release.yml` then verifies the tag is on `main` and
   matches `package.json`, runs build + tests, packs the tarball and
   publishes the GitHub Release with the changelog section as notes.
5. Pre-releases use `vX.Y.Z-rc.N` and are marked as pre-release automatically.

Never create releases by hand in the GitHub UI and never move an existing tag;
if a release is broken, ship a new patch version.

## 6. Repository settings (maintainers)

`main` is protected by a ruleset (Settings → Rules → Rulesets):

- Target: default branch; enforcement: active.
- Require a pull request before merging (dismiss stale approvals on push).
- Require status checks to pass: `build & test (node 22)`,
  `build & test (node 24)`, `build & test (node 26)`; require branches to be
  up to date.
- Block force pushes; restrict deletions.
- Allowed merge method: squash. Auto-delete head branches.
- Tag ruleset for `v*`: restrict updates and deletions.
