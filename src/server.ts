import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import { computeCheck } from "telegram/Password.js";

// Validation schemas
const GetRecentMessagesSchema = z.object({
  channel: z.string().describe("Channel username or ID: @username, bare numeric id (1496296645), or -100-prefixed id (-1001496296645)"),
  limit: z.number().min(1).max(100).optional().default(10).describe("Number of recent messages to retrieve (default: 10, max: 100)"),
  offsetId: z.number().optional().describe("Return messages older than this message ID (pass nextOffsetId from the previous page to paginate through a busy channel)"),
  sinceMinutes: z.number().optional().describe("Get messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Get messages from the last N hours"),
  sinceDate: z.string().optional().describe("Get messages since this date. Accepts a full ISO datetime (2023-12-01T10:00:00Z), a plain date (2023-12-01, midnight in tz), or 'today' / 'yesterday' (midnight in tz)"),
  tz: z.string().optional().describe("IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC"),
  maxTextLength: z.number().min(1).optional().describe("Truncate each message text to this many characters (adds textTruncated: true)"),
  fields: z.array(z.string()).optional().describe("Return only these per-message fields. Valid: id, date, timestamp, sender, text, messageType, isOutgoing, mediaType, groupedId, link, forwardedFrom, views, replyToMsgId, textTruncated"),
  excludeMedia: z.boolean().optional().describe("Omit media-only messages (no text and no caption)"),
});

const GetMessagesMultiSchema = z.object({
  channels: z.array(z.string()).min(1).max(25).describe("Channel identifiers (1-25): @username, bare numeric id, or -100-prefixed id"),
  limit: z.number().min(1).max(100).optional().default(50).describe("Max messages per channel (default: 50, max: 100)"),
  sinceMinutes: z.number().optional().describe("Get messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Get messages from the last N hours"),
  sinceDate: z.string().optional().describe("Get messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'"),
  tz: z.string().optional().describe("IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC"),
  maxTextLength: z.number().min(1).optional().describe("Truncate each message text to this many characters (adds textTruncated: true)"),
  excludeMedia: z.boolean().optional().describe("Omit media-only messages (no text and no caption)"),
});

const GetChannelInfoSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
});

const SearchMessagesSchema = z.object({
  channel: z.string().describe("Channel username or ID: @username, bare numeric id, or -100-prefixed id"),
  query: z.string().describe("Search query"),
  limit: z.number().min(1).max(100).optional().default(10).describe("Number of messages to retrieve (default: 10, max: 100)"),
  offsetId: z.number().optional().describe("Return matches older than this message ID"),
  sinceMinutes: z.number().optional().describe("Search messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Search messages from the last N hours"),
  sinceDate: z.string().optional().describe("Search messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'"),
  tz: z.string().optional().describe("IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC"),
  maxTextLength: z.number().min(1).optional().describe("Truncate each message text to this many characters"),
});

const GetAvailableChannelsSchema = z.object({
  limit: z.number().optional().default(50).describe("Number of channels to retrieve (default: 50, max: 200)"),
  includeGroups: z.boolean().optional().default(false).describe("Include groups in addition to channels (default: false)"),
});

const MarkMessagesReadSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
  messageIds: z.array(z.number()).optional().describe("Specific message IDs to mark as read (optional - if not provided, marks all messages as read)"),
  maxId: z.number().optional().describe("Mark all messages up to this message ID as read (alternative to messageIds)"),
});

const CheckUnreadMessagesSchema = z.object({
  limit: z.number().optional().default(50).describe("Number of chats to check (default: 50, max: 200)"),
  includeChannels: z.boolean().optional().default(false).describe("Include channels in addition to private chats and groups (default: false)"),
  onlyWithUnread: z.boolean().optional().default(true).describe("Only return chats with unread messages (default: true)"),
});

const GetPrivateMessagesSchema = z.object({
  contact: z.string().describe("Contact identifier: username (@username), phone number (+1234567890), or user ID"),
  limit: z.number().min(1).max(100).optional().default(10).describe("Number of messages to retrieve (default: 10, max: 100)"),
  offsetId: z.number().optional().describe("Return messages older than this message ID (pass nextOffsetId from the previous page to paginate)"),
  sinceMinutes: z.number().optional().describe("Get messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Get messages from the last N hours"),
  sinceDate: z.string().optional().describe("Get messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'"),
  tz: z.string().optional().describe("IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC"),
  maxTextLength: z.number().min(1).optional().describe("Truncate each message text to this many characters"),
});

const GetChatStatusSchema = z.object({
  chat: z.string().describe("Chat identifier: username (@username), phone number (+1234567890), or chat ID"),
});

const AuthorizeSchema = z.object({
  phoneNumber: z.string().describe("Phone number with country code (e.g., +1234567890)"),
});

const VerifyCodeSchema = z.object({
  code: z.string().describe("Verification code sent to your phone"),
  password: z.string().optional().describe("2FA password (if enabled on your account)"),
});

const LogoutSchema = z.object({});

export class TelegramMCPServer {
  private server: Server;
  private client: TelegramClient | null = null;
  private session: StringSession;
  private isAuthorizing: boolean = false;
  private authorizationInProgress: boolean = false;
  private dynamicSession: string | null = null;
  private apiId: string;
  private apiHash: string;
  private sessionTimeout: NodeJS.Timeout | null = null;
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Initialize API credentials
    this.apiId = process.env.TELEGRAM_API_ID || "";
    this.apiHash = process.env.TELEGRAM_API_HASH || "";
    
    if (!this.apiId || !this.apiHash) {
      throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables are required");
    }

    this.server = new Server(
      {
        name: "telegram-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.session = new StringSession("");
    this.setupHandlers();
    this.setupProcessCleanup();
  }

  private calculateCutoffDate(sinceMinutes?: number, sinceHours?: number, sinceDate?: string, tz?: string): Date | null {
    if (sinceMinutes) {
      return new Date(Date.now() - sinceMinutes * 60 * 1000);
    }
    if (sinceHours) {
      return new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    }
    if (sinceDate) {
      const trimmed = sinceDate.trim();
      if (/^today$/i.test(trimmed) || /^yesterday$/i.test(trimmed)) {
        const ymd = this.todayInZone(tz, /^yesterday$/i.test(trimmed));
        return this.zonedMidnightToDate(ymd, tz);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return this.zonedMidnightToDate(trimmed, tz);
      }
      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid sinceDate "${sinceDate}". Use an ISO datetime (2023-12-01T10:00:00Z), a plain date (2023-12-01), 'today' or 'yesterday'.`);
      }
      return parsed;
    }
    return null;
  }

  private validateZone(tz?: string): string {
    if (!tz) {
      return "UTC";
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      throw new Error(`Invalid tz "${tz}". Use an IANA time zone name such as Europe/Kyiv or America/New_York.`);
    }
  }

  /**
   * Offset (in ms) of a time zone at a given instant, e.g. +10800000 for UTC+3.
   */
  private zoneOffsetMs(zone: string, atMs: number): number {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(atMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - atMs;
  }

  /**
   * Convert a plain date (YYYY-MM-DD) at 00:00 in the given zone to a UTC Date.
   * DST-correct: the offset is resolved twice so that boundary days land on real local midnight.
   */
  private zonedMidnightToDate(ymd: string, tz?: string): Date {
    const zone = this.validateZone(tz);
    const [y, m, d] = ymd.split("-").map(Number);
    const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
    const firstGuess = utcMidnight - this.zoneOffsetMs(zone, utcMidnight);
    const refined = utcMidnight - this.zoneOffsetMs(zone, firstGuess);
    return new Date(refined);
  }

  /**
   * Today's date (YYYY-MM-DD) in the given zone, optionally shifted one day back.
   */
  private todayInZone(tz?: string, yesterday: boolean = false): string {
    const zone = this.validateZone(tz);
    const nowYmd = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (!yesterday) {
      return nowYmd;
    }
    const [y, m, d] = nowYmd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  /**
   * Username of an entity, falling back to the newer collectible `usernames[]` field
   * (channels like @tviy_kyiv only expose their handle there).
   */
  private extractUsername(entity: any): string | null {
    if (entity.username) {
      return entity.username;
    }
    const usernames = entity.usernames;
    if (Array.isArray(usernames) && usernames.length > 0) {
      const active = usernames.find((u: any) => u.active) || usernames[0];
      if (active?.username) {
        return active.username;
      }
    }
    return null;
  }

  /**
   * Canonical description of a resolved entity: bare id, ready-to-use peer
   * (-100 prefix for channels/supergroups, - prefix for basic groups), title,
   * @username and logical type.
   */
  private describeEntity(entity: any): { id: string; peer: string; title: string | null; username: string | null; type: string } {
    const className = entity.className || "";
    let type = "unknown";
    if (className === "User") {
      type = "user";
    } else if (className === "Chat") {
      type = "group";
    } else if (className === "Channel") {
      type = entity.broadcast ? "channel" : "supergroup";
    }

    const id = entity.id !== undefined && entity.id !== null ? String(entity.id) : "";
    let peer = id;
    if (className === "Channel") {
      peer = `-100${id}`;
    } else if (className === "Chat") {
      peer = `-${id}`;
    }

    const rawUsername = this.extractUsername(entity);
    const title = entity.title || [entity.firstName, entity.lastName].filter(Boolean).join(" ") || rawUsername || null;

    return {
      id,
      peer,
      title,
      username: rawUsername ? `@${rawUsername}` : null,
      type,
    };
  }

  /**
   * Resolve an identifier to an entity, accepting @username, bare numeric id and
   * -100/-prefixed ids. Bare numeric ids are ambiguous (GramJS treats them as user
   * ids), so the channel forms are tried first for pure-digit input.
   */
  private async resolveEntitySmart(identifier: string): Promise<any> {
    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }
    const raw = identifier.trim();
    let lastError: unknown = null;
    try {
      return await this.client.getEntity(raw);
    } catch (error) {
      lastError = error;
    }
    const digits = raw.replace(/^@/, "");
    if (/^\d+$/.test(digits)) {
      for (const candidate of [`-100${digits}`, `-${digits}`]) {
        try {
          return await this.client.getEntity(candidate);
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw new Error(
      `Could not resolve "${identifier}" to a channel, group or user. ` +
      `Try the @username or the -100-prefixed channel id (see get_available_channels -> peer). ` +
      `Underlying error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  /**
   * Human-readable type of a message's media, derived without extra API calls.
   */
  private getMediaType(msg: any): string {
    if (msg.media) {
      const cls = msg.media.className;
      switch (cls) {
        case "MessageMediaPhoto":
          return "photo";
        case "MessageMediaDocument": {
          const doc: any = msg.media.document;
          const mime: string = doc?.mimeType || "";
          const attrs: any[] = doc?.attributes || [];
          if (attrs.some((a) => a.className === "DocumentAttributeAnimated")) {
            return "animation";
          }
          if (attrs.some((a) => a.className === "DocumentAttributeSticker")) {
            return "sticker";
          }
          if (attrs.some((a) => a.className === "DocumentAttributeVideo")) {
            return "video";
          }
          const audioAttr = attrs.find((a) => a.className === "DocumentAttributeAudio");
          if (audioAttr?.voice) {
            return "voice";
          }
          if (audioAttr) {
            return "audio";
          }
          if (mime.startsWith("image/")) {
            return "image";
          }
          if (mime.startsWith("video/")) {
            return "video";
          }
          if (mime.startsWith("audio/")) {
            return "audio";
          }
          return "document";
        }
        case "MessageMediaWebPage":
          return "webpage";
        case "MessageMediaPoll":
          return "poll";
        case "MessageMediaGeo":
          return "location";
        case "MessageMediaContact":
          return "contact";
        case "MessageMediaDice":
          return "dice";
        case "MessageMediaGame":
          return "game";
        case "MessageMediaInvoice":
          return "invoice";
        default:
          return "media";
      }
    }
    return "text";
  }

  /**
   * Compact string for a Telegram peer id object (PeerChannel/PeerUser/PeerChat).
   */
  private peerIdString(peer: any): string {
    if (peer) {
      if (peer.userId !== undefined && peer.userId !== null) {
        return peer.userId.toString();
      }
      if (peer.channelId !== undefined && peer.channelId !== null) {
        return peer.channelId.toString();
      }
      if (peer.chatId !== undefined && peer.chatId !== null) {
        return peer.chatId.toString();
      }
    }
    return String(peer);
  }

  /**
   * Public t.me link for a channel message (username-based for public channels,
   * t.me/c for private ones). Returns null for groups and private chats.
   */
  private buildMessageLink(entity: any, messageId: number): string | null {
    const className = (entity as any).className || "";
    if (className !== "Channel") {
      return null;
    }
    const rawUsername = this.extractUsername(entity);
    if (rawUsername) {
      return `https://t.me/${rawUsername}/${messageId}`;
    }
    return `https://t.me/c/${entity.id}/${messageId}`;
  }

  /**
   * Best-effort description of a message's forward origin, without extra API calls.
   */
  private describeForwarded(fwdFrom: any): string | null {
    if (!fwdFrom) {
      return null;
    }
    const parts: string[] = [];
    if (fwdFrom.fromName) {
      parts.push(String(fwdFrom.fromName));
    } else if (fwdFrom.fromId) {
      const peer = fwdFrom.fromId;
      if (peer.channelId) {
        parts.push(`channel ${peer.channelId.toString()}`);
      } else if (peer.userId) {
        parts.push(`user ${peer.userId.toString()}`);
      } else if (peer.chatId) {
        parts.push(`chat ${peer.chatId.toString()}`);
      }
    }
    if (fwdFrom.postAuthor) {
      parts.push(`via ${fwdFrom.postAuthor}`);
    }
    return parts.length > 0 ? parts.join(" ") : null;
  }

  /**
   * Map a GramJS message to the response shape. Keeps every legacy field and adds
   * mediaType / groupedId / link / forwardedFrom. Media captions surface as text.
   */
  private mapMessage(msg: any, entity: any): any {
    const date = new Date(msg.date * 1000);
    const className = (entity as any).className || "";

    let sender = "Unknown";
    let isOutgoing = false;

    if (className === "User") {
      if (msg.out) {
        sender = "You";
        isOutgoing = true;
      } else {
        const firstName = (entity as any).firstName || "";
        const lastName = (entity as any).lastName || "";
        sender = `${firstName} ${lastName}`.trim() || this.extractUsername(entity) || "Contact";
      }
    } else {
      if (msg.out) {
        sender = "You";
        isOutgoing = true;
      } else {
        sender = msg.fromId ? `ID: ${this.peerIdString(msg.fromId)}` : "Channel";
      }
    }

    const hasText = Boolean(msg.text || msg.message);
    const mediaType = this.getMediaType(msg);

    const messageData: any = {
      id: msg.id,
      date: date.toISOString(),
      timestamp: msg.date,
      sender,
      text: msg.text || msg.message || "[Media/Non-text message]",
    };

    if (mediaType !== "text") {
      messageData.mediaType = mediaType;
    }

    const link = this.buildMessageLink(entity, msg.id);
    if (link) {
      messageData.link = link;
    }

    const forwardedFrom = this.describeForwarded(msg.fwdFrom);
    if (forwardedFrom) {
      messageData.forwardedFrom = forwardedFrom;
    }

    if (msg.groupedId !== undefined && msg.groupedId !== null) {
      messageData.groupedId = msg.groupedId.toString();
    }

    if (className === "User") {
      messageData.isOutgoing = isOutgoing;
      messageData.messageType = hasText ? "text" : "media";
    } else {
      messageData.views = msg.views || 0;
    }

    if (msg.replyToMsgId) {
      messageData.replyToMsgId = msg.replyToMsgId;
    }

    return messageData;
  }

  /**
   * Fetch a window of messages, paging with GramJS offsetId until the limit is
   * reached, the since-cutoff is crossed, or the peer runs out of messages.
   * Unlike a single getMessages call this cannot silently truncate a busy window.
   */
  private async fetchMessageWindow(
    entity: any,
    options: { limit: number; offsetId?: number; cutoffDate?: Date | null }
  ): Promise<{ collected: any[]; hasMore: boolean; nextOffsetId: number | null; newestMessageDate: string | null }> {
    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }
    const { limit, offsetId, cutoffDate } = options;
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // safety net: never fetch more than 5000 messages

    const collected: any[] = [];
    let currentOffset = offsetId;
    let reachedCutoff = false;
    let newestMessageDate: string | null = null;
    let batchFull = false; // last fetched batch was a full page
    let lastBatchLength = 0;
    let consumedFromBatch = 0; // items consumed from the last batch
    let pagesUsed = 0;

    for (let page = 0; page < MAX_PAGES && collected.length < limit; page++) {
      const pageSize = cutoffDate ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - collected.length);
      const request: any = { limit: pageSize };
      if (currentOffset) {
        request.offsetId = currentOffset;
      }
      const batch = await this.client.getMessages(entity, request);

      if (!batch || batch.length === 0) {
        break;
      }

      if (!newestMessageDate && batch[0]?.date) {
        newestMessageDate = new Date(batch[0].date * 1000).toISOString();
      }

      batchFull = batch.length === pageSize;
      lastBatchLength = batch.length;
      consumedFromBatch = 0;
      pagesUsed++;

      for (const msg of batch) {
        const msgDate = new Date((msg.date ?? 0) * 1000);
        if (cutoffDate && msgDate < cutoffDate) {
          reachedCutoff = true;
          break;
        }
        collected.push(msg);
        consumedFromBatch++;
        if (collected.length >= limit) {
          break;
        }
      }

      if (reachedCutoff || collected.length >= limit) {
        break;
      }
      if (batch.length < pageSize) {
        break; // server has no more messages
      }
      currentOffset = batch[batch.length - 1].id;
    }

    // Older in-window messages exist when the limit was reached while the last
    // batch still had unconsumed messages or was itself a full page — or when
    // the safety page cap stopped the scan early.
    const hitPageCap = pagesUsed >= MAX_PAGES && collected.length < limit && batchFull;
    const hasMore =
      !reachedCutoff &&
      (collected.length >= limit || hitPageCap) &&
      (batchFull || consumedFromBatch < lastBatchLength);
    const nextOffsetId = collected.length > 0 ? collected[collected.length - 1].id : currentOffset ?? null;

    return { collected, hasMore, nextOffsetId, newestMessageDate };
  }

  private static readonly MESSAGE_FIELDS = [
    "id",
    "date",
    "timestamp",
    "sender",
    "text",
    "messageType",
    "isOutgoing",
    "mediaType",
    "groupedId",
    "link",
    "forwardedFrom",
    "views",
    "replyToMsgId",
    "textTruncated",
  ];

  /**
   * Digest-friendly output shaping: drop captionless media posts, cap text length,
   * and project messages onto a caller-chosen set of fields.
   */
  private applyOutputOptions(
    messages: any[],
    options: { maxTextLength?: number; fields?: string[]; excludeMedia?: boolean }
  ): any[] {
    const { maxTextLength, fields, excludeMedia } = options;

    let result = messages;

    if (excludeMedia) {
      result = result.filter((m) => m.text !== "[Media/Non-text message]");
    }

    if (maxTextLength !== undefined) {
      result = result.map((m) => {
        if (typeof m.text === "string" && m.text.length > maxTextLength) {
          return { ...m, text: m.text.slice(0, maxTextLength), textTruncated: true };
        }
        return m;
      });
    }

    if (fields && fields.length > 0) {
      const unknown = fields.filter((f) => !TelegramMCPServer.MESSAGE_FIELDS.includes(f));
      if (unknown.length > 0) {
        throw new Error(`Unknown message fields: ${unknown.join(", ")}. Valid fields: ${TelegramMCPServer.MESSAGE_FIELDS.join(", ")}`);
      }
      result = result.map((m) => {
        const projected: any = {};
        for (const f of fields) {
          projected[f] = f in m ? m[f] : null;
        }
        return projected;
      });
    }

    return result;
  }

  private async initializeTelegramClient(): Promise<void> {
    // Check if we already have a session (static from env or dynamic)
    const sessionString = process.env.TELEGRAM_SESSION || this.dynamicSession || "";

    this.session = new StringSession("");
    try {
      if (sessionString) {
        // May throw on a malformed session string; treat it like a missing one
        this.session = new StringSession(sessionString);
      }
      this.client = this.createTelegramClient(this.session, sessionString);
      if (sessionString) {
        if (!this.client.connected) {
          await this.client.connect();
        }
        // Test the connection by getting info about ourselves
        await this.client.getMe();
        return; // Successfully connected with existing session
      }
    } catch (error) {
      // Failed to connect with existing session - console.error removed to prevent JSON corruption
      // Clear the invalid dynamic session and continue to require authorization
      this.dynamicSession = null;
      if (this.client) {
        await this.client.disconnect();
      }
    }

    // If no valid session, throw error indicating authorization is needed
    throw new Error("TELEGRAM_AUTHORIZATION_REQUIRED: No valid session found. Please use telegram_authorize to authenticate.");
  }

  /**
   * Client factory. Kept as a method so tests can substitute a fake Telegram
   * client (no network) by overriding it.
   */
  private createTelegramClient(session: StringSession, sessionString: string): TelegramClient {
    return new TelegramClient(session, parseInt(this.apiId), this.apiHash, {
      connectionRetries: 5,
    });
  }

  private async ensureClientReady(): Promise<void> {
    if (!this.client || !this.client.connected) {
      await this.initializeTelegramClient();
    }
    
    // Reset session timeout on activity (for dynamic sessions)
    this.resetSessionTimeout();
  }

  /**
   * Ensure the client is connected and return it; returns null (instead of
   * throwing) when the session is missing so callers can answer with the
   * auth-required response. Every data tool must go through this so each one
   * works as the first call of a fresh session.
   */
  private async ensureReadyOrAuth(): Promise<TelegramClient | null> {
    try {
      await this.ensureClientReady();
    } catch (error) {
      if (error instanceof Error && error.message.includes("TELEGRAM_AUTHORIZATION_REQUIRED")) {
        return null;
      }
      throw error;
    }
    return this.client;
  }

  private createAuthRequiredResponse(): CallToolResult {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Authorization required",
            message: "Please authorize with Telegram first using the 'telegram_authorize' tool",
            authRequired: true,
            steps: [
              "1. Use 'telegram_authorize' with your phone number",
              "2. Use 'telegram_verify_code' with the code sent to your phone",
              "3. If you have 2FA enabled, include your password in step 2"
            ]
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  private setupProcessCleanup(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      // Uncaught exception - console.error removed to prevent JSON corruption
      this.cleanup().then(() => process.exit(1)).catch(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      // Unhandled rejection - console.error removed to prevent JSON corruption
      this.cleanup().then(() => process.exit(1)).catch(() => process.exit(1));
    });
  }

  public async cleanup(): Promise<void> {
    try {
      if (this.sessionTimeout) {
        clearTimeout(this.sessionTimeout);
        this.sessionTimeout = null;
      }

      // Only logout if using dynamic session (not environment-based)
      if (this.isDynamicSession()) {
        const result = await this.telegramLogout({});
        // Cleanup logout result - console.error removed to prevent JSON corruption
      }
    } catch (error) {
      // Error during cleanup - console.error removed to prevent JSON corruption
    }
  }

  private isDynamicSession(): boolean {
    // Dynamic session means we authenticated through our tools, not via TELEGRAM_SESSION env var
    return !process.env.TELEGRAM_SESSION && this.client?.connected === true;
  }

  private resetSessionTimeout(): void {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
    }

    // Only set timeout for dynamic sessions
    if (this.isDynamicSession()) {
      this.sessionTimeout = setTimeout(async () => {
        // Session timeout reached - console.error removed to prevent JSON corruption
        await this.cleanup();
      }, this.SESSION_TIMEOUT_MS);
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.buildToolCatalog(),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      return await this.handleToolCall(request.params.name, request.params.arguments);
    });
  }

  /**
   * The advertised tool catalog: names, descriptions and JSON input schemas.
   * Exposed as a method so tests can assert it stays in sync with the handlers.
   */
  public buildToolCatalog(): Tool[] {
    return [
          {
            name: "get_recent_messages",
            description: "Get recent messages from a Telegram channel, group, or private chat. Returns resolved channel info (id/peer/username/type), hasMore/nextOffsetId for pagination, and lastMessageDate so an empty window can be told apart from a dead channel.",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (@channelname), bare numeric id (1496296645), -100-prefixed id (-1001496296645), private chat username (@username), or phone number",
                },
                limit: {
                  type: "number",
                  description: "Number of recent messages to retrieve (default: 10, max: 100)",
                  default: 10,
                  minimum: 1,
                  maximum: 100,
                },
                offsetId: {
                  type: "number",
                  description: "Return messages older than this message ID (pass nextOffsetId from the previous page to paginate)",
                },
                sinceMinutes: {
                  type: "number",
                  description: "Get messages from the last N minutes",
                  minimum: 1,
                },
                sinceHours: {
                  type: "number",
                  description: "Get messages from the last N hours",
                  minimum: 1,
                },
                sinceDate: {
                  type: "string",
                  description: "Get messages since this date. Accepts a full ISO datetime (2023-12-01T10:00:00Z), a plain date (2023-12-01, midnight in tz), or 'today' / 'yesterday'",
                },
                tz: {
                  type: "string",
                  description: "IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC",
                },
                maxTextLength: {
                  type: "number",
                  description: "Truncate each message text to this many characters (adds textTruncated: true)",
                  minimum: 1,
                },
                fields: {
                  type: "array",
                  items: { type: "string" },
                  description: "Return only these per-message fields. Valid: id, date, timestamp, sender, text, messageType, isOutgoing, mediaType, groupedId, link, forwardedFrom, views, replyToMsgId, textTruncated",
                },
                excludeMedia: {
                  type: "boolean",
                  description: "Omit media-only messages (no text and no caption)",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "get_messages_multi",
            description: "Get recent messages from multiple Telegram channels in one call (1-25 channels). Returns per-channel results and per-channel errors, so one bad channel does not fail the call. Same response fields as get_recent_messages per channel.",
            inputSchema: {
              type: "object",
              properties: {
                channels: {
                  type: "array",
                  items: { type: "string" },
                  description: "Channel identifiers (1-25): @username, bare numeric id, or -100-prefixed id",
                  minItems: 1,
                  maxItems: 25,
                },
                limit: {
                  type: "number",
                  description: "Max messages per channel (default: 50, max: 100)",
                  default: 50,
                  minimum: 1,
                  maximum: 100,
                },
                sinceMinutes: {
                  type: "number",
                  description: "Get messages from the last N minutes",
                  minimum: 1,
                },
                sinceHours: {
                  type: "number",
                  description: "Get messages from the last N hours",
                  minimum: 1,
                },
                sinceDate: {
                  type: "string",
                  description: "Get messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'",
                },
                tz: {
                  type: "string",
                  description: "IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC",
                },
                maxTextLength: {
                  type: "number",
                  description: "Truncate each message text to this many characters (adds textTruncated: true)",
                  minimum: 1,
                },
                excludeMedia: {
                  type: "boolean",
                  description: "Omit media-only messages (no text and no caption)",
                },
              },
              required: ["channels"],
            },
          },
          {
            name: "get_channel_info",
            description: "Get information about a Telegram channel, group, or private chat",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "search_messages",
            description: "Search for messages in a Telegram channel, group, or private chat",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID",
                },
                query: {
                  type: "string",
                  description: "Search query",
                },
                limit: {
                  type: "number",
                  description: "Number of messages to retrieve (default: 10, max: 100)",
                  default: 10,
                  minimum: 1,
                  maximum: 100,
                },
                sinceMinutes: {
                  type: "number",
                  description: "Search messages from the last N minutes",
                  minimum: 1,
                },
                sinceHours: {
                  type: "number",
                  description: "Search messages from the last N hours",
                  minimum: 1,
                },
                sinceDate: {
                  type: "string",
                  description: "Search messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'",
                },
                tz: {
                  type: "string",
                  description: "IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC",
                },
                offsetId: {
                  type: "number",
                  description: "Return matches older than this message ID",
                },
                maxTextLength: {
                  type: "number",
                  description: "Truncate each message text to this many characters",
                  minimum: 1,
                },
              },
              required: ["channel", "query"],
            },
          },
          {
            name: "get_available_channels",
            description: "Get list of available channels and groups that the user has access to",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Number of channels to retrieve (default: 50, max: 200)",
                  default: 50,
                  minimum: 1,
                  maximum: 200,
                },
                includeGroups: {
                  type: "boolean",
                  description: "Include groups in addition to channels (default: false)",
                  default: false,
                },
              },
              required: [],
            },
          },
          {
            name: "mark_messages_read",
            description: "Mark messages as read in a Telegram chat, group, or private conversation (not supported for broadcast channels)",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username, group username, private chat username (@username), phone number (+1234567890), or chat ID (works with groups/supergroups/private chats, not broadcast channels)",
                },
                messageIds: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  description: "Specific message IDs to mark as read (optional - if not provided, marks all messages as read)",
                },
                maxId: {
                  type: "number",
                  description: "Mark all messages up to this message ID as read (alternative to messageIds)",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "check_unread_messages",
            description: "Check for unread messages in private chats and groups",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Number of chats to check (default: 50, max: 200)",
                  default: 50,
                  minimum: 1,
                  maximum: 200,
                },
                includeChannels: {
                  type: "boolean",
                  description: "Include channels in addition to private chats and groups (default: false)",
                  default: false,
                },
                onlyWithUnread: {
                  type: "boolean",
                  description: "Only return chats with unread messages (default: true)",
                  default: true,
                },
              },
              required: [],
            },
          },
          {
            name: "get_private_messages",
            description: "Get messages from a private chat conversation",
            inputSchema: {
              type: "object",
              properties: {
                contact: {
                  type: "string",
                  description: "Contact identifier: username (@username), phone number (+1234567890), or user ID",
                },
                limit: {
                  type: "number",
                  description: "Number of messages to retrieve (default: 10, max: 100)",
                  default: 10,
                  minimum: 1,
                  maximum: 100,
                },
                sinceMinutes: {
                  type: "number",
                  description: "Get messages from the last N minutes",
                  minimum: 1,
                },
                sinceHours: {
                  type: "number",
                  description: "Get messages from the last N hours",
                  minimum: 1,
                },
                sinceDate: {
                  type: "string",
                  description: "Get messages since this date. Accepts a full ISO datetime, a plain date (midnight in tz), or 'today' / 'yesterday'",
                },
                tz: {
                  type: "string",
                  description: "IANA time zone used to resolve date-only sinceDate and 'today'/'yesterday' (e.g., Europe/Kyiv). Default: UTC",
                },
                offsetId: {
                  type: "number",
                  description: "Return messages older than this message ID (pass nextOffsetId from the previous page to paginate)",
                },
                maxTextLength: {
                  type: "number",
                  description: "Truncate each message text to this many characters",
                  minimum: 1,
                },
              },
              required: ["contact"],
            },
          },
          {
            name: "get_chat_status",
            description: "Get detailed status information about a chat including unread count and read status",
            inputSchema: {
              type: "object",
              properties: {
                chat: {
                  type: "string",
                  description: "Chat identifier: username (@username), phone number (+1234567890), or chat ID",
                },
              },
              required: ["chat"],
            },
          },
          {
            name: "telegram_authorize",
            description: "Start Telegram authorization process with phone number",
            inputSchema: {
              type: "object",
              properties: {
                phoneNumber: {
                  type: "string",
                  description: "Phone number with country code (e.g., +1234567890)",
                },
              },
              required: ["phoneNumber"],
            },
          },
          {
            name: "telegram_verify_code",
            description: "Complete Telegram authorization with verification code and optional 2FA password",
            inputSchema: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: "Verification code sent to your phone",
                },
                password: {
                  type: "string",
                  description: "2FA password (if enabled on your account)",
                },
              },
              required: ["code"],
            },
          },
          {
            name: "telegram_logout",
            description: "Logout from Telegram and invalidate the current session",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
          },
    ] as Tool[];
  }

  /**
   * Dispatch a tool call by name. Shared by the MCP request handler and used
   * directly by the unit tests so the exact same path is exercised.
   */
  public async handleToolCall(name: string, args: unknown): Promise<CallToolResult> {
    try {
      switch (name) {
        case "get_recent_messages":
          return await this.getRecentMessages(args);
        case "get_channel_info":
          return await this.getChannelInfo(args);
        case "search_messages":
          return await this.searchMessages(args);
        case "get_available_channels":
          return await this.getAvailableChannels(args);
        case "get_messages_multi":
          return await this.getMessagesMulti(args);
        case "mark_messages_read":
          return await this.markMessagesRead(args);
        case "check_unread_messages":
          return await this.checkUnreadMessages(args);
        case "get_private_messages":
          return await this.getPrivateMessages(args);
        case "get_chat_status":
          return await this.getChatStatus(args);
        case "telegram_authorize":
          return await this.telegramAuthorize(args);
        case "telegram_verify_code":
          return await this.telegramVerifyCode(args);
        case "telegram_logout":
          return await this.telegramLogout(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async getRecentMessages(args: unknown): Promise<CallToolResult> {
    const params = GetRecentMessagesSchema.parse(args);

    if (!(await this.ensureReadyOrAuth())) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Resolve channel entity (accepts @username, bare id and -100-prefixed id)
      const entity = await this.resolveEntitySmart(params.channel);

      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(params.sinceMinutes, params.sinceHours, params.sinceDate, params.tz);

      // Page through the window so busy channels are not silently truncated
      const window = await this.fetchMessageWindow(entity, {
        limit: params.limit,
        offsetId: params.offsetId,
        cutoffDate,
      });

      let messages = window.collected.map((msg: any) => this.mapMessage(msg, entity));
      messages = this.applyOutputOptions(messages, params);

      const resolved = this.describeEntity(entity);

      const result: any = {
        channel: resolved.title || params.channel,
        resolved,
        messagesCount: messages.length,
        messages,
        hasMore: window.hasMore,
        nextOffsetId: window.nextOffsetId,
      };

      // Newest message seen during the scan: lets callers tell an empty window
      // apart from a dead or unresolved channel.
      if (window.newestMessageDate) {
        result.lastMessageDate = window.newestMessageDate;
      }

      // Add time filter info to result
      if (cutoffDate) {
        result.timeFilter = {
          since: cutoffDate.toISOString(),
          sinceMinutes: params.sinceMinutes,
          sinceHours: params.sinceHours,
          sinceDate: params.sinceDate,
          tz: params.tz ?? "UTC",
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get messages from channel ${params.channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getChannelInfo(args: unknown): Promise<CallToolResult> {
    const { channel } = GetChannelInfoSchema.parse(args);

    if (!(await this.ensureReadyOrAuth())) {
      return this.createAuthRequiredResponse();
    }

    try {
      const entity = await this.resolveEntitySmart(channel);
      const resolved = this.describeEntity(entity);

      const channelInfo: any = {
        id: resolved.id,
        peer: resolved.peer,
        title: resolved.title,
        username: this.extractUsername(entity),
        type: resolved.type,
      };

      // Add additional info if it's a channel
      if ("participantsCount" in entity) {
        channelInfo.participantsCount = (entity as any).participantsCount;
      }
      if ("about" in entity) {
        channelInfo.description = (entity as any).about;
      }
      if ("date" in entity) {
        channelInfo.createdDate = new Date((entity as any).date * 1000).toISOString();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(channelInfo),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get channel info for ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async searchMessages(args: unknown): Promise<CallToolResult> {
    const params = SearchMessagesSchema.parse(args);

    const client = await this.ensureReadyOrAuth();
    if (!client) {
      return this.createAuthRequiredResponse();
    }

    try {
      const entity = await this.resolveEntitySmart(params.channel);
      const resolved = this.describeEntity(entity);

      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(params.sinceMinutes, params.sinceHours, params.sinceDate, params.tz);

      // Search messages - if we have time filter, get more results to account for filtering
      const searchLimit = cutoffDate ? Math.min(params.limit * 5, 100) : params.limit;

      const searchRequest: any = {
        peer: entity,
        q: params.query,
        limit: searchLimit,
        filter: new Api.InputMessagesFilterEmpty(),
      };
      if (params.offsetId) {
        searchRequest.offsetId = params.offsetId;
      }

      const result = await client.invoke(
        new Api.messages.Search(searchRequest)
      );

      let messages = (result as any).messages?.map((msg: any) => this.mapMessage(msg, entity)) || [];
      messages = this.applyOutputOptions(messages, { maxTextLength: params.maxTextLength });

      // Apply time filtering if specified
      if (cutoffDate) {
        messages = messages.filter((msg: any) =>
          new Date(msg.timestamp * 1000) >= cutoffDate
        );
        // Limit after filtering
        messages = messages.slice(0, params.limit);
      }

      const searchResult: any = {
        channel: resolved.title || params.channel,
        resolved,
        query: params.query,
        resultsCount: messages.length,
        messages,
      };

      // Add time filter info to result
      if (cutoffDate) {
        searchResult.timeFilter = {
          since: cutoffDate.toISOString(),
          sinceMinutes: params.sinceMinutes,
          sinceHours: params.sinceHours,
          sinceDate: params.sinceDate,
          tz: params.tz ?? "UTC",
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(searchResult),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search messages in channel ${params.channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getAvailableChannels(args: unknown): Promise<CallToolResult> {
    const { limit, includeGroups } = GetAvailableChannelsSchema.parse(args);

    const client = await this.ensureReadyOrAuth();
    if (!client) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Get all dialogs (conversations)
      const dialogs = await client.getDialogs({ limit });

      const channels: any[] = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        
        // Check if entity exists and is a channel or supergroup
        if (entity && (entity as any).className === "Channel") {
          const isChannel = (entity as any).broadcast;
          const isGroup = (entity as any).megagroup;
          
          // Include channels always, groups only if requested
          if (isChannel || (includeGroups && isGroup)) {
            const resolved = this.describeEntity(entity);
            const rawUsername = this.extractUsername(entity);
            const channelInfo: any = {
              id: resolved.id,
              peer: resolved.peer,
              title: resolved.title,
              username: rawUsername ? `@${rawUsername}` : null,
              type: resolved.type,
              participantsCount: (entity as any).participantsCount || 0,
              isPrivate: !rawUsername,
              accessHash: (entity as any).accessHash?.toString(),
              // Additional useful info
              verified: (entity as any).verified || false,
              scam: (entity as any).scam || false,
              fake: (entity as any).fake || false,
              restricted: (entity as any).restricted || false,
            };

            // Add description if available
            if ((entity as any).about) {
              channelInfo.description = (entity as any).about;
            }

            channels.push(channelInfo);
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              totalFound: channels.length,
              includeGroups,
              channels: channels.sort((a, b) => {
                // Sort by title, putting channels with usernames first
                if (a.username && !b.username) return -1;
                if (!a.username && b.username) return 1;
                return a.title.localeCompare(b.title);
              }),
            }),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get available channels: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Batch fetch across channels. One failing channel produces a per-channel error
   * entry instead of failing the whole call.
   */
  private async getMessagesMulti(args: unknown): Promise<CallToolResult> {
    const params = GetMessagesMultiSchema.parse(args);

    if (!(await this.ensureReadyOrAuth())) {
      return this.createAuthRequiredResponse();
    }

    const cutoffDate = this.calculateCutoffDate(params.sinceMinutes, params.sinceHours, params.sinceDate, params.tz);

    const results: any[] = [];

    for (const channel of params.channels) {
      try {
        const entity = await this.resolveEntitySmart(channel);
        const resolved = this.describeEntity(entity);
        const window = await this.fetchMessageWindow(entity, { limit: params.limit, cutoffDate });

        let messages = window.collected.map((msg: any) => this.mapMessage(msg, entity));
        messages = this.applyOutputOptions(messages, params);

        const entry: any = {
          channel,
          ok: true,
          resolved,
          messagesCount: messages.length,
          messages,
          hasMore: window.hasMore,
          nextOffsetId: window.nextOffsetId,
        };

        if (window.newestMessageDate) {
          entry.lastMessageDate = window.newestMessageDate;
        }

        if (cutoffDate) {
          entry.timeFilter = {
            since: cutoffDate.toISOString(),
            sinceMinutes: params.sinceMinutes,
            sinceHours: params.sinceHours,
            sinceDate: params.sinceDate,
            tz: params.tz ?? "UTC",
          };
        }

        results.push(entry);
      } catch (error) {
        results.push({
          channel,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      requested: params.channels.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ summary, results }),
        },
      ],
    };
  }

  private async markMessagesRead(args: unknown): Promise<CallToolResult> {
    const { channel, messageIds, maxId } = MarkMessagesReadSchema.parse(args);

    const client = await this.ensureReadyOrAuth();
    if (!client) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Resolve channel entity
      const entity = await client.getEntity(channel);
      const channelTitle = (entity as any).title || (entity as any).firstName || channel;
      const entityType = (entity as any).className;

      // Check if it's a broadcast channel
      const isChannel = entityType === "Channel" && (entity as any).broadcast;
      
      if (isChannel) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                channel: channelTitle,
                message: "Cannot mark messages as read in broadcast channels. This operation is only supported for private chats and groups.",
                reason: "Telegram API limitation: broadcast channels don't support read history operations for regular users",
                suggestion: "Use this feature with private groups or supergroups instead",
              }, null, 2),
            },
          ],
        };
      }

      // Determine the best API method based on entity type
      let result: any;
      let markedCount = 0;
      let apiMethod = "ReadHistory";

      // For private chats (User entities), we might need different handling
      if (entityType === "User") {
        // For private chats, try multiple approaches
        try {
          if (messageIds && messageIds.length > 0) {
            // First try to mark specific message contents as read
            try {
              await client.invoke(
                new Api.messages.ReadMessageContents({
                  id: messageIds,
                })
              );
              apiMethod = "ReadMessageContents";
            } catch (contentError) {
              // Fall back to ReadHistory
              result = await client.invoke(
                new Api.messages.ReadHistory({
                  peer: entity,
                  maxId: Math.max(...messageIds),
                })
              );
              apiMethod = "ReadHistory";
            }
            markedCount = messageIds.length;
          } else if (maxId) {
            // Mark all messages up to maxId as read in private chat
            result = await client.invoke(
              new Api.messages.ReadHistory({
                peer: entity,
                maxId: maxId,
              })
            );
            markedCount = maxId;
          } else {
            // Mark all messages as read in private chat
            const messages = await client.getMessages(entity, { limit: 1 });
            if (messages.length > 0) {
              const latestMessageId = messages[0].id;
              result = await client.invoke(
                new Api.messages.ReadHistory({
                  peer: entity,
                  maxId: latestMessageId,
                })
              );
              markedCount = latestMessageId;
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      success: true,
                      channel: channelTitle,
                      message: "No messages to mark as read",
                      markedCount: 0,
                    }, null, 2),
                  },
                ],
              };
            }
          }
        } catch (readHistoryError) {
          // If ReadHistory fails for private chat, try alternative approach
          // ReadHistory failed - console.error removed to prevent JSON corruption
          
          throw new Error(`Could not mark messages as read in private chat. This might be due to chat encryption or API restrictions. Error: ${readHistoryError instanceof Error ? readHistoryError.message : String(readHistoryError)}`);
        }
      } else {
        // For groups and supergroups, use the standard approach
        if (messageIds && messageIds.length > 0) {
          result = await client.invoke(
            new Api.messages.ReadHistory({
              peer: entity,
              maxId: Math.max(...messageIds),
            })
          );
          markedCount = messageIds.length;
        } else if (maxId) {
          result = await client.invoke(
            new Api.messages.ReadHistory({
              peer: entity,
              maxId: maxId,
            })
          );
          markedCount = maxId;
        } else {
          // Mark all messages as read (get latest message ID first)
          const messages = await client.getMessages(entity, { limit: 1 });
          if (messages.length > 0) {
            const latestMessageId = messages[0].id;
            result = await client.invoke(
              new Api.messages.ReadHistory({
                peer: entity,
                maxId: latestMessageId,
              })
            );
            markedCount = latestMessageId;
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    channel: channelTitle,
                    message: "No messages to mark as read",
                    markedCount: 0,
                  }, null, 2),
                },
              ],
            };
          }
        }
      }

      // Verify the operation by checking if it actually worked
      let verificationMessage = "";
      try {
        // Get the dialog to check unread count after marking as read
        const dialogs = await client.getDialogs({ limit: 100 });
        const targetDialog = dialogs.find(d => d.entity && (d.entity as any).id === (entity as any).id);
        
        if (targetDialog) {
          const unreadCountAfter = targetDialog.unreadCount || 0;
          if (unreadCountAfter === 0) {
            verificationMessage = " (Verified: No unread messages remaining)";
          } else {
            verificationMessage = ` (Note: ${unreadCountAfter} messages still show as unread)`;
          }
        }
      } catch (verifyError) {
        // Verification failed, but don't fail the whole operation
        verificationMessage = " (Could not verify read status)";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              channel: channelTitle,
              entityType: entityType,
              message: (messageIds 
                ? `Marked ${messageIds.length} specific messages as read`
                : maxId 
                  ? `Marked all messages up to ID ${maxId} as read`
                  : `Marked all messages as read (up to ID ${markedCount})`) + verificationMessage,
              maxIdMarked: maxId || (messageIds ? Math.max(...messageIds) : markedCount),
              specificMessageIds: messageIds || null,
              apiMethod: apiMethod,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to mark messages as read in ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async checkUnreadMessages(args: unknown): Promise<CallToolResult> {
    const { limit, includeChannels, onlyWithUnread } = CheckUnreadMessagesSchema.parse(args);

    const client = await this.ensureReadyOrAuth();
    if (!client) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Get dialogs (conversations) that the user has access to
      const dialogs = await client.getDialogs({ limit });
      
      const chatsWithUnread = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        
        // Skip if entity is undefined
        if (!entity) {
          continue;
        }
        
        // Skip channels unless specifically requested
        if (!includeChannels && (entity as any).className === "Channel" && (entity as any).broadcast) {
          continue;
        }

        // Get chat info
        let chatType = "unknown";
        let chatTitle = "Unknown";
        let username = null;

        if ((entity as any).className === "User") {
          chatType = "private";
          chatTitle = (entity as any).firstName || "Unknown User";
          if ((entity as any).lastName) {
            chatTitle += ` ${(entity as any).lastName}`;
          }
          username = (entity as any).username || null;
        } else if ((entity as any).className === "Chat") {
          chatType = "group";
          chatTitle = (entity as any).title || "Unknown Group";
        } else if ((entity as any).className === "Channel") {
          if ((entity as any).broadcast) {
            chatType = "channel";
          } else {
            chatType = "supergroup";
          }
          chatTitle = (entity as any).title || "Unknown Channel";
          username = (entity as any).username || null;
        }

        const unreadCount = dialog.unreadCount || 0;
        const hasUnreadMentions = dialog.unreadMentionsCount > 0;

        // If onlyWithUnread is true, skip chats with no unread messages
        if (onlyWithUnread && unreadCount === 0 && !hasUnreadMentions) {
          continue;
        }

        const chatInfo = {
          id: (entity as any).id.toString(),
          title: chatTitle,
          type: chatType,
          username: username,
          unreadCount: unreadCount,
          unreadMentionsCount: dialog.unreadMentionsCount || 0,
          hasUnread: unreadCount > 0 || hasUnreadMentions,
          isArchived: dialog.archived || false,
          isPinned: dialog.pinned || false,
          lastMessageDate: dialog.date ? new Date(dialog.date * 1000).toISOString() : null,
        };

        chatsWithUnread.push(chatInfo);
      }

      // Sort by unread count (descending) and then by last message date
      chatsWithUnread.sort((a, b) => {
        if (a.unreadCount !== b.unreadCount) {
          return b.unreadCount - a.unreadCount;
        }
        if (a.lastMessageDate && b.lastMessageDate) {
          return new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime();
        }
        return 0;
      });

      const totalUnreadChats = chatsWithUnread.filter(chat => chat.hasUnread).length;
      const totalUnreadMessages = chatsWithUnread.reduce((sum, chat) => sum + chat.unreadCount, 0);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              summary: {
                totalChatsChecked: dialogs.length,
                totalUnreadChats: totalUnreadChats,
                totalUnreadMessages: totalUnreadMessages,
                includeChannels: includeChannels,
                onlyWithUnread: onlyWithUnread,
              },
              chats: chatsWithUnread,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to check unread messages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getPrivateMessages(args: unknown): Promise<CallToolResult> {
    const params = GetPrivateMessagesSchema.parse(args);

    if (!(await this.ensureReadyOrAuth())) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Resolve contact entity - could be username, phone, or user ID
      const entity = await this.resolveEntitySmart(params.contact);

      // Verify it's a private chat (User entity)
      if ((entity as any).className !== "User") {
        throw new Error(`"${params.contact}" is not a private chat. Use get_recent_messages for channels and groups.`);
      }

      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(params.sinceMinutes, params.sinceHours, params.sinceDate, params.tz);

      // Page through the window so busy conversations are not silently truncated
      const window = await this.fetchMessageWindow(entity, {
        limit: params.limit,
        offsetId: params.offsetId,
        cutoffDate,
      });

      let filteredMessages = window.collected.map((msg: any) => this.mapMessage(msg, entity));
      filteredMessages = this.applyOutputOptions(filteredMessages, { maxTextLength: params.maxTextLength });

      const contactName = `${(entity as any).firstName || ""} ${(entity as any).lastName || ""}`.trim() 
        || (entity as any).username 
        || params.contact;

      const result: any = {
        success: true,
        contact: contactName,
        contactId: (entity as any).id.toString(),
        contactUsername: this.extractUsername(entity) ? `@${this.extractUsername(entity)}` : null,
        messageCount: filteredMessages.length,
        messages: filteredMessages,
        hasMore: window.hasMore,
        nextOffsetId: window.nextOffsetId,
      };

      if (window.newestMessageDate) {
        result.lastMessageDate = window.newestMessageDate;
      }

      result.timeFilter = cutoffDate ? {
        since: cutoffDate.toISOString(),
        sinceMinutes: params.sinceMinutes,
        sinceHours: params.sinceHours,
        sinceDate: params.sinceDate,
        tz: params.tz ?? "UTC",
      } : null;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get private messages from ${params.contact}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getChatStatus(args: unknown): Promise<CallToolResult> {
    const { chat } = GetChatStatusSchema.parse(args);

    const client = await this.ensureReadyOrAuth();
    if (!client) {
      return this.createAuthRequiredResponse();
    }

    try {
      // Resolve chat entity
      const entity = await client.getEntity(chat);
      const entityType = (entity as any).className;
      
      // Get dialog info to check unread status
      const dialogs = await client.getDialogs({ limit: 100 });
      const targetDialog = dialogs.find(d => d.entity && (d.entity as any).id === (entity as any).id);
      
      // Get recent messages to see read status
      const recentMessages = await client.getMessages(entity, { limit: 5 });
      
      let chatTitle = "Unknown";
      if (entityType === "User") {
        const firstName = (entity as any).firstName || "";
        const lastName = (entity as any).lastName || "";
        chatTitle = `${firstName} ${lastName}`.trim() || (entity as any).username || "Unknown User";
      } else {
        chatTitle = (entity as any).title || "Unknown Chat";
      }

      const statusInfo = {
        success: true,
        chat: chatTitle,
        chatId: (entity as any).id.toString(),
        entityType: entityType,
        username: (entity as any).username || null,
        
        // Dialog information
        dialogInfo: targetDialog ? {
          unreadCount: targetDialog.unreadCount || 0,
          unreadMentionsCount: targetDialog.unreadMentionsCount || 0,
          isPinned: targetDialog.pinned || false,
          isArchived: targetDialog.archived || false,
          lastMessageDate: targetDialog.date ? new Date(targetDialog.date * 1000).toISOString() : null,
          lastMessageId: (targetDialog as any).topMessage || null,
        } : null,
        
        // Recent messages with read status
        recentMessages: recentMessages.map((msg: any) => ({
          id: msg.id,
          date: new Date(msg.date * 1000).toISOString(),
          text: (msg.text || msg.message || "[Media/Non-text message]").substring(0, 100) + ((msg.text || msg.message) && (msg.text || msg.message).length > 100 ? "..." : ""),
          isOutgoing: msg.out || false,
          readDate: msg.readDate ? new Date(msg.readDate * 1000).toISOString() : null,
          // Note: msg.readDate might not always be available for private chats
        })),
        
        // Chat-specific capabilities
        capabilities: {
          canMarkAsRead: entityType !== "Channel" || !(entity as any).broadcast,
          isPrivateChat: entityType === "User",
          isGroup: entityType === "Chat",
          isSupergroup: entityType === "Channel" && !(entity as any).broadcast,
          isBroadcastChannel: entityType === "Channel" && (entity as any).broadcast,
        },
        
        // Debugging info
        debug: {
          dialogFound: !!targetDialog,
          totalDialogsChecked: dialogs.length,
          entityProperties: {
            id: (entity as any).id,
            accessHash: (entity as any).accessHash || null,
            className: entityType,
            broadcast: (entity as any).broadcast || false,
          }
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(statusInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get chat status for ${chat}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async telegramAuthorize(args: unknown): Promise<CallToolResult> {
    const { phoneNumber } = AuthorizeSchema.parse(args);

    if (this.authorizationInProgress) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Authorization already in progress",
              message: "Please complete the current authorization process using telegram_verify_code or wait for it to timeout",
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    try {
      // Create a new client for authorization
      this.session = new StringSession("");
      this.client = this.createTelegramClient(this.session, "");

      this.authorizationInProgress = true;

      // Connect the client first
      await this.client.connect();

      // Send the code request
      const result = await this.client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phoneNumber,
          apiId: parseInt(this.apiId),
          apiHash: this.apiHash,
          settings: new Api.CodeSettings({})
        })
      );

      // Store the phone code hash for later use
      (this.client as any).phoneCodeHash = (result as any).phoneCodeHash;
      (this.client as any).phoneNumber = phoneNumber;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Verification code sent to your phone",
              nextStep: "Use telegram_verify_code with the code you received",
              phoneNumber: phoneNumber,
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      this.authorizationInProgress = false;
      
      if (error instanceof Error) {        
        if (error.message.includes("PHONE_NUMBER_INVALID")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid phone number",
                  message: "Please provide a valid phone number with country code (e.g., +1234567890)",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        if (error.message.includes("FLOOD_WAIT")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Rate limited",
                  message: "Too many authorization attempts. Please wait before trying again.",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      throw new Error(`Failed to start authorization: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async telegramVerifyCode(args: unknown): Promise<CallToolResult> {
    const { code, password } = VerifyCodeSchema.parse(args);

    if (!this.authorizationInProgress || !this.client) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "No authorization in progress",
              message: "Please start authorization first using telegram_authorize",
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    try {
      const phoneCodeHash = (this.client as any).phoneCodeHash;
      const phoneNumber = (this.client as any).phoneNumber;

      if (!phoneCodeHash || !phoneNumber) {
        throw new Error("Missing authorization state. Please restart with telegram_authorize");
      }

      // First, try to sign in with the code
      let result;
      try {
        result = await this.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phoneNumber,
            phoneCodeHash: phoneCodeHash,
            phoneCode: code,
          })
        );
      } catch (signInError: any) {
        // Check if 2FA is required
        if (signInError.message && signInError.message.includes("SESSION_PASSWORD_NEEDED")) {
          if (!password) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "2FA password required",
                    message: "Your account has 2FA enabled. Please use telegram_verify_code with both code and password parameters",
                  }, null, 2),
                },
              ],
              isError: true,
            };
          }

          // Get the password information
          const passwordResult = await this.client.invoke(new Api.account.GetPassword());
          
          // Verify the 2FA password
          const passwordCheck = await computeCheck(passwordResult, password);
          
          result = await this.client.invoke(
            new Api.auth.CheckPassword({
              password: passwordCheck,
            })
          );
        } else {
          throw signInError;
        }
      }

      // Get the session string for future use
      const sessionString = this.client.session.save() as unknown as string;
      this.dynamicSession = sessionString;
      this.authorizationInProgress = false;

      // Clear temporary auth state
      delete (this.client as any).phoneCodeHash;
      delete (this.client as any).phoneNumber;

      // Get user info to confirm successful login
      const me = await this.client.getMe();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Successfully authenticated with Telegram",
              user: {
                id: (me as any).id?.toString(),
                firstName: (me as any).firstName,
                lastName: (me as any).lastName,
                username: (me as any).username,
                phone: (me as any).phone,
              },
              sessionInfo: {
                sessionCreated: true,
                sessionStored: "in-memory",
                note: "Session will be lost when the MCP server restarts. For persistent sessions, set TELEGRAM_SESSION environment variable.",
              },
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      this.authorizationInProgress = false;
      
      if (error instanceof Error) {
        if (error.message.includes("PHONE_CODE_INVALID")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid verification code",
                  message: "The verification code you entered is incorrect. Please try again with telegram_verify_code",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
        
        if (error.message.includes("PASSWORD_HASH_INVALID")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid 2FA password",
                  message: "The 2FA password you entered is incorrect. Please try again with telegram_verify_code",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        if (error.message.includes("PHONE_CODE_EXPIRED")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Verification code expired",
                  message: "The verification code has expired. Please start over with telegram_authorize",
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      throw new Error(`Failed to verify code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async telegramLogout(args: unknown): Promise<CallToolResult> {
    LogoutSchema.parse(args);

    try {
      if (this.client && this.client.connected) {
        // Log out from Telegram
        await this.client.invoke(new Api.auth.LogOut());
        
        // Disconnect the client
        await this.client.disconnect();
        // Telegram session logged out and disconnected - console.error removed to prevent JSON corruption
      }

      // Clear the dynamic session
      this.dynamicSession = null;
      this.client = null;
      this.authorizationInProgress = false;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Successfully logged out from Telegram",
              note: "You will need to authorize again to use Telegram functions",
            }, null, 2),
          },
        ],
      };

    } catch (error) {
      // Even if logout fails, clear our local state
      this.dynamicSession = null;
      this.client = null;
      this.authorizationInProgress = false;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Logged out locally (Telegram logout may have failed)",
              warning: error instanceof Error ? error.message : String(error),
              note: "You will need to authorize again to use Telegram functions",
            }, null, 2),
          },
        ],
      };
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    
    // Monitor transport for disconnection
    transport.onclose = () => {
      // MCP transport disconnected - console.error removed to prevent JSON corruption
      this.cleanup().then(() => {
        // Cleanup completed - console.error removed to prevent JSON corruption
        process.exit(0);
      }).catch((error) => {
        // Cleanup failed - console.error removed to prevent JSON corruption
        process.exit(1);
      });
    };

    await this.server.connect(transport);
    // Telegram MCP Server running on stdio - console.error removed to prevent JSON corruption
    
    // Start session timeout for dynamic sessions
    this.resetSessionTimeout();
  }
}

