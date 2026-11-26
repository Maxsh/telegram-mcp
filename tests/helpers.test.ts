import { describe, it, mock } from "node:test";
import * as assert from "node:assert/strict";
import {
  makeServer,
  channelEntity,
  userEntity,
  chatEntity,
  message,
  mediaPhoto,
  mediaDocument,
  attribute,
} from "./fakes.js";

const server = (await makeServer()).server;
const S = server as any;

/**
 * mock.timers API differs across Node versions (setSystemTime before Node 26,
 * setTime from Node 26 on) — shim over both since CI runs several versions.
 */
function setSystemTime(ms: number): void {
  const timers = mock.timers as any;
  (timers.setTime ?? timers.setSystemTime).call(timers, ms);
}

describe("describeEntity", () => {
  it("describes a broadcast channel with a -100 peer", () => {
    const info = S.describeEntity(channelEntity({ id: 1496296645, username: "olegsharp", title: "Oleg Sharp" }));
    assert.deepEqual(info, {
      id: "1496296645",
      peer: "-1001496296645",
      title: "Oleg Sharp",
      username: "@olegsharp",
      type: "channel",
    });
  });

  it("classifies a megagroup as supergroup", () => {
    const info = S.describeEntity(channelEntity({ broadcast: false, megagroup: true, username: undefined }));
    assert.equal(info.type, "supergroup");
    assert.equal(info.username, null);
    assert.equal(info.peer, `-100${info.id}`);
  });

  it("describes a basic group with a - peer", () => {
    const info = S.describeEntity(chatEntity({ id: 300, title: "Group" }));
    assert.equal(info.type, "group");
    assert.equal(info.peer, "-300");
  });

  it("describes a user with name title and bare-id peer", () => {
    const info = S.describeEntity(userEntity({ id: 200, firstName: "Alice", lastName: "Smith", username: "alice" }));
    assert.equal(info.type, "user");
    assert.equal(info.peer, "200");
    assert.equal(info.title, "Alice Smith");
    assert.equal(info.username, "@alice");
  });

  it("falls back to the collectible usernames[] field", () => {
    const entity = channelEntity({ username: undefined, usernames: [{ username: "tviy_kyivv", active: true }] });
    const info = S.describeEntity(entity);
    assert.equal(info.username, "@tviy_kyivv");
    assert.equal(info.title, "Test Channel"); // title comes from the channel itself
  });
});

describe("extractUsername", () => {
  it("prefers the plain username field", () => {
    const e = channelEntity({ username: "main", usernames: [{ username: "other", active: true }] });
    assert.equal(S.extractUsername(e), "main");
  });

  it("uses the active collectible username when username is unset", () => {
    const e = channelEntity({
      username: undefined,
      usernames: [{ username: "old", active: false }, { username: "current", active: true }],
    });
    assert.equal(S.extractUsername(e), "current");
  });

  it("falls back to the first collectible username when none is active", () => {
    const e = channelEntity({ username: undefined, usernames: [{ username: "first", active: false }] });
    assert.equal(S.extractUsername(e), "first");
  });

  it("returns null when there is no handle at all", () => {
    assert.equal(S.extractUsername(channelEntity({ username: undefined })), null);
  });
});

describe("getMediaType", () => {
  const cases: Array<[any, string]> = [
    [{ media: { className: "MessageMediaPhoto" } }, "photo"],
    [{ media: mediaDocument("video/mp4", [attribute("DocumentAttributeAnimated")]) }, "animation"],
    [{ media: mediaDocument("image/webp", [attribute("DocumentAttributeSticker")]) }, "sticker"],
    [{ media: mediaDocument("video/mp4", [attribute("DocumentAttributeVideo")]) }, "video"],
    [{ media: mediaDocument("audio/ogg", [attribute("DocumentAttributeAudio", { voice: true })]) }, "voice"],
    [{ media: mediaDocument("audio/mpeg", [attribute("DocumentAttributeAudio", { voice: false })]) }, "audio"],
    [{ media: mediaDocument("image/jpeg") }, "image"],
    [{ media: mediaDocument("video/quicktime") }, "video"],
    [{ media: mediaDocument("audio/x-wav") }, "audio"],
    [{ media: mediaDocument("application/pdf") }, "document"],
    [{ media: { className: "MessageMediaWebPage" } }, "webpage"],
    [{ media: { className: "MessageMediaPoll" } }, "poll"],
    [{ media: { className: "MessageMediaGeo" } }, "location"],
    [{ media: { className: "MessageMediaContact" } }, "contact"],
    [{ media: { className: "MessageMediaDice" } }, "dice"],
    [{ media: { className: "MessageMediaInvoice" } }, "invoice"],
    [{ media: { className: "MessageMediaSomethingNew" } }, "media"],
    [{}, "text"],
  ];

  for (const [msg, expected] of cases) {
    it(`maps ${JSON.stringify(msg.media?.className ?? "text")} to ${expected}`, () => {
      assert.equal(S.getMediaType(msg), expected);
    });
  }
});

describe("buildMessageLink", () => {
  it("builds a public username link", () => {
    assert.equal(
      S.buildMessageLink(channelEntity({ id: 42, username: "testchannel" }), 77),
      "https://t.me/testchannel/77"
    );
  });

  it("builds a t.me/c link for private channels", () => {
    const e = channelEntity({ id: 42, username: undefined });
    assert.equal(S.buildMessageLink(e, 77), "https://t.me/c/42/77");
  });

  it("returns null for users and basic groups", () => {
    assert.equal(S.buildMessageLink(userEntity(), 77), null);
    assert.equal(S.buildMessageLink(chatEntity(), 77), null);
  });
});

describe("describeForwarded", () => {
  it("uses the visible source name when present", () => {
    assert.equal(S.describeForwarded({ fromName: "Someone" }), "Someone");
  });

  it("describes channel/user/chat peers by id", () => {
    assert.equal(S.describeForwarded({ fromId: { className: "PeerChannel", channelId: 123n } }), "channel 123");
    assert.equal(S.describeForwarded({ fromId: { className: "PeerUser", userId: 7n } }), "user 7");
    assert.equal(S.describeForwarded({ fromId: { className: "PeerChat", chatId: 9n } }), "chat 9");
  });

  it("appends the post author", () => {
    assert.equal(S.describeForwarded({ fromName: "X", postAuthor: "Admin" }), "X via Admin");
  });

  it("returns null for missing or empty forward headers", () => {
    assert.equal(S.describeForwarded(undefined), null);
    assert.equal(S.describeForwarded({}), null);
  });
});

describe("mapMessage", () => {
  it("maps a plain channel post", () => {
    const entity = channelEntity({ id: 42 });
    const m = S.mapMessage(message({ id: 10, date: 1764086530, message: "Hello", text: "Hello", views: 55 }), entity);
    assert.deepEqual(m, {
      id: 10,
      date: new Date(1764086530 * 1000).toISOString(),
      timestamp: 1764086530,
      sender: "Channel",
      text: "Hello",
      link: "https://t.me/testchannel/10",
      views: 55,
    });
  });

  it("keeps both date and timestamp for backwards compatibility", () => {
    const m = S.mapMessage(message({ message: "x", text: "x" }), channelEntity());
    assert.ok(typeof m.date === "string" && typeof m.timestamp === "number");
  });

  it("surfaces a media caption as text and adds mediaType", () => {
    const m = S.mapMessage(
      message({ message: "Caption here", text: "Caption here", media: mediaPhoto(), views: 3 }),
      channelEntity()
    );
    assert.equal(m.text, "Caption here");
    assert.equal(m.mediaType, "photo");
    assert.notEqual(m.text, "[Media/Non-text message]");
  });

  it("keeps the placeholder only when there is no text and no caption", () => {
    const m = S.mapMessage(message({ media: mediaPhoto(), views: 1 }), channelEntity());
    assert.equal(m.text, "[Media/Non-text message]");
    assert.equal(m.mediaType, "photo");
  });

  it("adds groupedId as a string for albums", () => {
    const m = S.mapMessage(message({ groupedId: 7616234891111920n, media: mediaPhoto() }), channelEntity());
    assert.equal(m.groupedId, "7616234891111920");
  });

  it("adds replyToMsgId when present", () => {
    const m = S.mapMessage(message({ message: "x", text: "x", replyToMsgId: 4 }), channelEntity());
    assert.equal(m.replyToMsgId, 4);
  });

  it("adds forwardedFrom when the message is a forward", () => {
    const m = S.mapMessage(
      message({ message: "x", text: "x", fwdFrom: { fromName: "News" } }),
      channelEntity()
    );
    assert.equal(m.forwardedFrom, "News");
  });

  it("maps an outgoing user message", () => {
    const m = S.mapMessage(message({ out: true, message: "hi", text: "hi" }), userEntity());
    assert.equal(m.sender, "You");
    assert.equal(m.isOutgoing, true);
    assert.equal(m.messageType, "text");
    assert.equal(m.link, undefined);
  });

  it("maps an outgoing channel post as You", () => {
    const m = S.mapMessage(message({ out: true, message: "my post", text: "my post" }), channelEntity());
    assert.equal(m.sender, "You");
    assert.equal(m.views, 0);
  });

  it("maps an incoming channel post with a from peer", () => {
    const m = S.mapMessage(
      message({ message: "x", text: "x", fromId: { className: "PeerChannel", channelId: 9n } }),
      channelEntity()
    );
    assert.equal(m.sender, "ID: 9");
  });

  it("maps an incoming user message with contact name", () => {
    const m = S.mapMessage(message({ message: "hey", text: "hey" }), userEntity({ firstName: "Alice", lastName: "Smith" }));
    assert.equal(m.sender, "Alice Smith");
    assert.equal(m.isOutgoing, false);
    assert.equal(m.messageType, "text");
  });

  it("classifies captionless user media as messageType media", () => {
    const m = S.mapMessage(message({ media: mediaPhoto() }), userEntity());
    assert.equal(m.messageType, "media");
    assert.equal(m.text, "[Media/Non-text message]");
  });
});

describe("applyOutputOptions", () => {
  const base = (over: Record<string, any> = {}) => ({ id: 1, date: "d", timestamp: 1, sender: "s", text: "t", ...over });

  it("excludeMedia drops only placeholder messages", () => {
    const out = S.applyOutputOptions(
      [base(), base({ text: "[Media/Non-text message]", mediaType: "photo" }), base({ text: "caption", mediaType: "photo" })],
      { excludeMedia: true }
    );
    assert.equal(out.length, 2);
    assert.ok(out.every((m: any) => m.text !== "[Media/Non-text message]"));
  });

  it("maxTextLength truncates and flags truncated messages", () => {
    const out = S.applyOutputOptions(
      [base({ text: "0123456789012345678901234" }), base({ text: "short" })],
      { maxTextLength: 20 }
    );
    assert.equal(out[0].text, "01234567890123456789"); // first 20 chars
    assert.equal(out[0].textTruncated, true);
    assert.equal(out[1].text, "short");
    assert.equal(out[1].textTruncated, undefined);
  });

  it("fields projects messages and null-fills missing fields", () => {
    const out = S.applyOutputOptions([base({ views: 9 })], { fields: ["id", "views", "forwardedFrom"] });
    assert.deepEqual(out, [{ id: 1, views: 9, forwardedFrom: null }]);
  });

  it("rejects unknown field names with the valid list", () => {
    assert.throws(() => S.applyOutputOptions([base()], { fields: ["id", "bogus"] }), /Unknown message fields: bogus/);
  });

  it("combines excludeMedia, maxTextLength and fields", () => {
    const out = S.applyOutputOptions(
      [base({ text: "x".repeat(30), id: 7 }), base({ text: "[Media/Non-text message]" })],
      { excludeMedia: true, maxTextLength: 10, fields: ["id", "text", "textTruncated"] }
    );
    assert.deepEqual(out, [{ id: 7, text: "xxxxxxxxxx", textTruncated: true }]);
  });
});

describe("calculateCutoffDate", () => {
  it("sinceMinutes is relative to now", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      setSystemTime(Date.UTC(2026, 10, 26, 12, 0, 0));
      const cutoff = S.calculateCutoffDate(15, undefined, undefined);
      assert.equal(cutoff!.getTime(), Date.UTC(2026, 10, 26, 11, 45, 0));
    } finally {
      mock.timers.reset();
    }
  });

  it("sinceHours is relative to now", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      setSystemTime(Date.UTC(2026, 10, 26, 12, 0, 0));
      const cutoff = S.calculateCutoffDate(undefined, 3, undefined);
      assert.equal(cutoff!.getTime(), Date.UTC(2026, 10, 26, 9, 0, 0));
    } finally {
      mock.timers.reset();
    }
  });

  it("full ISO datetime is used as-is", () => {
    const cutoff = S.calculateCutoffDate(undefined, undefined, "2023-12-01T10:00:00Z");
    assert.equal(cutoff!.getTime(), Date.UTC(2023, 11, 1, 10, 0, 0));
  });

  it("date-only resolves to midnight in the given zone (Kyiv winter, UTC+2)", () => {
    const cutoff = S.calculateCutoffDate(undefined, undefined, "2026-11-26", "Europe/Kyiv");
    assert.equal(cutoff!.toISOString(), "2026-11-25T22:00:00.000Z");
  });

  it("date-only respects summer time (Kyiv, UTC+3)", () => {
    const cutoff = S.calculateCutoffDate(undefined, undefined, "2026-07-01", "Europe/Kyiv");
    assert.equal(cutoff!.toISOString(), "2026-06-30T21:00:00.000Z");
  });

  it("handles western negative offsets (New York winter/summer)", () => {
    assert.equal(
      S.calculateCutoffDate(undefined, undefined, "2026-01-15", "America/New_York")!.toISOString(),
      "2026-01-15T05:00:00.000Z"
    );
    assert.equal(
      S.calculateCutoffDate(undefined, undefined, "2026-07-01", "America/New_York")!.toISOString(),
      "2026-07-01T04:00:00.000Z"
    );
  });

  it("date-only defaults to UTC when no tz is given", () => {
    const cutoff = S.calculateCutoffDate(undefined, undefined, "2026-11-26");
    assert.equal(cutoff!.toISOString(), "2026-11-26T00:00:00.000Z");
  });

  it("'today' resolves to local midnight in the zone", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      // 22:30 UTC on Nov 26 = 00:30 on Nov 27 in Kyiv (UTC+2) -> "today" is Nov 27 there
      setSystemTime(Date.UTC(2026, 10, 26, 22, 30, 0));
      const cutoff = S.calculateCutoffDate(undefined, undefined, "today", "Europe/Kyiv");
      assert.equal(cutoff!.toISOString(), "2026-11-26T22:00:00.000Z");
    } finally {
      mock.timers.reset();
    }
  });

  it("'yesterday' resolves to the previous local day", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      setSystemTime(Date.UTC(2026, 10, 26, 22, 30, 0));
      const cutoff = S.calculateCutoffDate(undefined, undefined, "YESTERDAY", "Europe/Kyiv");
      assert.equal(cutoff!.toISOString(), "2026-11-25T22:00:00.000Z");
    } finally {
      mock.timers.reset();
    }
  });

  it("sinceMinutes takes precedence over sinceDate", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      setSystemTime(Date.UTC(2026, 10, 26, 12, 0, 0));
      const cutoff = S.calculateCutoffDate(30, undefined, "2020-01-01");
      assert.equal(cutoff!.getTime(), Date.UTC(2026, 10, 26, 11, 30, 0));
    } finally {
      mock.timers.reset();
    }
  });

  it("rejects unparseable sinceDate loudly", () => {
    assert.throws(() => S.calculateCutoffDate(undefined, undefined, "not-a-date"), /Invalid sinceDate/);
  });

  it("rejects an invalid tz loudly", () => {
    assert.throws(() => S.calculateCutoffDate(undefined, undefined, "2026-11-26", "Not/AZone"), /Invalid tz/);
  });

  it("returns null when no window is requested", () => {
    assert.equal(S.calculateCutoffDate(), null);
  });
});

describe("MESSAGE_FIELDS", () => {
  it("declares the documented field set", () => {
    assert.deepEqual((server.constructor as any).MESSAGE_FIELDS, [
      "id", "date", "timestamp", "sender", "text", "messageType", "isOutgoing",
      "mediaType", "groupedId", "link", "forwardedFrom", "views", "replyToMsgId",
      "textTruncated",
    ]);
  });
});
