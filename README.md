# MCP Telegram Server

A Model Context Protocol (MCP) server that provides tools for interacting with Telegram channels on behalf of a user. This server allows MCP clients to retrieve recent messages, search messages, and get channel information.

## Features

- **Get Recent Messages**: Retrieve the most recent messages from a Telegram channel
- **Search Messages**: Search for specific content within a channel's messages
- **Get Channel Info**: Retrieve metadata and information about a Telegram channel
- **Get Available Channels**: List all channels and groups that the user has access to
- **User Authentication**: Works on behalf of the authenticated user (not bot tokens)

## Prerequisites

1. **Telegram API Credentials**: You need to obtain API credentials from Telegram:
   - Go to https://my.telegram.org/apps
   - Log in with your phone number
   - Create a new application to get `api_id` and `api_hash`

2. **User Session**: You need to generate a session string for user authentication (see setup instructions below)

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
export TELEGRAM_SESSION="your_session_string"
```

### 2. Generate Session String

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

Retrieves recent messages from a Telegram channel.

**Parameters:**
- `channel` (string, required): Channel username (e.g., "@channelname") or channel ID
- `limit` (number, optional): Number of messages to retrieve (default: 10, max: 100)

**Example:**
```json
{
  "name": "get_recent_messages",
  "arguments": {
    "channel": "@examplechannel",
    "limit": 20
  }
}
```

#### 2. get_channel_info

Retrieves information about a Telegram channel.

**Parameters:**
- `channel` (string, required): Channel username or channel ID

**Example:**
```json
{
  "name": "get_channel_info",
  "arguments": {
    "channel": "@examplechannel"
  }
}
```

#### 3. search_messages

Searches for messages containing specific text in a channel.

**Parameters:**
- `channel` (string, required): Channel username or channel ID
- `query` (string, required): Search query
- `limit` (number, optional): Number of results (default: 10, max: 100)

**Example:**
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

#### 4. get_available_channels

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

1. **Authentication Errors**: Make sure your session string is valid and not expired.
2. **Channel Access**: Ensure your account has access to the channels you're trying to read.
3. **API Limits**: If you encounter rate limits, wait before making more requests.
4. **Network Issues**: The server includes connection retry logic, but network issues may still cause failures.

## License

MIT License
