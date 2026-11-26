#!/usr/bin/env node

// Suppress all console output to prevent JSON corruption in MCP communication
const originalConsole = console;
console.log = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};
console.trace = () => {};
// Keep console.error suppressed except for critical errors
const originalError = console.error;
console.error = () => {};

// Suppress process warnings and set environment variables to disable logging
process.removeAllListeners('warning');
process.env.NODE_NO_WARNINGS = '1';
process.env.TELEGRAM_CLIENT_LOGGER_DISABLED = '1';
process.env.DEBUG = '';

// The server class lives in server.ts (importable without side effects so it
// can be unit-tested); this entry point only wires it to stdio.
import { TelegramMCPServer } from "./server.js";

const server = new TelegramMCPServer();

// Enhanced cleanup on process exit
process.on('exit', async () => {
  // Process exiting - console.error removed to prevent JSON corruption
  await server.cleanup();
});

process.on('SIGINT', async () => {
  // Received SIGINT - console.error removed to prevent JSON corruption
  await server.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  // Received SIGTERM - console.error removed to prevent JSON corruption
  await server.cleanup();
  process.exit(0);
});

server.start().catch((error) => {
  // Failed to start server - console.error removed to prevent JSON corruption
  process.exit(1);
});
