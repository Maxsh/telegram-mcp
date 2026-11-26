import * as assert from "node:assert/strict";
import { StringSession } from "telegram/sessions/index.js";
import { AuthKey } from "telegram/crypto/AuthKey.js";
import { TelegramMCPServer } from "../src/server.js";

/**
 * A syntactically valid session string (dc + auth key). Used as TELEGRAM_SESSION
 * in tests so StringSession construction succeeds; the fake client never uses
 * it for anything real.
 */
export const VALID_SESSION_STRING: string = await (async () => {
  const session = new StringSession("");
  session.setDC(2, "149.154.167.51", 443);
  const authKey = new AuthKey();
  await authKey.setKey(Buffer.alloc(32, 1));
  session.setAuthKey(authKey);
  return session.save() as string;
})();

/**
 * Entity / message fixtures that mimic the GramJS objects the server reads
 * (className, id, username/usernames[], broadcast, date, text/message, media...).
 */

export interface EntityOverrides {
  id?: number;
  title?: string;
  username?: string;
  usernames?: Array<{ username: string; active?: boolean }>;
  broadcast?: boolean;
  megagroup?: boolean;
  participantsCount?: number;
  about?: string;
  date?: number;
  accessHash?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export function channelEntity(over: EntityOverrides = {}): any {
  return {
    className: "Channel",
    id: 100,
    title: "Test Channel",
    username: "testchannel",
    broadcast: true,
    megagroup: false,
    participantsCount: 500,
    about: "About this channel",
    date: 1600000000,
    accessHash: "123hash",
    ...over,
  };
}

export function userEntity(over: EntityOverrides = {}): any {
  return {
    className: "User",
    id: 200,
    firstName: "Alice",
    lastName: "",
    username: "alice",
    phone: "+15551234567",
    accessHash: "456hash",
    ...over,
  };
}

export function chatEntity(over: EntityOverrides = {}): any {
  return {
    className: "Chat",
    id: 300,
    title: "Test Group",
    date: 1600000000,
    ...over,
  };
}

export interface MessageOverrides {
  id?: number;
  date?: number;
  out?: boolean;
  fromId?: any;
  message?: string;
  text?: string;
  media?: any;
  fwdFrom?: any;
  groupedId?: string | number | bigint;
  views?: number;
  replyToMsgId?: number;
}

export function message(over: MessageOverrides = {}): any {
  return {
    className: "Message",
    id: 1,
    date: 1764086530,
    out: false,
    fromId: undefined,
    message: "",
    text: undefined,
    media: undefined,
    fwdFrom: undefined,
    groupedId: undefined,
    views: undefined,
    replyToMsgId: undefined,
    ...over,
  };
}

/**
 * Generate `count` descending messages (as GramJS returns them: newest first),
 * newest message at `latestEpochSec`, one every `stepSec`.
 */
export function descendingMessages(
  count: number,
  opts: { startId?: number; latestEpochSec: number; stepSec?: number; each?: (i: number, m: any) => void } = {}
): any[] {
  const { startId = 5000, latestEpochSec, stepSec = 600, each } = opts;
  const out: any[] = [];
  for (let i = 0; i < count; i++) {
    const m = message({ id: startId - i, date: latestEpochSec - i * stepSec });
    each?.(i, m);
    out.push(m);
  }
  return out;
}

export function dialog(over: Record<string, any> = {}): any {
  return {
    entity: undefined,
    unreadCount: 0,
    unreadMentionsCount: 0,
    pinned: false,
    archived: false,
    date: 1764086500,
    topMessage: 1,
    ...over,
  };
}

export function mediaPhoto(): any {
  return { className: "MessageMediaPhoto" };
}

export function mediaDocument(mimeType: string, attributes: any[] = []): any {
  return {
    className: "MessageMediaDocument",
    document: { className: "Document", mimeType, attributes },
  };
}

export function attribute(className: string, extra: Record<string, any> = {}): any {
  return { className, ...extra };
}

/**
 * In-memory stand-in for GramJS TelegramClient. Mimics the subset of behavior
 * the server relies on, including the peer-resolution quirks:
 *  - channels only resolve via "@username" or the "-100"-prefixed id
 *    (a bare numeric id raises, like GramJS treating it as a user id)
 *  - users resolve via "@username", bare id, or phone number
 *  - basic groups resolve via the "-"-prefixed id
 *  - getMessages returns messages newest-first and offsetId is exclusive
 */
export class FakeTelegramClient {
  connected = true;
  session = { save: () => "fake-session-string" };

  calls: Array<{ method: string; args: any }> = [];

  private entities = new Map<string, any>();
  private messages = new Map<number, any[]>();
  private dialogs: any[] = [];
  private invokeHandlers = new Map<string, (rpc: any) => any>();

  phoneCodeHash?: string;
  phoneNumber?: string;

  constructor() {
    this.invokeHandlers.set("messages.Search", (rpc: any) => {
      const peerId = rpc.peer?.id;
      const q = String(rpc.q ?? "").toLowerCase();
      let list = (this.messages.get(peerId) ?? []).filter((m: any) =>
        (m.text || m.message || "").toLowerCase().includes(q)
      );
      if (rpc.offsetId) {
        list = list.filter((m: any) => m.id < rpc.offsetId);
      }
      return { className: "messages_Messages", messages: list.slice(0, rpc.limit ?? 10) };
    });

    this.invokeHandlers.set("messages.ReadHistory", () => ({}));
    this.invokeHandlers.set("messages.ReadMessageContents", () => ({}));
    this.invokeHandlers.set("auth.SendCode", () => ({ className: "auth_SentCode", phoneCodeHash: "test-hash" }));
    this.invokeHandlers.set("auth.SignIn", () => ({ className: "auth_Authorization" }));
    this.invokeHandlers.set("auth.LogOut", () => ({}));
    this.invokeHandlers.set("account.GetPassword", () => ({ className: "account_Password" }));
    this.invokeHandlers.set("auth.CheckPassword", () => ({ className: "auth_Authorization" }));
  }

  /** Override the handler for a TL class, e.g. on("auth.SignIn", () => { throw ... }) */
  on(className: string, handler: (rpc: any) => any): this {
    this.invokeHandlers.set(className, handler);
    return this;
  }

  register(entity: any): this {
    const cls = entity.className;
    if (cls === "Channel") {
      if (entity.username) this.entities.set(`@${entity.username}`, entity);
      const usernames = entity.usernames;
      if (Array.isArray(usernames)) {
        for (const u of usernames) this.entities.set(`@${u.username}`, entity);
      }
      this.entities.set(`-100${entity.id}`, entity);
    } else if (cls === "Chat") {
      this.entities.set(`-${entity.id}`, entity);
    } else if (cls === "User") {
      if (entity.username) this.entities.set(`@${entity.username}`, entity);
      this.entities.set(String(entity.id), entity);
      if (entity.phone) this.entities.set(entity.phone, entity);
    }
    return this;
  }

  setMessages(entityId: number, list: any[]): this {
    this.messages.set(
      entityId,
      [...list].sort((a, b) => b.id - a.id)
    );
    return this;
  }

  setDialogs(list: any[]): this {
    this.dialogs = list;
    return this;
  }

  entityCalls(): string[] {
    return this.calls.filter((c) => c.method === "getEntity").map((c) => c.args.id);
  }

  async getEntity(id: string): Promise<any> {
    this.calls.push({ method: "getEntity", args: { id } });
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`Could not find the input entity for ${id} (PeerUser)`);
    }
    return entity;
  }

  async getMessages(entity: any, opts: { limit?: number; offsetId?: number } = {}): Promise<any[]> {
    this.calls.push({ method: "getMessages", args: { entityId: entity.id, ...opts } });
    let list = this.messages.get(entity.id) ?? [];
    if (opts.offsetId) {
      list = list.filter((m: any) => m.id < opts.offsetId!);
    }
    return list.slice(0, opts.limit ?? 20);
  }

  async invoke(rpc: any): Promise<any> {
    this.calls.push({ method: "invoke", args: { className: rpc?.className } });
    const handler = this.invokeHandlers.get(rpc?.className);
    if (!handler) {
      throw new Error(`FakeTelegramClient: no handler for ${rpc?.className}`);
    }
    return handler(rpc);
  }

  async getDialogs(opts: { limit?: number } = {}): Promise<any[]> {
    this.calls.push({ method: "getDialogs", args: { ...opts } });
    return this.dialogs.slice(0, opts.limit ?? 20);
  }

  async getMe(): Promise<any> {
    this.calls.push({ method: "getMe", args: {} });
    return { className: "User", id: 1, firstName: "Test", username: "tester" };
  }

  async connect(): Promise<void> {
    this.calls.push({ method: "connect", args: {} });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.calls.push({ method: "disconnect", args: {} });
    this.connected = false;
  }

  invocationsOf(className: string): number {
    return this.calls.filter((c) => c.method === "invoke" && c.args.className === className).length;
  }
}

export interface TestSetup {
  server: TelegramMCPServer;
  client: FakeTelegramClient;
}

/**
 * Build a server wired to a fake client. By default TELEGRAM_SESSION is set so
 * no session-timeout timers are armed, and the fake client is injected.
 * Pass session: null for auth-required scenarios, or injectClient: false to
 * leave this.client unset (for lazy-initialization tests); in both cases stub
 * createTelegramClient so no real client is constructed.
 */
export async function makeServer(opts: { session?: string | null; injectClient?: boolean } = {}): Promise<TestSetup> {
  process.env.TELEGRAM_API_ID = "12345";
  process.env.TELEGRAM_API_HASH = "test-hash";
  if (opts.session === null) {
    delete process.env.TELEGRAM_SESSION;
  } else {
    process.env.TELEGRAM_SESSION = opts.session ?? VALID_SESSION_STRING;
  }
  const server = new TelegramMCPServer();
  const client = new FakeTelegramClient();
  if (opts.session !== null && opts.injectClient !== false) {
    (server as any).client = client;
  }
  return { server, client };
}

/** Parse the JSON payload of a successful tool result. */
export function toolJson(result: any): any {
  assert.ok(!result.isError, `expected success, got error: ${result?.content?.[0]?.text}`);
  assert.equal(typeof result.content?.[0]?.text, "string");
  return JSON.parse(result.content[0].text);
}

/** Assert a tool result is an error and return its message text. */
export function toolError(result: any): string {
  assert.ok(result.isError, `expected error, got: ${result?.content?.[0]?.text}`);
  return result.content[0].text;
}
