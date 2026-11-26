# MCP Telegram Server

[![CI](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![tests](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FMaxsh%2Ftelegram-mcp%2Fbadges%2Ftests.json)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FMaxsh%2Ftelegram-mcp%2Fbadges%2Fcoverage.json)](https://github.com/Maxsh/telegram-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![release](https://img.shields.io/github/v/release/Maxsh/telegram-mcp?sort=semver)](https://github.com/Maxsh/telegram-mcp/releases)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants read, search and manage Telegram channels, groups and private conversations **on behalf of your user account** (not a bot).

**Contents:** [Features](#features) · [Quick start](#quick-start) · [Setup](#setup) · [Tools](#available-tools) · [Response schemas](#response-schemas) · [MCP client configuration](#mcp-client-configuration) · [Development](#development) · [Testing](#testing) · [Contributing](#contributing) · [Releases](#releases) · [Security](#security-notes)

## Quick start

```bash
git clone https://github.com/Maxsh/telegram-mcp.git && cd telegram-mcp
npm ci && npm run build
export TELEGRAM_API_ID=... TELEGRAM_API_HASH=...   # from https://my.telegram.org/apps
npm start   # stdio MCP server; authorize via the telegram_authorize tool
```

Then register `node /absolute/path/to/telegram-mcp/dist/index.js` in your MCP client (see [MCP client configuration](#mcp-client-configuration)).

## Features

- **Dynamic Authorization**: Interactive authentication when no session is provided
- **Get Recent Messages**: Retrieve the most recent messages from channels, groups, or private chats, with `offsetId` pagination for busy channels
- **Get Messages Multi**: Batch-fetch recent messages from up to 25 channels in one call, with per-channel errors
- **Get Private Messages**: Dedicated tool for reading private conversation messages with enhanced formatting
- **Search Messages**: Search for specific content within channels, groups, or private conversations
- **Get Chat Info**: Retrieve metadata and information about any Telegram chat (channels, groups, private)
- **Get Available Channels**: List all channels and groups that the user has access to (with ready-to-use `peer` ids)
- **Mark Messages as Read**: Mark specific messages or all messages as read in conversations
- **Check Unread Messages**: Find chats with unread messages in private conversations and groups
- **Get Chat Status**: Diagnostic tool to check read status and chat capabilities
- **Digest-friendly output**: `maxTextLength`, `fields` and `excludeMedia` options, media captions, t.me links, `forwardedFrom`, and IANA time zone support (`tz`) for date windows
- **Session Management**: Automatic logout and session invalidation support
- **User Authentication**: Works on behalf of the authenticated user (not bot tokens)

## Prerequisites

0. **Node.js 22 or newer** (CI runs on 22, 24 and 26).

1. **Telegram API Credentials**: You need to obtain API credentials from Telegram:
   - Go to https://my.telegram.org/apps
   - Log in with your phone number
   - Create a new application to get `api_id` and `api_hash`

2. **User Session (Optional)**: You can either:
   - Generate a session string for automatic authentication (see setup instructions below)
   - Use interactive authentication when first using the server (recommended for ease of use)

## Installation

1. Install dependencies:
```bash
npm ci
```

2. Build the project:
```bash
npm run build
```

## Setup

### 1. Environment Variables

Create a `.env` file or set the following environment variables:

```bash
export TELEGRAM_API_ID="your_api_id"
export TELEGRAM_API_HASH="your_api_hash"
# Optional: Set session for automatic authentication
export TELEGRAM_SESSION="your_session_string"
```

**Note**: If `TELEGRAM_SESSION` is not set, you'll be prompted to authenticate interactively when first using any Telegram function.

### 2. Authentication Options

#### Option A: Interactive Authentication (Recommended)

Simply start using any Telegram function and you'll be prompted to authenticate:

1. **Start Authorization**: Use any Telegram tool and you'll get an authorization prompt, or use `telegram_authorize` directly
2. **Verify Code**: Use `telegram_verify_code` with the code sent to your phone
3. **2FA (if enabled)**: Include your 2FA password in the verify_code call

#### Option B: Pre-generated Session String

Generate a persistent session string once with the bundled script (prompts for phone number, code and optional 2FA password):

```bash
export TELEGRAM_API_ID=... TELEGRAM_API_HASH=...
npm run generate-session
```

Store the printed string as `TELEGRAM_SESSION` (environment variable or secret manager — never commit it). See [SETUP.md](SETUP.md) for a step-by-step walkthrough.

## Usage

### Running the Server

Start the MCP server:

```bash
npm start
```

The server communicates via stdio and can be used with any MCP client.

### Available Tools

#### 1. get_recent_messages

Retrieves recent messages from a Telegram channel, group, or private chat.

**Parameters:**
- `channel` (string, required): Channel username (@channelname), bare numeric id (1496296645), -100-prefixed id (-1001496296645), private chat username (@username), or phone number (+1234567890)
- `limit` (number, optional): Number of messages to retrieve (default: 10, max: 100)
- `offsetId` (number, optional): Return messages older than this message ID (pass `nextOffsetId` from the previous page to paginate)
- `sinceMinutes` (number, optional): Get messages from the last N minutes
- `sinceHours` (number, optional): Get messages from the last N hours
- `sinceDate` (string, optional): Get messages since this date. Accepts a full ISO datetime (2023-12-01T10:00:00Z), a plain date (2023-12-01, midnight in `tz`), or `today` / `yesterday` (midnight in `tz`)
- `tz` (string, optional): IANA time zone used to resolve date-only `sinceDate` and `today`/`yesterday` (e.g., Europe/Kyiv). Default: UTC
- `maxTextLength` (number, optional): Truncate each message text to this many characters
- `fields` (array of strings, optional): Return only these per-message fields (see Response Schemas below)
- `excludeMedia` (boolean, optional): Omit media-only messages (no text and no caption)

**Examples:**

Get 20 most recent messages from a channel:
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@examplechannel",
    "limit": 20
  }
}
```

Get all of today's posts from a busy channel (page until `hasMore` is false):
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@examplechannel",
    "sinceDate": "today",
    "tz": "Europe/Kyiv",
    "limit": 100,
    "maxTextLength": 500,
    "fields": ["id", "date", "text", "link"]
  }
}
```

Continue pagination from a previous page:
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@examplechannel",
    "sinceDate": "today",
    "tz": "Europe/Kyiv",
    "limit": 100,
    "offsetId": 1234
  }
}
```

Get messages from the last 30 minutes:
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@examplechannel",
    "sinceMinutes": 30
  }
}
```

#### 2. get_messages_multi

Batch-fetch recent messages from multiple channels in one call. Each channel produces its own result or its own error, so one bad channel does not fail the call.

**Parameters:**
- `channels` (array of strings, required, 1-25): Channel identifiers (@username, bare numeric id, or -100-prefixed id)
- `limit` (number, optional): Max messages per channel (default: 50, max: 100)
- `sinceMinutes` / `sinceHours` / `sinceDate` / `tz` (optional): Same time-window semantics as `get_recent_messages`
- `maxTextLength` (number, optional): Truncate each message text
- `excludeMedia` (boolean, optional): Omit media-only messages

**Example:**
```json
{
  "name": "get_messages_multi",
  "arguments": {
    "channels": ["@examplechannel", "@anotherchannel", "1496296645"],
    "sinceDate": "today",
    "tz": "Europe/Kyiv",
    "limit": 100,
    "maxTextLength": 300
  }
}
```

**Response:** `summary` (`requested` / `succeeded` / `failed`) plus `results`, where each entry carries the requested `channel`, `ok: true` with the same fields as `get_recent_messages`, or `ok: false` with an `error` message.

#### 3. get_private_messages

Dedicated tool for retrieving messages from private chat conversations with enhanced formatting.

**Parameters:**
- `contact` (string, required): Contact identifier: username (@username), phone number (+1234567890), or user ID
- `limit` (number, optional): Number of messages to retrieve (default: 10, max: 100)
- `offsetId` (number, optional): Return messages older than this message ID (pass `nextOffsetId` from the previous page to paginate)
- `sinceMinutes` (number, optional): Get messages from the last N minutes
- `sinceHours` (number, optional): Get messages from the last N hours
- `sinceDate` (string, optional): Get messages since this date. Accepts a full ISO datetime, a plain date (midnight in `tz`), or `today` / `yesterday`
- `tz` (string, optional): IANA time zone for date-only `sinceDate` and `today`/`yesterday`. Default: UTC
- `maxTextLength` (number, optional): Truncate each message text to this many characters

**Examples:**

Get messages from a private chat by username:
```json
{
  "name": "get_private_messages",
  "arguments": {
    "contact": "@username",
    "limit": 20
  }
}
```

Get messages from a contact by phone number:
```json
{
  "name": "get_private_messages",
  "arguments": {
    "contact": "+1234567890",
    "limit": 10
  }
}
```

Get recent private messages from the last hour:
```json
{
  "name": "get_private_messages",
  "arguments": {
    "contact": "@username",
    "sinceHours": 1
  }
}
```

#### 4. get_channel_info

Retrieves information about a Telegram channel, group, or private chat. Returns a ready-to-use `peer` id (`-100`-prefixed for channels) and `type`, and resolves channels that only expose their handle via the newer collectible `usernames[]` field.

**Parameters:**
- `channel` (string, required): Channel username (@channelname), bare numeric id, -100-prefixed id, private chat username (@username), phone number (+1234567890), or chat ID

**Examples:**

Get channel information:
```json
{
  "name": "get_channel_info",
  "arguments": {
    "channel": "@examplechannel"
  }
}
```

Get private chat information:
```json
{
  "name": "get_channel_info",
  "arguments": {
    "channel": "@username"
  }
}
```

#### 5. search_messages

Searches for messages containing specific text in a channel, group, or private chat.

**Parameters:**
- `channel` (string, required): Channel username (@channelname), bare numeric id, -100-prefixed id, private chat username (@username), phone number (+1234567890), or chat ID
- `query` (string, required): Search query
- `limit` (number, optional): Number of results (default: 10, max: 100)
- `offsetId` (number, optional): Return matches older than this message ID
- `sinceMinutes` (number, optional): Search messages from the last N minutes
- `sinceHours` (number, optional): Search messages from the last N hours
- `sinceDate` (string, optional): Search messages since this date. Accepts a full ISO datetime, a plain date (midnight in `tz`), or `today` / `yesterday`
- `tz` (string, optional): IANA time zone for date-only `sinceDate` and `today`/`yesterday`. Default: UTC
- `maxTextLength` (number, optional): Truncate each message text to this many characters

**Examples:**

Search in a channel:
```json
{
  "name": "search_messages",
  "arguments": {
    "channel": "@examplechannel",
    "query": "important announcement",
    "limit": 15
  }
}
```

Search in a private chat:
```json
{
  "name": "search_messages",
  "arguments": {
    "channel": "@username",
    "query": "meeting",
    "limit": 10
  }
}
```

Search messages from the last hour:
```json
{
  "name": "search_messages",
  "arguments": {
    "channel": "@examplechannel",
    "query": "update",
    "sinceHours": 1
  }
}
```

#### 6. get_available_channels

Lists all channels and groups that the user has access to. Each entry includes a ready-to-use `peer` id (`-100`-prefixed) that can be passed directly as `channel` to the other tools.

**Parameters:**
- `limit` (number, optional): Number of channels to retrieve (default: 50, max: 200)
- `includeGroups` (boolean, optional): Include groups in addition to channels (default: false)

**Example:**
```json
{
  "name": "get_available_channels",
  "arguments": {
    "limit": 100,
    "includeGroups": true
  }
}
```

#### 7. mark_messages_read

Mark messages as read in a Telegram chat, group, or private conversation.

**Parameters:**
- `channel` (string, required): Channel username, group username, private chat username (@username), phone number (+1234567890), or chat ID
- `messageIds` (array of numbers, optional): Specific message IDs to mark as read
- `maxId` (number, optional): Mark all messages up to this message ID as read

**Important Note:** This feature works with **groups, supergroups, and private chats**. Broadcast channels don't support read status operations due to Telegram API limitations.

**Examples:**

Mark specific messages as read in a group:
```json
{
  "name": "mark_messages_read",
  "arguments": {
    "channel": "@examplegroup",
    "messageIds": [123, 124, 125]
  }
}
```

Mark messages as read in a private chat:
```json
{
  "name": "mark_messages_read",
  "arguments": {
    "channel": "@username"
  }
}
```

Mark all messages up to a specific ID as read:
```json
{
  "name": "mark_messages_read",
  "arguments": {
    "channel": "@examplegroup",
    "maxId": 150
  }
}
```

#### 8. check_unread_messages

Check for unread messages in private chats and groups.

**Parameters:**
- `limit` (number, optional): Number of chats to check (default: 50, max: 200)
- `includeChannels` (boolean, optional): Include channels in addition to private chats and groups (default: false)
- `onlyWithUnread` (boolean, optional): Only return chats with unread messages (default: true)

**Examples:**

Check for unread messages in private chats and groups:
```json
{
  "name": "check_unread_messages",
  "arguments": {
    "limit": 100
  }
}
```

Include channels and show all chats (even with no unread messages):
```json
{
  "name": "check_unread_messages",
  "arguments": {
    "limit": 50,
    "includeChannels": true,
    "onlyWithUnread": false
  }
}
```

Check only chats with unread messages:
```json
{
  "name": "check_unread_messages",
  "arguments": {
    "onlyWithUnread": true
  }
}
```

#### 9. get_chat_status

Get detailed status information about a chat including unread count, read status, and diagnostic information.

**Parameters:**
- `chat` (string, required): Chat identifier: username (@username), phone number (+1234567890), or chat ID

**Examples:**

Get status of a private chat:
```json
{
  "name": "get_chat_status",
  "arguments": {
    "chat": "@username"
  }
}
```

Get status of a group:
```json
{
  "name": "get_chat_status",
  "arguments": {
    "chat": "@groupname"
  }
}
```

**Note:** This tool is particularly useful for debugging read status issues and understanding why `mark_messages_read` might not work as expected.

#### 10. telegram_authorize

Start the interactive Telegram authorization process.

**Parameters:**
- `phoneNumber` (string, required): Phone number with country code (e.g., +1234567890)

**Example:**
```json
{
  "name": "telegram_authorize",
  "arguments": {
    "phoneNumber": "+1234567890"
  }
}
```

#### 11. telegram_verify_code

Complete the authorization process with verification code and optional 2FA password.

**Parameters:**
- `code` (string, required): Verification code sent to your phone
- `password` (string, optional): 2FA password (if enabled on your account)

**Examples:**

Basic verification:
```json
{
  "name": "telegram_verify_code",
  "arguments": {
    "code": "12345"
  }
}
```

With 2FA password:
```json
{
  "name": "telegram_verify_code",
  "arguments": {
    "code": "12345",
    "password": "your_2fa_password"
  }
}
```

#### 12. telegram_logout

Logout from Telegram and invalidate the current session.

**Example:**
```json
{
  "name": "telegram_logout",
  "arguments": {}
}
```

## Response Schemas

All tools return a single JSON text block (compact, not pretty-printed). The shapes below are stable; new fields may be added over time.

### get_recent_messages / get_messages_multi (per channel)

```json
{
  "channel": "Channel Title",
  "resolved": {
    "id": "1496296645",
    "peer": "-1001496296645",
    "title": "Oleg Sharp | Oleg Sharp",
    "username": "@olegsharp",
    "type": "channel"
  },
  "messagesCount": 2,
  "messages": [ ...message objects... ],
  "hasMore": false,
  "nextOffsetId": null,
  "lastMessageDate": "2026-11-25T18:42:10.000Z",
  "timeFilter": {
    "since": "2026-11-24T22:00:00.000Z",
    "sinceMinutes": null,
    "sinceHours": null,
    "sinceDate": "today",
    "tz": "Europe/Kyiv"
  }
}
```

- `resolved` is present on every call. `peer` is the ready-to-use id form (`-100…` for channels/supergroups, `-…` for basic groups, bare id for users) and can be passed back as `channel`.
- `hasMore: true` means older in-window messages exist; pass `nextOffsetId` as `offsetId` on the next call to fetch them. `hasMore: false` means the requested window is fully covered.
- `lastMessageDate` is the date of the newest message seen during the scan, even when `messagesCount` is 0 — this tells an empty window (dead or quiet channel) apart from an unresolved one. An unresolvable channel returns an error instead of silently returning 0 messages.
- `timeFilter` is present when a time window was requested. Date-only `sinceDate` values (and `today`/`yesterday`) resolve to local midnight in `tz`.

### get_private_messages

Same message objects, plus `success`, `contact`, `contactId`, `contactUsername`, `messageCount` (instead of `messagesCount`), `hasMore`, `nextOffsetId`, `lastMessageDate` and `timeFilter` (null when no window was requested).

### search_messages

`channel`, `resolved`, `query`, `resultsCount`, `messages`, and `timeFilter` when a window was requested.

### Message object

Every message carries these fields (extra fields may appear; use `fields` to select a subset):

```json
{
  "id": 1234,
  "date": "2026-11-25T18:42:10.000Z",
  "timestamp": 1764086530,
  "sender": "Channel",
  "text": "Post text or media caption",
  "mediaType": "photo",
  "groupedId": "7616234891111920",
  "link": "https://t.me/examplechannel/1234",
  "forwardedFrom": "Some Channel",
  "views": 1520,
  "replyToMsgId": 1233
}
```

- `text` is the message text, or the media caption when present. Only messages without any text/caption get the `[Media/Non-text message]` placeholder.
- `mediaType`: `photo`, `image`, `video`, `animation`, `sticker`, `voice`, `audio`, `document`, `webpage`, `poll`, `location`, `contact`, `dice`, `game`, `invoice`, or `media`. Omitted for plain text.
- `groupedId` groups album (media group) items together; only one item of an album carries the caption.
- `link` is `https://t.me/<username>/<id>` for public channels and `https://t.me/c/<id>/<id>` for private ones (works for members); absent for groups and private chats.
- `forwardedFrom` is a best-effort description of the forward origin (visible source name, or `channel <id>` / `user <id>`, plus `via <author>` where available).
- `sender` is `"You"` for outgoing messages; for private chats the contact's name, otherwise `ID: <peer id>` or `"Channel"`.
- Private chats additionally carry `isOutgoing` (boolean) and `messageType` (`text` or `media`); channels/groups carry `views`.

### Output-shaping options

- `maxTextLength` truncates each `text` and adds `textTruncated: true` on truncated messages.
- `fields` projects every message onto the requested subset of: `id`, `date`, `timestamp`, `sender`, `text`, `messageType`, `isOutgoing`, `mediaType`, `groupedId`, `link`, `forwardedFrom`, `views`, `replyToMsgId`, `textTruncated`. Requested fields that do not apply come back as `null`.
- `excludeMedia` drops messages whose text is the `[Media/Non-text message]` placeholder (i.e. media without caption).

## Authentication Workflow

### Interactive Authentication (No TELEGRAM_SESSION set)

1. **First Use**: When you first try to use any Telegram function, you'll get an authorization prompt
2. **Phone Number**: Use `telegram_authorize` with your phone number
3. **Verification**: Use `telegram_verify_code` with the code sent to your phone
4. **2FA (if needed)**: Include your 2FA password in the verification step
5. **Session Storage**: The session is stored in memory for the duration of the MCP server session
6. **Logout**: Use `telegram_logout` to invalidate the session, or it will be lost when the server restarts

### Pre-configured Authentication (TELEGRAM_SESSION set)

1. **Automatic**: If `TELEGRAM_SESSION` environment variable is set, authentication is automatic
2. **No Prompts**: No need for interactive authorization
3. **Persistent**: Session persists across server restarts

## MCP Client Configuration

To use this server with an MCP client, add it to your client configuration:

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

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

For development with auto-reload:

```bash
npm run dev
```

To watch for changes and rebuild:

```bash
npm run watch
```

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

## Security Notes

- **Session Security**: Keep your session string secure. It provides full access to your Telegram account.
- **API Credentials**: Never share your API ID and hash publicly.
- **Channel Access**: The server can only access channels that your Telegram account has permission to read.
- **Rate Limiting**: Telegram has rate limits. The server doesn't implement rate limiting, so use responsibly.
- **Reporting vulnerabilities**: privately, see [SECURITY.md](SECURITY.md).

## Troubleshooting

1. **Authentication Errors**: 
   - If using interactive auth: Use `telegram_authorize` first, then `telegram_verify_code`
   - If using TELEGRAM_SESSION: Make sure your session string is valid and not expired
2. **Channel Access**: Ensure your account has access to the channels you're trying to read.
3. **API Limits**: If you encounter rate limits, wait before making more requests.
4. **Network Issues**: The server includes connection retry logic, but network issues may still cause failures.
5. **Mark Messages Read Issues**: 
   - If `mark_messages_read` returns success but messages aren't actually marked as read, use `get_chat_status` to debug
   - Some private chats may have restrictions on read status operations
   - Encrypted chats (secret chats) don't support read status marking via API
   - The function works best with regular groups and supergroups
6. **Session Issues**:
   - Interactive sessions are stored in memory and lost when the server restarts
   - For persistent sessions, set the TELEGRAM_SESSION environment variable
   - Use `telegram_logout` to clear the session if you encounter auth issues

### Authorization Troubleshooting

**"Authorization required" errors:**
1. Use `telegram_authorize` with your phone number
2. Use `telegram_verify_code` with the code from SMS
3. If you have 2FA, include your password in step 2

**"Invalid verification code":**
- Make sure you're entering the exact code from SMS
- Codes expire after a few minutes - request a new one if needed

**"2FA password required":**
- Include the `password` parameter in `telegram_verify_code`
- Make sure you're using your 2FA password, not your regular account password

### Debugging Read Status Issues

If `mark_messages_read` isn't working:

1. **Check chat status first:**
   ```
   "Get status information for my chat with @username"
   ```

2. **Verify chat type:** The tool shows whether the chat supports read status operations

3. **Check unread count:** Use `check_unread_messages` to see if the operation actually worked

4. **Try different approaches:** The server automatically tries multiple API methods for private chats

## License

[MIT](LICENSE)
