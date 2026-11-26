<!-- PR title must be a Conventional Commit, e.g. "feat: add search pagination" (it becomes the squash commit on main). -->

## What

<!-- What does this PR change? -->

## Why

<!-- Motivation / linked issue. Use "Closes #123" to auto-close. -->

## How tested

<!-- New/updated unit tests, smoke test, live-check result if Telegram API calls changed. -->

## Checklist

- [ ] Tests added/updated for every behavior change (bug fixes start with a failing test)
- [ ] `npm run build && npm test` passes locally
- [ ] Coverage did not drop (lines >= 90%)
- [ ] README updated if tools, parameters or responses changed
- [ ] `CHANGELOG.md` entry added under `## [Unreleased]`
- [ ] Breaking change? Marked with `!` / `BREAKING CHANGE:` and described above
- [ ] No credentials, session strings or phone numbers in code, tests or logs
