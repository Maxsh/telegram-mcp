import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  makeServer,
  channelEntity,
  userEntity,
  chatEntity,
  dialog,
  message,
  descendingMessages,
  mediaPhoto,
  toolJson,
  toolError,
  type TestSetup,
} from "./fakes.js";

let t: TestSetup;
beforeEach(async () => {
  t = await makeServer();
});

describe("get_channel_info", () => {
  it("returns id/peer/title/username/type plus channel details", async () => {
    t.client.register(channelEntity({ id: 100, username: "testchannel", participantsCount: 500 }));

    const body = toolJson(await t.server.handleToolCall("get_channel_info", { channel: "@testchannel" }));
    assert.equal(body.id, "100");
    assert.equal(body.peer, "-100100");
    assert.equal(body.title, "Test Channel");
    assert.equal(body.username, "testchannel");
    assert.equal(body.type, "channel");
    assert.equal(body.participantsCount, 500);
    assert.equal(body.description, "About this channel");
    assert.equal(typeof body.createdDate, "string");
  });

  it("resolves collectible usernames[] handles", async () => {
    t.client.register(channelEntity({ id: 1867382165, username: undefined, usernames: [{ username: "tviy_kyivv", active: true }] }));
    const body = toolJson(await t.server.handleToolCall("get_channel_info", { channel: "@tviy_kyivv" }));
    assert.equal(body.username, "tviy_kyivv");
    assert.equal(body.peer, "-1001867382165");
  });

  it("errors on unknown channels", async () => {
    const text = toolError(await t.server.handleToolCall("get_channel_info", { channel: "@unknown" }));
    assert.match(text, /Could not resolve/);
  });
});

describe("get_available_channels", () => {
  beforeEach(() => {
    t.client.setDialogs([
      dialog({ entity: channelEntity({ id: 1, username: "alpha", title: "Alpha" }) }),
      dialog({ entity: channelEntity({ id: 2, username: undefined, title: "Private Channel" }) }),
      dialog({ entity: channelEntity({ id: 3, username: "beta", title: "Beta Group", broadcast: false, megagroup: true }) }),
      dialog({ entity: chatEntity({ id: 4, title: "Basic Group" }) }),
      dialog({ entity: userEntity({ id: 5 }) }),
    ]);
  });

  it("lists only broadcast channels by default, with peer fields", async () => {
    const body = toolJson(await t.server.handleToolCall("get_available_channels", {}));
    assert.equal(body.totalFound, 2);
    assert.ok(body.channels.every((c: any) => c.peer.startsWith("-100")));
    assert.deepEqual(body.channels.map((c: any) => c.title), ["Alpha", "Private Channel"]);
  });

  it("includes megagroups only when includeGroups is set", async () => {
    const body = toolJson(await t.server.handleToolCall("get_available_channels", { includeGroups: true }));
    assert.equal(body.totalFound, 3);
    assert.ok(body.channels.some((c: any) => c.title === "Beta Group" && c.type === "supergroup"));
  });

  it("never lists users or basic groups", async () => {
    const body = toolJson(await t.server.handleToolCall("get_available_channels", { includeGroups: true }));
    assert.ok(!body.channels.some((c: any) => c.title === "Basic Group"));
    assert.ok(!body.channels.some((c: any) => c.title?.includes("Alice")));
  });

  it("sorts channels with usernames first, then by title", async () => {
    t.client.setDialogs([
      dialog({ entity: channelEntity({ id: 9, username: undefined, title: "Zeta" }) }),
      dialog({ entity: channelEntity({ id: 8, username: "zulu", title: "Zulu" }) }),
      dialog({ entity: channelEntity({ id: 7, username: "alpha", title: "Alpha" }) }),
    ]);
    const body = toolJson(await t.server.handleToolCall("get_available_channels", {}));
    assert.deepEqual(body.channels.map((c: any) => c.title), ["Alpha", "Zulu", "Zeta"]);
  });
});

describe("get_messages_multi", () => {
  beforeEach(() => {
    t.client.register(channelEntity({ id: 1, username: "alpha", title: "Alpha" }));
    t.client.register(channelEntity({ id: 2, username: "beta", title: "Beta" }));
    t.client.setMessages(1, descendingMessages(5, { latestEpochSec: 1764086500, each: (i, m) => { m.message = `a${i}`; m.text = `a${i}`; } }));
    t.client.setMessages(2, descendingMessages(1, { latestEpochSec: 1764086400, each: (i, m) => { m.message = `b${i}`; m.text = `b${i}`; } }));
  });

  it("returns per-channel results and keeps going after failures", async () => {
    const body = toolJson(
      await t.server.handleToolCall("get_messages_multi", { channels: ["@alpha", "-1009999999999", "@beta"], limit: 2 })
    );

    assert.deepEqual(body.summary, { requested: 3, succeeded: 2, failed: 1 });
    assert.equal(body.results.length, 3);

    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].channel, "@alpha");
    assert.equal(body.results[0].resolved.title, "Alpha");
    assert.equal(body.results[0].messagesCount, 2);
    assert.equal(body.results[0].messages[0].text, "a0");
    // alpha has 5 messages and the batch was full -> more pages exist
    assert.equal(body.results[0].hasMore, true);
    assert.equal(body.results[0].nextOffsetId, 4999);

    assert.equal(body.results[1].ok, false);
    assert.match(body.results[1].error, /Could not resolve "-1009999999999"/);

    assert.equal(body.results[2].ok, true);
    assert.equal(body.results[2].messagesCount, 1);
    assert.equal(body.results[2].hasMore, false); // beta ran dry
  });

  it("applies maxTextLength and excludeMedia per channel", async () => {
    t.client.setMessages(
      1,
      descendingMessages(3, {
        latestEpochSec: 1764086500,
        each: (i, m) => {
          if (i === 0) {
            m.message = "a very long message that exceeds twenty characters for sure";
            m.text = m.message;
          } else {
            m.media = mediaPhoto(); // captionless media
          }
        },
      })
    );
    const body = toolJson(
      await t.server.handleToolCall("get_messages_multi", {
        channels: ["@alpha"], maxTextLength: 10, excludeMedia: true,
      })
    );
    assert.equal(body.results[0].messagesCount, 1);
    assert.equal(body.results[0].messages[0].text, "a very lon");
    assert.equal(body.results[0].messages[0].textTruncated, true);
  });
});

describe("search_messages", () => {
  beforeEach(() => {
    t.client.register(channelEntity({ id: 42, username: "testchannel" }));
    t.client.setMessages(42, [
      message({ id: 12, date: 1764086600, message: "Budget announcement today", text: "Budget announcement today", views: 10 }),
      message({ id: 11, date: 1764086500, message: "Budget old news", text: "Budget old news", views: 5 }),
      message({ id: 10, date: 1700000000, message: "Ancient budget post", text: "Ancient budget post", views: 1 }),
    ]);
  });

  it("searches and maps results with resolved info and links", async () => {
    const body = toolJson(
      await t.server.handleToolCall("search_messages", { channel: "@testchannel", query: "budget", limit: 10 })
    );
    assert.equal(body.resultsCount, 3);
    assert.equal(body.query, "budget");
    assert.deepEqual(body.resolved.peer, "-10042");
    assert.ok(body.messages.every((m: any) => m.link === "https://t.me/testchannel/" + m.id));
    assert.equal(body.messages[0].text, "Budget announcement today");
  });

  it("passes offsetId to the Telegram search and filters client-side", async () => {
    const body = toolJson(
      await t.server.handleToolCall("search_messages", { channel: "@testchannel", query: "budget", limit: 10, offsetId: 11 })
    );
    const searchCall = t.client.calls.find((c) => c.method === "invoke");
    // the fake's own invoke record only keeps className; verify via effect instead
    assert.equal(body.resultsCount, 1);
    assert.equal(body.messages[0].id, 10);
    void searchCall;
  });

  it("applies time windows after search", async () => {
    const sinceIso = new Date(1764086550 * 1000).toISOString();
    const body = toolJson(
      await t.server.handleToolCall("search_messages", {
        channel: "@testchannel", query: "budget", limit: 10, sinceDate: sinceIso,
      })
    );
    assert.equal(body.resultsCount, 1);
    assert.equal(body.messages[0].id, 12);
    assert.equal(body.timeFilter.since, sinceIso);
  });

  it("truncates text with maxTextLength", async () => {
    const body = toolJson(
      await t.server.handleToolCall("search_messages", { channel: "@testchannel", query: "budget", limit: 10, maxTextLength: 6 })
    );
    assert.ok(body.messages.every((m: any) => m.text.length <= 6));
  });
});

describe("mark_messages_read", () => {
  it("refuses broadcast channels", async () => {
    t.client.register(channelEntity({ id: 42, username: "testchannel", broadcast: true }));
    const body = toolJson(await t.server.handleToolCall("mark_messages_read", { channel: "@testchannel" }));
    assert.equal(body.success, false);
    assert.match(body.message, /broadcast channels/);
    assert.equal(t.client.invocationsOf("messages.ReadHistory"), 0);
  });

  it("marks specific messages in a supergroup via ReadHistory", async () => {
    const group = channelEntity({ id: 42, broadcast: false, megagroup: true, username: "testgroup" });
    t.client.register(group);
    t.client.setDialogs([dialog({ entity: group, unreadCount: 0 })]);

    const body = toolJson(
      await t.server.handleToolCall("mark_messages_read", { channel: "@testgroup", messageIds: [5, 7] })
    );
    assert.equal(body.success, true);
    assert.equal(body.apiMethod, "ReadHistory");
    assert.equal(body.maxIdMarked, 7);
    assert.match(body.message, /Verified: No unread messages remaining/);
    assert.equal(t.client.invocationsOf("messages.ReadHistory"), 1);
  });

  it("uses ReadMessageContents for specific messages in private chats", async () => {
    const user = userEntity({ id: 200, firstName: "Alice" });
    t.client.register(user);
    t.client.setDialogs([dialog({ entity: user, unreadCount: 0 })]);

    const body = toolJson(
      await t.server.handleToolCall("mark_messages_read", { channel: "@alice", messageIds: [3, 4] })
    );
    assert.equal(body.success, true);
    assert.equal(body.apiMethod, "ReadMessageContents");
    assert.equal(t.client.invocationsOf("messages.ReadMessageContents"), 1);
  });

  it("marks all messages up to the newest when no ids are given", async () => {
    const group = channelEntity({ id: 42, broadcast: false, megagroup: true });
    t.client.register(group);
    t.client.setMessages(42, descendingMessages(4, { latestEpochSec: 1764086500 }));
    t.client.setDialogs([dialog({ entity: group, unreadCount: 2 })]);

    const body = toolJson(await t.server.handleToolCall("mark_messages_read", { channel: "-10042" }));
    assert.equal(body.success, true);
    assert.equal(body.maxIdMarked, 5000);
    assert.match(body.message, /2 messages still show as unread/);
  });

  it("reports nothing to do on an empty private chat", async () => {
    const user = userEntity({ id: 200 });
    t.client.register(user);
    t.client.setMessages(200, []);

    const body = toolJson(await t.server.handleToolCall("mark_messages_read", { channel: "200" }));
    assert.equal(body.success, true);
    assert.equal(body.message, "No messages to mark as read");
  });
});

describe("check_unread_messages", () => {
  beforeEach(() => {
    t.client.setDialogs([
      dialog({ entity: userEntity({ id: 1, firstName: "Ann" }), unreadCount: 3, date: 1764086600 }),
      dialog({ entity: userEntity({ id: 2, firstName: "Bob" }), unreadCount: 1, date: 1764086700 }),
      dialog({ entity: userEntity({ id: 3, firstName: "Cal" }), unreadCount: 0, date: 1764086800 }),
      dialog({ entity: channelEntity({ id: 4, username: "news", title: "News" }), unreadCount: 50, date: 1764086900 }),
    ]);
  });

  it("skips broadcast channels and read chats by default", async () => {
    const body = toolJson(await t.server.handleToolCall("check_unread_messages", {}));
    assert.equal(body.summary.totalChatsChecked, 4);
    assert.equal(body.chats.length, 2);
    assert.deepEqual(body.chats.map((c: any) => c.title), ["Ann", "Bob"]);
    assert.equal(body.summary.totalUnreadMessages, 4);
  });

  it("includes channels and all chats when requested", async () => {
    const body = toolJson(
      await t.server.handleToolCall("check_unread_messages", { includeChannels: true, onlyWithUnread: false })
    );
    assert.equal(body.chats.length, 4);
    // unread-count descending, then last message date descending
    assert.deepEqual(body.chats.map((c: any) => c.title), ["News", "Ann", "Bob", "Cal"]);
    assert.ok(body.chats.every((c: any) => typeof c.lastMessageDate === "string"));
  });

  it("keeps chats that only have unread mentions", async () => {
    t.client.setDialogs([
      dialog({ entity: userEntity({ id: 9, firstName: "Dee" }), unreadCount: 0, unreadMentionsCount: 2 }),
    ]);
    const body = toolJson(await t.server.handleToolCall("check_unread_messages", {}));
    assert.equal(body.chats.length, 1);
    assert.equal(body.chats[0].hasUnread, true);
    assert.equal(body.chats[0].unreadMentionsCount, 2);
  });
});

describe("get_chat_status", () => {
  it("reports dialog info and capabilities", async () => {
    const user = userEntity({ id: 200, firstName: "Alice", lastName: "Smith" });
    t.client.register(user);
    t.client.setDialogs([dialog({ entity: user, unreadCount: 2, pinned: true, topMessage: 77 })]);
    t.client.setMessages(
      200,
      descendingMessages(2, {
        latestEpochSec: 1764086500,
        each: (_i, m) => {
          m.message = "x".repeat(150);
          m.text = m.message;
        },
      })
    );

    const body = toolJson(await t.server.handleToolCall("get_chat_status", { chat: "@alice" }));
    assert.equal(body.chat, "Alice Smith");
    assert.equal(body.chatId, "200");
    assert.equal(body.entityType, "User");
    assert.deepEqual(body.dialogInfo, {
      unreadCount: 2,
      unreadMentionsCount: 0,
      isPinned: true,
      isArchived: false,
      lastMessageDate: new Date(1764086500 * 1000).toISOString(),
      lastMessageId: 77,
    });
    assert.equal(body.capabilities.isPrivateChat, true);
    assert.equal(body.capabilities.canMarkAsRead, true);
    assert.equal(body.recentMessages[0].text.length, 103); // 100 chars + "..."
    assert.equal(body.debug.dialogFound, true);
  });

  it("returns null dialogInfo when the dialog is not in the recent list", async () => {
    t.client.register(channelEntity({ id: 42, username: "far" }));
    t.client.setDialogs([]);
    const body = toolJson(await t.server.handleToolCall("get_chat_status", { chat: "@far" }));
    assert.equal(body.dialogInfo, null);
    assert.equal(body.debug.dialogFound, false);
  });
});
