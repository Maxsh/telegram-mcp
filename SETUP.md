# MCP Telegram Server Setup Guide

This guide will walk you through setting up the MCP Telegram Server step by step.

## Step 1: Get Telegram API Credentials

1. Visit https://my.telegram.org/apps
2. Log in with your phone number
3. Click "Create application"
4. Fill in the required fields:
   - App title: "MCP Telegram Server" (or any name you prefer)
   - Short name: "mcp-tg" (or any short identifier)
   - Platform: Choose "Other"
5. Save your `api_id` and `api_hash` - you'll need these later

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Generate Session String

Run the session generator script:

```bash
npm run generate-session
```

Follow the prompts:
1. Enter your API ID (from step 1)
2. Enter your API Hash (from step 1)
3. Enter your phone number with country code (e.g., +1234567890)
4. Enter the verification code sent to your phone
5. If you have 2FA enabled, enter your password

Save the generated session string - you'll need it for the next step.

## Step 4: Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit the `.env` file and fill in your credentials:

```env
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here
TELEGRAM_SESSION=your_session_string_here
```

## Step 5: Build the Project

```bash
npm run build
```

## Step 6: Test the Server

You can test if the server works by running:

```bash
npm test
```

Or start it manually:

```bash
npm start
```

## Step 7: Configure MCP Client

### For Claude Desktop

Add the following to your Claude Desktop configuration file:

**Location of config file:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Configuration:**

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/full/path/to/mcp-telegram-server/dist/index.js"],
      "env": {
        "TELEGRAM_API_ID": "your_api_id",
        "TELEGRAM_API_HASH": "your_api_hash",
        "TELEGRAM_SESSION": "your_session_string"
      }
    }
  }
}
```

Replace `/full/path/to/mcp-telegram-server/` with the actual full path to your project directory.

### For Other MCP Clients

Refer to your MCP client's documentation for configuration. The server communicates via stdio and provides the following tools:

- `get_recent_messages`: Get recent messages from channels, groups, or private chats
- `get_private_messages`: Get messages from private conversations with enhanced formatting
- `get_channel_info`: Get information about channels, groups, or private chats
- `search_messages`: Search for messages in channels, groups, or private chats
- `get_available_channels`: List all available channels and groups
- `mark_messages_read`: Mark messages as read in groups/supergroups/private chats (not broadcast channels)
- `check_unread_messages`: Check for unread messages in private chats and groups

## Step 8: Usage Examples

Once configured, you can use the following prompts with your MCP client:

1. **Get available channels:**
   "Show me all the channels I have access to"

2. **Get recent messages:**
   "Get the 20 most recent messages from @examplechannel"
   "Get messages from @examplechannel from the last 30 minutes"
   "Get messages from @examplechannel from the last 2 hours"
   "Get recent messages from my conversation with @username"

3. **Get private messages:**
   "Get my recent conversation with @username"
   "Show me the last 15 messages from +1234567890"
   "Get private messages from @contact from the last hour"

4. **Search messages:**
   "Search for messages containing 'announcement' in @examplechannel"
   "Search for 'update' messages in @examplechannel from the last hour"
   "Search for 'meeting' in my chat with @username"

5. **Get chat info:**
   "Get information about @examplechannel"
   "Get information about my conversation with @username"

6. **Mark messages as read (groups and private chats):**
   "Mark all messages as read in @examplegroup"
   "Mark messages with IDs 123, 124, 125 as read in @examplegroup"
   "Mark all messages as read in my chat with @username"

7. **Check for unread messages:**
   "Check for unread messages in my chats"
   "Show me all chats with unread messages"
   "Check unread messages including channels"

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors during build:**
   - Make sure you've run `npm install`

2. **Authentication errors:**
   - Verify your API credentials are correct
   - Make sure your session string is valid and not expired
   - Try regenerating the session string

3. **"Channel not found" errors:**
   - Make sure you have access to the channel
   - Try using the channel ID instead of username
   - Ensure the channel username includes the @ symbol

4. **Permission denied errors:**
   - The server can only access channels your account can read
   - Make sure you're subscribed to public channels or have been added to private channels

### Debug Mode

To see detailed error messages, you can run the server in development mode:

```bash
npm run dev
```

This will show more detailed logging information.

### Getting Channel IDs

If you're having trouble with channel usernames, you can find the channel ID by:

1. Opening the channel in Telegram Web
2. Looking at the URL - the number after "c/" is the channel ID
3. Use the negative of this number (e.g., if URL shows 1234567, use -1234567)

## Security Notes

- Keep your API credentials and session string secure
- The session string provides full access to your Telegram account
- Don't share these credentials or commit them to version control
- Consider using environment variables or secure secret management in production

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify your setup following this guide
3. Check the server logs for error messages
4. Ensure your Telegram account has proper permissions for the channels you're trying to access
