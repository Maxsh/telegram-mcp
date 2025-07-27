# Testing Enhanced Session Cleanup

## What Was Fixed

1. **Multiple Cleanup Triggers**: Added process-level signal handlers that guarantee cleanup runs
2. **Transport Disconnection**: Enhanced to force process exit after cleanup
3. **Aggressive Logout**: Ensures `Api.auth.LogOut()` is called and client is disconnected
4. **Public Cleanup Method**: Made cleanup accessible for external cleanup calls

## Enhanced Cleanup Mechanisms

### 1. Process-Level Handlers
- `SIGINT` (Ctrl+C)
- `SIGTERM` (termination signal)
- `exit` event
- Uncaught exceptions
- Unhandled promise rejections

### 2. Transport-Level Handlers
- MCP transport disconnection
- Forces process exit after cleanup

### 3. Session-Aware Cleanup
- Only logs out dynamic sessions (not environment-based)
- Clears session timeout
- Properly disconnects Telegram client

## How to Test

1. **Start the MCP server** with your Telegram credentials
2. **Authenticate** using `telegram_authorize` and `telegram_verify_code`
3. **Check active sessions** on another device (Telegram Settings → Privacy and Security → Active Sessions)
4. **Quit Gemini CLI** abruptly (close terminal, Ctrl+C, etc.)
5. **Verify the session disappears** from active sessions within a few seconds

## Expected Behavior

✅ **Before Fix**: Session would remain active even after quitting Gemini CLI
✅ **After Fix**: Session should disappear from active sessions when Gemini CLI exits

## Debug Logs

You should see logs like:
```
MCP transport disconnected, cleaning up...
Telegram session logged out and disconnected
Cleanup completed, exiting process...
```

## Fallback Scenarios

Even if the primary cleanup fails:
- Local session state is always cleared
- Process will exit cleanly
- Next startup will require re-authentication

The server now guarantees that Telegram sessions don't persist beyond the MCP session lifecycle.
