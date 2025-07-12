#!/usr/bin/env node

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function generateSession() {
  try {
    console.log("Telegram Session Generator");
    console.log("=========================\n");

    // Get API credentials from environment variables
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiId || !apiHash) {
      console.error("❌ TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables are required!");
      console.error("Please set them in your .env file or export them in your shell:");
      console.error("  export TELEGRAM_API_ID=your_api_id");
      console.error("  export TELEGRAM_API_HASH=your_api_hash");
      process.exit(1);
    }

    console.log(`✅ Using API ID: ${apiId}`);
    console.log(`✅ Using API Hash: ${apiHash.substring(0, 8)}...`);
    console.log();

    const session = new StringSession("");
    const client = new TelegramClient(session, parseInt(apiId), apiHash, {
      connectionRetries: 5,
    });

    console.log("\nConnecting to Telegram...");

    await client.start({
      phoneNumber: async () => {
        return await question("Enter your phone number (with country code, e.g., +1234567890): ");
      },
      password: async () => {
        return await question("Enter your 2FA password (if enabled): ");
      },
      phoneCode: async () => {
        return await question("Enter the verification code sent to your phone: ");
      },
      onError: (err: Error) => {
        console.error("Authentication error:", err.message);
      },
    });

    const sessionString = client.session.save();
    
    console.log("\n✅ Authentication successful!");
    console.log("\n📝 Your session string:");
    console.log("=" .repeat(50));
    console.log(sessionString);
    console.log("=" .repeat(50));
    
    console.log("\n🔒 Security Notes:");
    console.log("- Keep this session string secure and private");
    console.log("- Add it to your .env file as TELEGRAM_SESSION");
    console.log("- Do not share this string with anyone");
    console.log("- This string gives full access to your Telegram account");

    await client.disconnect();
    rl.close();

  } catch (error) {
    console.error("\n❌ Error generating session:", error);
    rl.close();
    process.exit(1);
  }
}

generateSession();
