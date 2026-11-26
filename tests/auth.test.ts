import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  makeServer,
  channelEntity,
  descendingMessages,
  toolJson,
  toolError,
  type TestSetup,
} from "./fakes.js";

let t: TestSetup;
beforeEach(async () => {
  t = await makeServer();
});

describe("cleanup (session teardown)", () => {
  it("logs out and clears state for dynamic sessions", async () => {
    const fresh = await makeServer({ session: null });
    (fresh.server as any).client = fresh.client; // simulate an interactive session

    await fresh.server.cleanup();

    assert.equal(fresh.client.invocationsOf("auth.LogOut"), 1);
    assert.equal((fresh.server as any).client, null);
  });

  it("keeps static env sessions alive during cleanup", async () => {
    // TELEGRAM_SESSION is set -> not a dynamic session -> no logout, client kept
    await t.server.cleanup();
    assert.equal(t.client.invocationsOf("auth.LogOut"), 0);
    assert.equal((t.server as any).client, t.client);
  });
});

describe("dispatcher", () => {
  it("rejects unknown tools", async () => {
    const text = toolError(await t.server.handleToolCall("bogus_tool", {}));
    assert.match(text, /Unknown tool: bogus_tool/);
  });

  it("maps handler errors to isError results", async () => {
    const text = toolError(
      await t.server.handleToolCall("get_recent_messages", { channel: "@ghost" })
    );
    assert.match(text, /Failed to get messages from channel @ghost/);
  });
});

describe("authorization gating", () => {
  it("returns the auth-required response when no session exists", async () => {
    const fresh = await makeServer({ session: null });
    // stub the factory so no real GramJS client is constructed
    (fresh.server as any).createTelegramClient = () => fresh.client;

    const result = await fresh.server.handleToolCall("get_recent_messages", { channel: "@x" });
    const text = toolError(result);
    assert.match(text, /Authorization required/);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.authRequired, true);
  });

  it("treats a malformed TELEGRAM_SESSION like a missing session", async () => {
    const fresh = await makeServer({ session: "not-a-valid-session", injectClient: false });
    (fresh.server as any).createTelegramClient = () => fresh.client;

    const result = await fresh.server.handleToolCall("get_recent_messages", { channel: "@x" });
    const body = JSON.parse(result.content[0].text);
    assert.equal(result.isError, true);
    assert.equal(body.authRequired, true);
  });

  it("lazily initializes the client from TELEGRAM_SESSION on first use", async () => {
    const fresh = await makeServer({ injectClient: false }); // session set, client NOT injected
    (fresh.server as any).createTelegramClient = () => fresh.client;
    fresh.client.register(channelEntity({ id: 42, username: "testchannel" }));
    fresh.client.setMessages(42, descendingMessages(2, { latestEpochSec: 1764086500 }));

    const body = toolJson(
      await fresh.server.handleToolCall("get_recent_messages", { channel: "@testchannel", limit: 1 })
    );
    assert.equal(body.messagesCount, 1);
    assert.ok(fresh.client.calls.some((c) => c.method === "getMe"));
  });
});

describe("telegram_authorize", () => {
  beforeEach(() => {
    (t.server as any).createTelegramClient = () => t.client;
  });

  it("sends the code and stores the auth state", async () => {
    const body = toolJson(await t.server.handleToolCall("telegram_authorize", { phoneNumber: "+15551234567" }));
    assert.equal(body.success, true);
    assert.equal(t.client.phoneCodeHash, "test-hash");
    assert.equal(t.client.phoneNumber, "+15551234567");
    assert.equal((t.server as any).authorizationInProgress, true);
  });

  it("refuses to start twice", async () => {
    (t.server as any).authorizationInProgress = true;
    const text = toolError(await t.server.handleToolCall("telegram_authorize", { phoneNumber: "+15551234567" }));
    assert.match(text, /Authorization already in progress/);
  });

  it("maps PHONE_NUMBER_INVALID", async () => {
    t.client.on("auth.SendCode", () => {
      throw new Error("PHONE_NUMBER_INVALID");
    });
    const text = toolError(await t.server.handleToolCall("telegram_authorize", { phoneNumber: "bad" }));
    assert.match(text, /Invalid phone number/);
  });

  it("maps FLOOD_WAIT", async () => {
    t.client.on("auth.SendCode", () => {
      throw new Error("FLOOD_WAIT_5");
    });
    const text = toolError(await t.server.handleToolCall("telegram_authorize", { phoneNumber: "+15551234567" }));
    assert.match(text, /Rate limited/);
  });

  it("wraps unexpected errors", async () => {
    t.client.on("auth.SendCode", () => {
      throw new Error("boom");
    });
    const text = toolError(await t.server.handleToolCall("telegram_authorize", { phoneNumber: "+15551234567" }));
    assert.match(text, /Failed to start authorization: boom/);
  });
});

describe("telegram_verify_code", () => {
  beforeEach(() => {
    (t.server as any).createTelegramClient = () => t.client;
    (t.server as any).authorizationInProgress = true;
    t.client.phoneCodeHash = "test-hash";
    t.client.phoneNumber = "+15551234567";
  });

  it("signs in without 2FA and stores the session", async () => {
    const body = toolJson(await t.server.handleToolCall("telegram_verify_code", { code: "12345" }));
    assert.equal(body.success, true);
    assert.equal(body.user.username, "tester");
    assert.equal((t.server as any).dynamicSession, "fake-session-string");
    assert.equal((t.server as any).authorizationInProgress, false);
  });

  it("asks for the 2FA password when SESSION_PASSWORD_NEEDED", async () => {
    t.client.on("auth.SignIn", () => {
      throw new Error("SESSION_PASSWORD_NEEDED");
    });
    const text = toolError(await t.server.handleToolCall("telegram_verify_code", { code: "12345" }));
    assert.match(text, /2FA password required/);
  });

  it("maps PHONE_CODE_INVALID", async () => {
    t.client.on("auth.SignIn", () => {
      throw new Error("PHONE_CODE_INVALID");
    });
    const text = toolError(await t.server.handleToolCall("telegram_verify_code", { code: "wrong" }));
    assert.match(text, /Invalid verification code/);
  });

  it("maps PHONE_CODE_EXPIRED", async () => {
    t.client.on("auth.SignIn", () => {
      throw new Error("PHONE_CODE_EXPIRED");
    });
    const text = toolError(await t.server.handleToolCall("telegram_verify_code", { code: "12345" }));
    assert.match(text, /Verification code expired/);
  });

  it("rejects calls with no authorization in progress", async () => {
    const fresh = await makeServer();
    const text = toolError(await fresh.server.handleToolCall("telegram_verify_code", { code: "12345" }));
    assert.match(text, /No authorization in progress/);
  });
});

describe("telegram_logout", () => {
  it("logs out and clears state", async () => {
    const body = toolJson(await t.server.handleToolCall("telegram_logout", {}));
    assert.equal(body.success, true);
    assert.equal(t.client.invocationsOf("auth.LogOut"), 1);
    assert.equal((t.server as any).client, null);
    assert.equal((t.server as any).dynamicSession, null);
  });

  it("succeeds even with no client", async () => {
    (t.server as any).client = null;
    const body = toolJson(await t.server.handleToolCall("telegram_logout", {}));
    assert.equal(body.success, true);
  });

  it("reports a warning when the API logout fails but still clears state", async () => {
    t.client.on("auth.LogOut", () => {
      throw new Error("network gone");
    });
    const body = toolJson(await t.server.handleToolCall("telegram_logout", {}));
    assert.equal(body.success, true);
    assert.match(body.warning, /network gone/);
    assert.equal((t.server as any).client, null);
  });
});
