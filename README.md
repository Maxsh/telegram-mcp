# MCP Telegram Server

A Model Context Protocol (MCP) server that provides tools for interacting with Telegram channels, groups, and private conversations on behalf of a user. This server allows MCP clients to retrieve recent messages, search messages, get chat information, and manage conversations.

## Features

- **Dynamic Authorization**: Interactive authentication when no session is provided
- **Get Recent Messages**: Retrieve the most recent messages from channels, groups, or private chats
- **Get Private Messages**: Dedicated tool for reading private conversation messages with enhanced formatting
- **Search Messages**: Search for specific content within channels, groups, or private conversations
- **Get Chat Info**: Retrieve metadata and information about any Telegram chat (channels, groups, private)
- **Get Available Channels**: List all channels and groups that the user has access to
- **Mark Messages as Read**: Mark specific messages or all messages as read in conversations
- **Check Unread Messages**: Find chats with unread messages in private conversations and groups
- **Get Chat Status**: Diagnostic tool to check read status and chat capabilities
- **Session Management**: Automatic logout and session invalidation support
- **User Authentication**: Works on behalf of the authenticated user (not bot tokens)

## Prerequisites

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
npm install
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

### 2. Generate Session String (Optional)

To generate a session string, you can create a simple script:

```typescript
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = parseInt(process.env.TELEGRAM_API_ID!);
const apiHash = process.env.TELEGRAM_API_HASH!;

const session = new StringSession("");
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

(async () => {
  await client.start({
    phoneNumber: async () => await input.text("Enter your phone number: "),
    password: async () => await input.text("Enter your password: "),
    phoneCode: async () => await input.text("Enter the code you received: "),
    onError: (err) => console.log(err),
  });
  
  console.log("Session string:", client.session.save());
  console.log("Save this session string as TELEGRAM_SESSION environment variable");
  
  await client.disconnect();
})();
```

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
- `channel` (string, required): Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID
- `limit` (number, optional): Number of messages to retrieve (default: 10, max: 100)
- `sinceMinutes` (number, optional): Get messages from the last N minutes
- `sinceHours` (number, optional): Get messages from the last N hours
- `sinceDate` (string, optional): Get messages since this date (ISO format: 2023-12-01T10:00:00Z)

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

Get messages from a private chat:
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@username",
    "limit": 15
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

#### 2. get_private_messages

Dedicated tool for retrieving messages from private chat conversations with enhanced formatting.

**Parameters:**
- `contact` (string, required): Contact identifier: username (@username), phone number (+1234567890), or user ID
- `limit` (number, optional): Number of messages to retrieve (default: 10, max: 100)
- `sinceMinutes` (number, optional): Get messages from the last N minutes
- `sinceHours` (number, optional): Get messages from the last N hours
- `sinceDate` (string, optional): Get messages since this date (ISO format: 2023-12-01T10:00:00Z)

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

#### 3. get_channel_info

Retrieves information about a Telegram channel, group, or private chat.

**Parameters:**
- `channel` (string, required): Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID

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

#### 4. search_messages

Searches for messages containing specific text in a channel, group, or private chat.

**Parameters:**
- `channel` (string, required): Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID
- `query` (string, required): Search query
- `limit` (number, optional): Number of results (default: 10, max: 100)
- `sinceMinutes` (number, optional): Search messages from the last N minutes
- `sinceHours` (number, optional): Search messages from the last N hours
- `sinceDate` (string, optional): Search messages since this date (ISO format: 2023-12-01T10:00:00Z)

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

#### 5. get_available_channels

Lists all channels and groups that the user has access to.

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

#### 6. mark_messages_read

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

#### 7. check_unread_messages

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

#### 8. get_chat_status

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

#### 9. telegram_authorize

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

#### 10. telegram_verify_code

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

#### 11. telegram_logout

Logout from Telegram and invalidate the current session.

**Example:**
```json
{
  "name": "telegram_logout",
  "arguments": {}
}
```

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

## Security Notes

- **Session Security**: Keep your session string secure. It provides full access to your Telegram account.
- **API Credentials**: Never share your API ID and hash publicly.
- **Channel Access**: The server can only access channels that your Telegram account has permission to read.
- **Rate Limiting**: Telegram has rate limits. The server doesn't implement rate limiting, so use responsibly.

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

MIT License
