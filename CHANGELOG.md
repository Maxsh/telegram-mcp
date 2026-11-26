# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-26

First tagged release.

### Added

- MCP server (stdio) exposing 12 Telegram tools: `get_recent_messages`,
  `get_messages_multi`, `get_private_messages`, `get_channel_info`,
  `search_messages`, `get_available_channels`, `mark_messages_read`,
  `check_unread_messages`, `get_chat_status`, `telegram_authorize`,
  `telegram_verify_code`, `telegram_logout`.
- Interactive authorization flow (phone code + 2FA) when no
  `TELEGRAM_SESSION` is set; pre-generated sessions via `npm run generate-session`.
- `offsetId` pagination with reliable `hasMore` / `nextOffsetId` for busy
  channels, so time windows are fully covered without silent truncation (#1).
- `resolved` block (`id`, `peer`, `title`, `username`, `type`) on every
  message result, and `lastMessageDate` to tell empty windows from
  unresolvable channels (#1).
- Channel id normalization: `@username`, bare numeric id and `-100`-prefixed
  id all resolve to the same channel; collectible `usernames[]` supported (#1).
- `get_messages_multi`: batch fetch from up to 25 channels with per-channel
  errors (#1).
- Output shaping: `maxTextLength`, `fields`, `excludeMedia`; media captions,
  `mediaType`, `groupedId`, t.me `link`s and `forwardedFrom` on messages (#1).
- IANA time zone support (`tz`) for date-only `sinceDate` and
  `today` / `yesterday` windows, DST-correct (#1).
- Automated test suite (143 unit tests on `node:test` with a fake Telegram
  client, plus a stdio smoke test).
- CI on every push and pull request (Node 22/24/26) with a test + coverage
  run summary, JUnit check run, Cobertura coverage summary, PR coverage
  comment, raw report artifacts and README badges.
- Tag-triggered release workflow publishing GitHub Releases from this changelog.

### Fixed

- `hasMore` was reported as `false` when a short batch contained more
  in-window messages than `limit`.
- `sender` rendered peer objects as `[object Object]`.
- A malformed `TELEGRAM_SESSION` crashed with a raw error instead of starting
  the authorization flow.
- Console output suppressed so logs cannot corrupt the MCP JSON-RPC stream.
- Dynamic sessions are logged out on shutdown/disconnect.

[Unreleased]: https://github.com/Maxsh/telegram-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Maxsh/telegram-mcp/releases/tag/v0.1.0
