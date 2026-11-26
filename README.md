# MCP Telegram Server

[![CI](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![tests](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FMaxsh%2Ftelegram-mcp%2Fbadges%2Ftests.json)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FMaxsh%2Ftelegram-mcp%2Fbadges%2Fcoverage.json)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![release](https://img.shields.io/github/v/release/Maxsh/telegram-mcp?sort=semver)](https://github.com/Maxsh/telegram-mcp/releases)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants read, search and manage Telegram channels, groups and private conversations **on behalf of your user account** (not a bot).

**Contents:** [Features](#features) · [Quick start](#quick-start) · [Setup](#setup) · [Tools](#available-tools) · [MCP client configuration](#mcp-client-configuration) · [Development](#development) · [Testing](#testing) · [Contributing](#contributing) · [Releases](#releases) · [Security](#security-notes) · [Troubleshooting](#troubleshooting)

## Quick start

```bash
git clone https://github.com/Maxsh/telegram-mcp.git && cd telegram-mcp
npm ci && npm run build
export TELEGRAM_API_ID=... TELEGRAM_API_HASH=...   # from https://my.telegram.org/apps
npm start   # stdio MCP server; authorize via the telegram_authorize tool
```

Then register `node /absolute/path/to/telegram-mcp/dist/index.js` in your MCP client (see [MCP client configuration](#mcp-client-configuration)). A step-by-step walkthrough lives in [SETUP.md](SETUP.md).

## Features

- **User-account access** — acts on behalf of the authenticated Telegram user, not a bot token
- **Read anywhere** — recent messages, search and chat info across channels, groups and private chats, plus discovery of available channels
- **Pagination and time windows** — `offsetId` paging for busy channels; `sinceMinutes` / `sinceHours` / `sinceDate` windows with IANA time zones (DST-correct)
- **Batch fetch** — up to 25 channels in one call, each with its own result or error
- **Digest-friendly output** — `maxTextLength`, `fields`, `excludeMedia`; media captions, t.me links, `forwardedFrom`
- **Session management** — interactive authorization with 2FA, pre-generated session strings, logout

## Setup

Set the environment variables (`.env` file or exports):

```bash
TELEGRAM_API_ID=your_api_id            # from https://my.telegram.org/apps
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_session_string   # optional
```

**Authentication options**

- **Interactive (easiest start):** use any tool and the server asks for authorization — call `telegram_authorize` with your phone number, then `telegram_verify_code` with the code (and your 2FA password, if enabled). The session lives in memory for the server's lifetime.
- **Pre-generated session:** run `npm run generate-session` once (prompts for phone, code, 2FA) and store the printed string as `TELEGRAM_SESSION` — it persists across restarts. Never commit it.

`telegram_logout` invalidates the current session at any time.

## Available tools

| Tool | Purpose |
|---|---|
| `get_recent_messages` | Recent messages from a channel, group or private chat; `offsetId` pagination and time windows |
| `get_messages_multi` | Batch-fetch recent messages from up to 25 channels, with per-channel results and errors |
| `get_private_messages` | Private conversation messages with contact formatting |
| `get_channel_info` | Metadata for any chat, including a ready-to-use `peer` id |
| `search_messages` | Text search within a chat |
| `get_available_channels` | List channels and groups the user can access |
| `mark_messages_read` | Mark messages as read (groups and private chats; broadcast channels don't support read status) |
| `check_unread_messages` | Find chats with unread messages |
| `get_chat_status` | Diagnostics for read status and chat capabilities |
| `telegram_authorize` | Start the interactive authorization |
| `telegram_verify_code` | Complete authorization with the code and optional 2FA password |
| `telegram_logout` | Log out and invalidate the session |

MCP clients also receive each tool's exact input schema via `tools/list`, so arguments are validated before a call is dispatched.

**Full parameters, examples and response schemas: [docs/TOOLS.md](docs/TOOLS.md).** Response shapes are a stable contract: fields may be added, but removing or renaming one is a breaking change.

## MCP client configuration

Add to your Claude Desktop `claude_desktop_config.json` (other MCP clients are configured analogously):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/path/to/mcp-telegram-server/dist/index.js"],
      "env": {
        "TELEGRAM_API_ID": "your_api_id",
        "TELEGRAM_API_HASH": "your_api_hash",
        "TELEGRAM_SESSION": "your_session_string"
      }
    }
  }
}
```

## Development

```bash
npm run dev     # run from source with tsx
npm run watch   # rebuild on change
```

Project rules for agents and contributors: [AGENTS.md](AGENTS.md).

## Testing

```bash
npm test              # unit tests + smoke test
npm run test:unit     # unit tests only (tests/*.test.ts, fake Telegram client)
npm run test:smoke    # spawns the built server and checks tools/list
npm run test:coverage # unit tests with a coverage report
```

The unit suite (`tests/*.test.ts`) runs on Node's built-in test runner with a
fake Telegram client — no network access and no credentials. It covers every
tool (`get_recent_messages` pagination and output options, `get_messages_multi`,
`get_channel_info`, `search_messages`, `get_available_channels`,
`mark_messages_read`, `check_unread_messages`, `get_private_messages`,
`get_chat_status`, the authorization flow), the pure helpers (time zones, id
normalization, media typing, output shaping), and the tool catalog/dispatch
contract.

`scripts/live-check.ts` is a manual end-to-end check against the real Telegram
API (needs credentials in `~/.secrets/telegram-*`) and is intentionally not part
of CI.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request, on Node 22, 24 and 26:

- build (`tsc`, strict), unit tests under c8, smoke test;
- **run Summary** with passed/failed/skipped counts, per-suite breakdown,
  failure details and coverage (statements/branches/functions/lines);
- **JUnit check run** with failure annotations (`dorny/test-reporter`);
- **coverage comment** on pull requests (Cobertura, `irongut/CodeCoverageSummary`);
- raw reports (JUnit XML, Cobertura, LCOV) as downloadable artifacts.

The `tests` and `coverage` badges above are
[shields.io endpoint badges](https://shields.io/badges/endpoint-badge) generated
by `scripts/ci-summary.ts` and published to the `badges` branch on every push to
`main`, so they always show the latest `main` build.

Reproduce the CI report locally:

```bash
npm run test:ci && npm run ci:summary   # markdown summary on stdout, reports in reports/ and coverage/
```

## Contributing

All changes go through pull requests with tests — see
[CONTRIBUTING.md](CONTRIBUTING.md) and the full rules in [AGENTS.md](AGENTS.md)
(which also apply to AI coding agents). Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## Releases

Versions follow [SemVer](https://semver.org/); release notes come from
[CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/)).
Pushing a `vX.Y.Z` tag on `main` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which verifies
the tag, builds, tests and publishes the
[GitHub Release](https://github.com/Maxsh/telegram-mcp/releases) with an
`npm pack` tarball. The process is described in [AGENTS.md → Releases](AGENTS.md#5-releases).

## Security notes

- **Session security**: Keep your session string secure. It provides full access to your Telegram account.
- **API credentials**: Never share your API ID and hash publicly.
- **Channel access**: The server can only access channels that your Telegram account has permission to read.
- **Rate limiting**: Telegram has rate limits. The server doesn't implement rate limiting, so use responsibly.
- **Reporting vulnerabilities**: privately, see [SECURITY.md](SECURITY.md).

## Troubleshooting

Quick checks:

- **"Authorization required"** → `telegram_authorize`, then `telegram_verify_code` (add `password` for 2FA). Invalid code? Codes expire within minutes — request a new one.
- **`mark_messages_read` doesn't stick** → debug with `get_chat_status`; broadcast channels and secret chats don't support read status.
- **Rate limits / network errors** → retry later; the server already retries connections.

The full guide lives in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## License

[MIT](LICENSE)
