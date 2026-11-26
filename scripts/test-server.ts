#!/usr/bin/env node

import { spawn } from "child_process";
import * as path from "path";

// Simple test to verify the MCP server starts and responds to basic requests
async function testServer() {
  console.log("Testing MCP Telegram Server...\n");

  const serverPath = path.join(process.cwd(), "dist", "index.js");
  
  console.log(`Starting server at: ${serverPath}`);
  
  // Start the server
  const server = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // These would need to be set for a real test
      TELEGRAM_API_ID: "test",
      TELEGRAM_API_HASH: "test",
      TELEGRAM_SESSION: "test"
    }
  });

  let output = "";
  let errorOutput = "";

  server.stdout.on("data", (data) => {
    output += data.toString();
  });

  server.stderr.on("data", (data) => {
    errorOutput += data.toString();
    console.log("Server stderr:", data.toString());
  });

  // Send a list tools request
  const listToolsRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  };

  setTimeout(() => {
    console.log("\nSending list tools request...");
    server.stdin.write(JSON.stringify(listToolsRequest) + "\n");
  }, 1000);

  // Wait for response
  setTimeout(() => {
    console.log("\nServer output:", output.slice(0, 300) + (output.length > 300 ? "..." : ""));
    server.kill();

    // The server suppresses stderr (commit 876e5c8) to keep stdio JSON clean,
    // so success is checked by the tools/list response on stdout.
    if (output.includes('"tools"') && output.includes("get_recent_messages")) {
      console.log("✅ Server started successfully and answered tools/list!");
    } else {
      console.log("❌ Server may have issues starting");
    }
  }, 3000);
}

testServer().catch(console.error);
