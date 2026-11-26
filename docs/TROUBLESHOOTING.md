# Troubleshooting

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

## Authorization issues

**"Authorization required" errors:**
1. Use `telegram_authorize` with your phone number
2. Use `telegram_verify_code` with the code from SMS
3. If you have 2FA, include your password in step 2

**"Invalid verification code":**
- Make sure you're entering the exact code from SMS
- Codes expire after a few minutes — request a new one if needed

**"2FA password required":**
- Include the `password` parameter in `telegram_verify_code`
- Make sure you're using your 2FA password, not your regular account password

## Debugging read status issues

If `mark_messages_read` isn't working:

1. **Check chat status first:**
   ```
   "Get status information for my chat with @username"
   ```

2. **Verify chat type:** The tool shows whether the chat supports read status operations

3. **Check unread count:** Use `check_unread_messages` to see if the operation actually worked

4. **Try different approaches:** The server automatically tries multiple API methods for private chats
