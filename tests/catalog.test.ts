import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { TelegramMCPServer } from "../src/server.js";
import { makeServer, toolError, type TestSetup } from "./fakes.js";

const EXPECTED_TOOLS = [
  "get_recent_messages",
  "get_messages_multi",
  "get_channel_info",
  "search_messages",
  "get_available_channels",
  "mark_messages_read",
  "check_unread_messages",
  "get_private_messages",
  "get_chat_status",
  "telegram_authorize",
  "telegram_verify_code",
  "telegram_logout",
];

process.env.TELEGRAM_API_ID = "12345";
process.env.TELEGRAM_API_HASH = "test-hash";
process.env.TELEGRAM_SESSION = "unit-test-catalog";
const catalog = (new TelegramMCPServer() as any).buildToolCatalog();

let t: TestSetup;
beforeEach(async () => {
  t = await makeServer();
});

describe("tool catalog (buildToolCatalog)", () => {
  it("advertises every tool in the documented order", () => {
    assert.deepEqual(catalog.map((tool: any) => tool.name), EXPECTED_TOOLS);
  });

  it("gives every tool a description and an object input schema", () => {
    for (const tool of catalog) {
      assert.ok(tool.description?.length > 10, `${tool.name} needs a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema must be an object`);
      assert.ok(Array.isArray(tool.inputSchema.required), `${tool.name} must declare required fields`);
    }
  });

  it("keeps get_recent_messages in sync with the zod schema", () => {
    const schema = catalog.find((tool: any) => tool.name === "get_recent_messages").inputSchema;
    assert.deepEqual(schema.required, ["channel"]);
    for (const prop of ["channel", "limit", "offsetId", "sinceMinutes", "sinceHours", "sinceDate", "tz", "maxTextLength", "fields", "excludeMedia"]) {
      assert.ok(schema.properties[prop], `get_recent_messages.inputSchema must declare ${prop}`);
    }
    assert.equal(schema.properties.limit.maximum, 100);
  });

  it("keeps get_messages_multi in sync", () => {
    const schema = catalog.find((tool: any) => tool.name === "get_messages_multi").inputSchema;
    assert.deepEqual(schema.required, ["channels"]);
    assert.equal(schema.properties.channels.items.type, "string");
    assert.equal(schema.properties.channels.maxItems, 25);
    assert.equal(schema.properties.limit.maximum, 100);
  });

  it("declares the new search/private parameters", () => {
    const search = catalog.find((tool: any) => tool.name === "search_messages").inputSchema;
    for (const prop of ["offsetId", "tz", "maxTextLength"]) {
      assert.ok(search.properties[prop], `search_messages must declare ${prop}`);
    }
    const priv = catalog.find((tool: any) => tool.name === "get_private_messages").inputSchema;
    assert.deepEqual(priv.required, ["contact"]);
    assert.ok(priv.properties.offsetId);
    assert.ok(priv.properties.tz);
  });
});

describe("dispatch contract", () => {
  it("dispatches every advertised tool name (never 'Unknown tool')", async () => {
    for (const name of EXPECTED_TOOLS) {
      // empty args: some tools error (missing required params), some succeed —
      // the contract is only that the name is dispatched, not unknown.
      const result = await t.server.handleToolCall(name, {});
      const text = result.content[0].text;
      assert.ok(typeof text === "string", `${name} must return text content`);
      assert.doesNotMatch(text, new RegExp(`Unknown tool: ${name}`), `${name} must be dispatched`);
    }
  });

  it("rejects names that are not in the catalog", async () => {
    const text = toolError(await t.server.handleToolCall("not_a_tool", {}));
    assert.match(text, /Unknown tool: not_a_tool/);
  });
});

describe("constructor", () => {
  it("requires TELEGRAM_API_ID and TELEGRAM_API_HASH", () => {
    const savedId = process.env.TELEGRAM_API_ID;
    const savedHash = process.env.TELEGRAM_API_HASH;
    try {
      delete process.env.TELEGRAM_API_ID;
      delete process.env.TELEGRAM_API_HASH;
      assert.throws(() => new TelegramMCPServer(), /TELEGRAM_API_ID and TELEGRAM_API_HASH/);
    } finally {
      process.env.TELEGRAM_API_ID = savedId!;
      process.env.TELEGRAM_API_HASH = savedHash!;
    }
  });

  it("registers crash handlers for uncaught exceptions and rejections", () => {
    const beforeExceptions = process.listenerCount("uncaughtException");
    const beforeRejections = process.listenerCount("unhandledRejection");
    new TelegramMCPServer();
    assert.ok(process.listenerCount("uncaughtException") > beforeExceptions);
    assert.ok(process.listenerCount("unhandledRejection") > beforeRejections);
  });
});
