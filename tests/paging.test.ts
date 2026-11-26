import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  makeServer,
  channelEntity,
  userEntity,
  descendingMessages,
  mediaPhoto,
  toolJson,
  toolError,
  type TestSetup,
} from "./fakes.js";

const TZ = "Europe/Kyiv";
// 2026-11-26 local midnight in Kyiv (UTC+2 in winter)
const KYIV_MIDNIGHT_EPOCH = Math.floor(Date.parse("2026-11-25T22:00:00Z") / 1000);

let t: TestSetup;
beforeEach(async () => {
  t = await makeServer();
});

describe("resolveEntitySmart", () => {
  it("resolves @username directly", async () => {
    t.client.register(channelEntity({ id: 1496296645, username: "olegsharp" }));
    const entity = await (t.server as any).resolveEntitySmart("@olegsharp");
    assert.equal(entity.id, 1496296645);
    assert.deepEqual(t.client.entityCalls(), ["@olegsharp"]);
  });

  it("resolves a bare channel id via the -100 form, not as a user", async () => {
    t.client.register(channelEntity({ id: 1496296645, username: "olegsharp" }));
    const entity = await (t.server as any).resolveEntitySmart("1496296645");
    assert.equal(entity.className, "Channel");
    assert.equal(entity.id, 1496296645);
    // GramJS treats bare digits as user ids, so the -100 form must be tried
    assert.deepEqual(t.client.entityCalls(), ["1496296645", "-1001496296645"]);
  });

  it("resolves a -100-prefixed id directly", async () => {
    t.client.register(channelEntity({ id: 1496296645 }));
    const entity = await (t.server as any).resolveEntitySmart("-1001496296645");
    assert.equal(entity.id, 1496296645);
    assert.deepEqual(t.client.entityCalls(), ["-1001496296645"]);
  });

  it("resolves a bare user id as a user (first attempt)", async () => {
    t.client.register(userEntity({ id: 200, username: "alice" }));
    const entity = await (t.server as any).resolveEntitySmart("200");
    assert.equal(entity.className, "User");
  });

  it("errors loudly when nothing resolves", async () => {
    await assert.rejects(
      () => (t.server as any).resolveEntitySmart("9999999999"),
      /Could not resolve "9999999999"/
    );
    // tried bare, -100 and - forms before giving up
    assert.deepEqual(t.client.entityCalls(), ["9999999999", "-1009999999999", "-9999999999"]);
  });
});

describe("fetchMessageWindow", () => {
  it("returns exactly limit messages and hasMore=true on a busy channel (no cutoff)", async () => {
    t.client.register(channelEntity({ id: 42 }));
    t.client.setMessages(42, descendingMessages(250, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600 }));

    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 10 });
    assert.equal(w.collected.length, 10);
    assert.equal(w.hasMore, true);
    assert.equal(w.nextOffsetId, 5000 - 9);
    assert.equal(w.newestMessageDate, new Date((KYIV_MIDNIGHT_EPOCH + 3600) * 1000).toISOString());
  });

  it("flags exhaustion when the channel runs dry (no cutoff)", async () => {
    t.client.register(channelEntity({ id: 42 }));
    t.client.setMessages(42, descendingMessages(3, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600 }));

    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 10 });
    assert.equal(w.collected.length, 3);
    assert.equal(w.hasMore, false);
  });

  it("stops at the cutoff and reports hasMore=false even mid-batch", async () => {
    t.client.register(channelEntity({ id: 42 }));
    // latest = cutoff + 1795s, step 60s -> messages 0..29 in-window, 30..39 beyond
    const msgs = descendingMessages(40, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 1795, stepSec: 60 });
    t.client.setMessages(42, msgs);

    const cutoff = new Date(KYIV_MIDNIGHT_EPOCH * 1000);
    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 100, cutoffDate: cutoff });

    assert.equal(w.collected.length, 30);
    assert.equal(w.hasMore, false);
    assert.equal(w.nextOffsetId, 5000 - 29);
    // every collected message is within the window
    assert.ok(w.collected.every((m: any) => m.date * 1000 >= cutoff.getTime()));
  });

  it("reports hasMore when a short batch holds more in-window messages than the limit", async () => {
    // regression: a short batch (< page size) that still contains more in-window
    // messages than the limit must not be reported as exhausted
    t.client.register(channelEntity({ id: 42 }));
    const msgs = descendingMessages(28, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600, stepSec: 100 });
    t.client.setMessages(42, msgs);

    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 10, cutoffDate: new Date(KYIV_MIDNIGHT_EPOCH * 1000) });
    assert.equal(w.collected.length, 10);
    assert.equal(w.hasMore, true);
    assert.equal(w.nextOffsetId, 5000 - 9);
  });

  it("pages across batches via offsetId until the cutoff, without duplicates", async () => {
    t.client.register(channelEntity({ id: 42 }));
    // latest = cutoff + 7480s, step 30s -> 250 in-window messages, 5 older
    const msgs = descendingMessages(255, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 7480, stepSec: 30 });
    t.client.setMessages(42, msgs);

    const cutoff = new Date(KYIV_MIDNIGHT_EPOCH * 1000);
    const all: any[] = [];
    let offsetId: number | undefined;
    let pages = 0;
    let last = null as any;
    for (;;) {
      const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 100, offsetId, cutoffDate: cutoff });
      last = w;
      pages++;
      all.push(...w.collected);
      if (!w.hasMore || !w.nextOffsetId) break;
      offsetId = w.nextOffsetId;
    }
    const ids = new Set(all.map((m) => m.id));
    // pages 1-2 fill the 100-message limit; page 3 consumes its 50 remaining
    // in-window messages and crosses the cutoff, so it stops cleanly
    assert.equal(pages, 3);
    assert.equal(all.length, 250);
    assert.equal(ids.size, 250);
    assert.equal(last.collected.length, 50);
    assert.equal(last.hasMore, false);
    // strictly descending, no overlap between pages
    assert.ok(all.every((m, i) => i === 0 || all[i - 1].id > m.id));
  });

  it("starts older than a caller-provided offsetId", async () => {
    t.client.register(channelEntity({ id: 42 }));
    t.client.setMessages(42, descendingMessages(50, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600 }));

    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 5, offsetId: 4995 });
    assert.deepEqual(w.collected.map((m: any) => m.id), [4994, 4993, 4992, 4991, 4990]);
    assert.equal(w.hasMore, true);
  });

  it("reports lastMessageDate even when the whole window is empty (dead channel)", async () => {
    t.client.register(channelEntity({ id: 42 }));
    // newest post is 2 days before the cutoff
    const msgs = descendingMessages(3, { latestEpochSec: KYIV_MIDNIGHT_EPOCH - 2 * 86400 });
    t.client.setMessages(42, msgs);

    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 10, cutoffDate: new Date(KYIV_MIDNIGHT_EPOCH * 1000) });
    assert.equal(w.collected.length, 0);
    assert.equal(w.hasMore, false);
    assert.equal(w.newestMessageDate, new Date((KYIV_MIDNIGHT_EPOCH - 2 * 86400) * 1000).toISOString());
  });

  it("caps runaway paging at 50 pages (5000 messages)", async () => {
    t.client.register(channelEntity({ id: 42 }));
    t.client.setMessages(42, descendingMessages(5100, { startId: 5100, latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600, stepSec: 5 }));

    // limit larger than one page exercises the MAX_PAGES safety net directly
    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 5000, cutoffDate: new Date(0) });
    assert.equal(w.collected.length, 5000);
    assert.equal(w.hasMore, true);
    assert.equal(w.nextOffsetId, 101); // 5100 - 4999: ready to continue where it stopped
  });

  it("returns null nextOffsetId for a completely empty channel", async () => {
    t.client.register(channelEntity({ id: 42 }));
    const w = await (t.server as any).fetchMessageWindow({ id: 42 }, { limit: 10, cutoffDate: new Date(KYIV_MIDNIGHT_EPOCH * 1000) });
    assert.equal(w.collected.length, 0);
    assert.equal(w.hasMore, false);
    assert.equal(w.nextOffsetId, null);
    assert.equal(w.newestMessageDate, null);
  });
});

describe("get_recent_messages", () => {
  beforeEach(() => {
    t.client.register(channelEntity({ id: 1496296645, username: "olegsharp", title: "Oleg Sharp" }));
    const msgs = descendingMessages(28, {
      startId: 220581,
      latestEpochSec: KYIV_MIDNIGHT_EPOCH + 7200,
      stepSec: 240, // 28 * 240s span < window, so every message is in-window
      each: (i, m) => {
        if (i % 3 === 0) {
          m.media = mediaPhoto(); // captionless media -> "[Media/Non-text message]"
        } else {
          m.message = `post ${i}`;
          m.text = `post ${i}`;
        }
        m.views = 100 + i;
      },
    });
    t.client.setMessages(1496296645, msgs);
  });

  it("returns the documented response shape with compact JSON", async () => {
    const result = await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 5 });
    assert.ok(!result.content[0].text.includes("\n"), "response JSON must be compact");
    const body = toolJson(result);

    assert.equal(body.channel, "Oleg Sharp");
    assert.deepEqual(body.resolved, {
      id: "1496296645",
      peer: "-1001496296645",
      title: "Oleg Sharp",
      username: "@olegsharp",
      type: "channel",
    });
    assert.equal(body.messagesCount, 5);
    assert.equal(body.messages.length, 5);
    assert.equal(body.hasMore, true);
    assert.equal(body.nextOffsetId, 220581 - 4);
    assert.equal(typeof body.lastMessageDate, "string");
    assert.equal(body.timeFilter, undefined);
  });

  it("paginates through the whole window via nextOffsetId without duplicates", async () => {
    const all: any[] = [];
    let offsetId: number | undefined;
    let calls = 0;
    for (;;) {
      const body = toolJson(
        await t.server.handleToolCall("get_recent_messages", {
          channel: "-1001496296645", limit: 10, offsetId, sinceDate: "today", tz: TZ,
        })
      );
      calls++;
      all.push(...body.messages);
      if (!body.hasMore) {
        assert.equal(body.timeFilter.tz, TZ);
        break;
      }
      offsetId = body.nextOffsetId;
    }
    assert.equal(calls, 3);
    assert.equal(all.length, 28);
    assert.equal(new Set(all.map((m: any) => m.id)).size, 28);
  });

  it("reports an empty window with lastMessageDate for a dead channel", async () => {
    const dead = channelEntity({ id: 1388884611, username: "kyiv_tviy", title: "Kyiv Live" });
    t.client.register(dead);
    t.client.setMessages(1388884611, descendingMessages(1, { latestEpochSec: Date.parse("2025-09-27T23:18:26Z") / 1000 }));

    const body = toolJson(
      await t.server.handleToolCall("get_recent_messages", { channel: "@kyiv_tviy", sinceDate: "today", tz: TZ, limit: 10 })
    );
    assert.equal(body.messagesCount, 0);
    assert.equal(body.lastMessageDate, "2025-09-27T23:18:26.000Z");
    assert.equal(body.hasMore, false);
  });

  it("bare id and -100 id resolve to the same channel", async () => {
    const bare = toolJson(await t.server.handleToolCall("get_recent_messages", { channel: "1496296645", limit: 1 }));
    const prefixed = toolJson(await t.server.handleToolCall("get_recent_messages", { channel: "-1001496296645", limit: 1 }));
    assert.equal(bare.resolved.peer, prefixed.resolved.peer);
    assert.equal(bare.resolved.type, "channel");
  });

  it("errors loudly on an unresolvable channel instead of returning 0 messages", async () => {
    const text = toolError(
      await t.server.handleToolCall("get_recent_messages", { channel: "-1009999999999", limit: 1 })
    );
    assert.match(text, /Could not resolve/);
  });

  it("applies maxTextLength with the truncation flag", async () => {
    const body = toolJson(
      await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 5, maxTextLength: 3 })
    );
    assert.ok(body.messages.every((m: any) => m.text.length <= 3));
    assert.ok(body.messages.every((m: any) => m.textTruncated === true));
  });

  it("applies fields projection", async () => {
    const body = toolJson(
      await t.server.handleToolCall("get_recent_messages", {
        channel: "@olegsharp", limit: 3, fields: ["id", "date", "text", "link"],
      })
    );
    assert.deepEqual(Object.keys(body.messages[0]).sort(), ["date", "id", "link", "text"]);
  });

  it("applies excludeMedia", async () => {
    const withMedia = toolJson(
      await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 28 })
    );
    assert.ok(withMedia.messages.some((m: any) => m.text === "[Media/Non-text message]"));

    const without = toolJson(
      await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 28, excludeMedia: true })
    );
    assert.ok(without.messages.every((m: any) => m.text !== "[Media/Non-text message]"));
    assert.equal(without.messagesCount, without.messages.length);
  });

  it("rejects limit over 100 and unknown fields via zod/validation", async () => {
    assert.ok(
      (await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 500 })).isError
    );
    assert.ok(
      (await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", fields: ["nope"] })).isError
    );
  });

  it("carries the tz echo in timeFilter for date-only windows", async () => {
    const body = toolJson(
      await t.server.handleToolCall("get_recent_messages", { channel: "@olegsharp", limit: 1, sinceDate: "today", tz: TZ })
    );
    assert.equal(body.timeFilter.tz, "Europe/Kyiv");
    assert.equal(body.timeFilter.since, "2026-11-25T22:00:00.000Z");
  });
});

describe("get_private_messages", () => {
  it("returns the private-chat response shape and paginates", async () => {
    t.client.register(userEntity({ id: 200, firstName: "Alice", lastName: "Smith", username: "alice" }));
    t.client.setMessages(
      200,
      descendingMessages(15, { latestEpochSec: KYIV_MIDNIGHT_EPOCH + 3600, each: (i, m) => { m.message = `msg ${i}`; m.text = `msg ${i}`; } })
    );

    const first = toolJson(
      await t.server.handleToolCall("get_private_messages", { contact: "@alice", limit: 10 })
    );
    assert.equal(first.success, true);
    assert.equal(first.contact, "Alice Smith");
    assert.equal(first.contactId, "200");
    assert.equal(first.contactUsername, "@alice");
    assert.equal(first.messageCount, 10);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffsetId, 5000 - 9);
    assert.equal(first.messages[0].sender, "Alice Smith");
    assert.equal(first.messages[0].isOutgoing, false);
    assert.equal(first.messages[0].messageType, "text");

    const second = toolJson(
      await t.server.handleToolCall("get_private_messages", { contact: "200", limit: 10, offsetId: first.nextOffsetId })
    );
    assert.equal(second.messageCount, 5);
    assert.equal(second.hasMore, false);
    const ids = new Set([...first.messages, ...second.messages].map((m: any) => m.id));
    assert.equal(ids.size, 15);
  });

  it("refuses non-user entities", async () => {
    t.client.register(channelEntity({ id: 42, username: "testchannel" }));
    const text = toolError(await t.server.handleToolCall("get_private_messages", { contact: "@testchannel" }));
    assert.match(text, /is not a private chat/);
  });
});
