# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via
[GitHub Security Advisories](https://github.com/Maxsh/telegram-mcp/security/advisories/new).
Include affected version, reproduction steps and impact. You can expect an
initial response within 7 days.

## Handling credentials

This server acts as your Telegram user account. `TELEGRAM_SESSION` grants
full access to that account — treat it like a password:

- keep it in environment variables or a secret manager, never in git;
- never paste it into issues, PRs, logs or chat transcripts;
- revoke it in Telegram (Settings → Devices) if it leaks, or call
  `telegram_logout`.
