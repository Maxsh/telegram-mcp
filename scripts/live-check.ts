#!/usr/bin/env node
/**
 * Live verification for issue #1 (get_recent_messages: pagination, resolved
 * results, consistent ids, digest-friendly output).
 *
 * Spawns dist/index.js as a real MCP client over stdio and checks the
 * acceptance criteria from the issue handoff. Requires credentials in
 * ~/.secrets/telegram-{api-id,api-hash,session}; they are never printed.
 *
 * Run: npx tsx scripts/live-check.ts
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function readSecret(name: string): string {
  return fs.readFileSync(path.join(os.homedir(), ".secrets", name), "utf8").trim();
}

/**
 * Offset of a zone in minutes at a given instant (independent re-implementation
 * used only to cross-check the server's answer).
 */
function tzOffsetMin(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - at.getTime()) / 60000;
}

class McpClient {
  proc;
  private buffer = "";
  private pending = new Map<number, (r: any) => void>();
  private nextId = 1;

  constructor(serverPath: string, env: NodeJS.ProcessEnv) {
    this.proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"], env });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const resolve = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch {
          // ignore non-JSON noise
        }
      }
    });
    this.proc.stderr.on("data", () => {/* stderr is suppressed by the server */});
  }

  async call(method: string, params: any, timeoutMs = 180000): Promise<any> {
    const id = this.nextId++;
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const response = await promise;
    if (response.error) {
      throw new Error(response.error.message ?? JSON.stringify(response.error));
    }
    return response.result;
  }

  async tool(name: string, args: any, timeoutMs = 180000): Promise<any> {
    const result = await this.call("tools/call", { name, arguments: args }, timeoutMs);
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error(`Tool ${name} returned no text content: ${JSON.stringify(result).slice(0, 300)}`);
    }
    if (result.isError) {
      throw new Error(text);
    }
    return JSON.parse(text);
  }

  notify(method: string, params: any = {}) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  kill() {
    this.proc.kill();
  }
}

async function main() {
  const env = {
    ...process.env,
    TELEGRAM_API_ID: readSecret("telegram-api-id"),
    TELEGRAM_API_HASH: readSecret("telegram-api-hash"),
    TELEGRAM_SESSION: readSecret("telegram-session"),
  };

  const serverPath = path.join(process.cwd(), "dist", "index.js");
  const client = new McpClient(serverPath, env);

  try {
    await client.call(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "live-check", version: "1.0.0" },
      },
      30000
    );
    client.notify("notifications/initialized");

    const TZ = "Europe/Kyiv";
    const kyivToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    // ---- items 2 + 8: resolved block and tz-aware window on a normal channel ----
    const normal = await client.tool("get_recent_messages", {
      channel: "@bbcrussian", limit: 5, sinceDate: "today", tz: TZ,
    });
    record(
      "resolved block present (normal channel)",
      !!normal.resolved && typeof normal.resolved.peer === "string" && normal.resolved.type === "channel",
      `peer=${normal.resolved?.peer} type=${normal.resolved?.type}`
    );

    const sinceIso = normal.timeFilter?.since;
    const kyivOffsetMin = tzOffsetMin(TZ, new Date());
    const expectedMidnightUtc = Date.parse(`${kyivToday}T00:00:00Z`) - kyivOffsetMin * 60000;
    record(
      "sinceDate 'today' resolves to local midnight in tz",
      !!sinceIso && Math.abs(new Date(sinceIso).getTime() - expectedMidnightUtc) < 60 * 1000,
      `since=${sinceIso} (tz offset ${kyivOffsetMin} min)`
    );
    record(
      "every message within the tz window",
      Array.isArray(normal.messages) && normal.messages.every((m: any) => new Date(m.date) >= new Date(sinceIso)),
      `count=${normal.messages?.length}`
    );

    // ---- item 1: pagination through a busy channel ----
    const busy = "@huyovy_kharkiv";
    const allIds: number[] = [];
    let offsetId: number | undefined;
    let pages = 0;
    let lastPage: any = null;
    for (;;) {
      const page = await client.tool("get_recent_messages", {
        channel: busy, sinceDate: "today", tz: TZ, limit: 100, offsetId,
        fields: ["id", "date", "text", "link"],
      });
      lastPage = page;
      pages++;
      allIds.push(...page.messages.map((m: any) => m.id));
      if (!page.hasMore || !page.nextOffsetId || pages >= 5) break;
      offsetId = page.nextOffsetId;
    }
    const unique = new Set(allIds);
    record(
      "pagination covers full window without duplicates",
      unique.size === allIds.length && allIds.length > 0,
      `pages=${pages} total=${allIds.length} unique=${unique.size}`
    );
    record(
      "hasMore/nextOffsetId always present",
      typeof lastPage.hasMore === "boolean" && lastPage.nextOffsetId !== undefined,
      `final hasMore=${lastPage.hasMore}`
    );
    record(
      "fields projection applied",
      lastPage.messages.length === 0 ||
        Object.keys(lastPage.messages[0]).sort().join(",") === "date,id,link,text",
      `keys=${lastPage.messages[0] ? Object.keys(lastPage.messages[0]).sort().join(",") : "none"}`
    );

    // ---- item 2: dead/empty channel reports lastMessageDate ----
    const dead = await client.tool("get_recent_messages", {
      channel: "@kyiv_tviy", sinceDate: "today", tz: TZ, limit: 10,
    });
    record(
      "dead channel: empty window + lastMessageDate",
      dead.messagesCount === 0 && typeof dead.lastMessageDate === "string",
      `count=${dead.messagesCount} lastMessageDate=${dead.lastMessageDate}`
    );

    // ---- item 3: bare id vs -100 id resolve to the same channel ----
    const bare = await client.tool("get_recent_messages", { channel: "1496296645", limit: 1 });
    const prefixed = await client.tool("get_recent_messages", { channel: "-1001496296645", limit: 1 });
    record(
      "bare id and -100 id resolve to the same channel",
      bare.resolved?.id === prefixed.resolved?.id &&
        bare.resolved?.peer === prefixed.resolved?.peer &&
        bare.resolved?.type === "channel",
      `bare=${bare.resolved?.peer} prefixed=${prefixed.resolved?.peer}`
    );

    // ---- item 2: unresolvable channel errors loudly ----
    let unresolvedErrored = false;
    try {
      await client.tool("get_recent_messages", { channel: "-1009999999999", limit: 1 });
    } catch (e: any) {
      unresolvedErrored = /Could not resolve/.test(e.message ?? "");
    }
    record("unresolvable channel errors loudly", unresolvedErrored, "");

    // ---- item 3: collectible-username channel (username must not be null) ----
    const info = await client.tool("get_channel_info", { channel: "@tviy_kyiv" });
    record(
      "get_channel_info returns username + peer",
      typeof info.username === "string" && info.username.length > 1 && typeof info.peer === "string",
      `username=${info.username} peer=${info.peer} type=${info.type}`
    );

    // ---- item 5: output shaping ----
    const compact = await client.tool("get_recent_messages", {
      channel: "@bbcrussian", limit: 5, maxTextLength: 20,
    });
    record(
      "maxTextLength truncation",
      compact.messages.every(
        (m: any) => typeof m.text === "string" && m.text.length <= 20
      ),
      ""
    );

    const noMedia = await client.tool("get_recent_messages", {
      channel: busy, sinceDate: "today", tz: TZ, limit: 100, excludeMedia: true,
    });
    record(
      "excludeMedia drops captionless media",
      noMedia.messages.every((m: any) => m.text !== "[Media/Non-text message]"),
      `count=${noMedia.messagesCount}`
    );

    // ---- item 4: batch fetch with a bad channel mixed in ----
    const multi = await client.tool("get_messages_multi", {
      channels: ["@bbcrussian", "-1009999999999", "1496296645"],
      limit: 3, sinceDate: "today", tz: TZ,
    });
    const okEntries = multi.results?.filter((r: any) => r.ok) ?? [];
    const badEntries = multi.results?.filter((r: any) => !r.ok) ?? [];
    record(
      "get_messages_multi: per-channel ok/error",
      multi.summary?.requested === 3 && okEntries.length === 2 && badEntries.length === 1,
      `summary=${JSON.stringify(multi.summary)}`
    );
    record(
      "get_messages_multi entries carry resolved + messages",
      okEntries.every((r: any) => r.resolved && Array.isArray(r.messages)),
      ""
    );

    // ---- items 6 + 7: media captions, mediaType, link, forwardedFrom ----
    const mediaSample = await client.tool("get_recent_messages", {
      channel: "@Tsaplienko", limit: 30,
    });
    const withMedia = mediaSample.messages.filter((m: any) => m.mediaType);
    const withLink = mediaSample.messages.filter((m: any) => typeof m.link === "string" && m.link.startsWith("https://t.me/"));
    const captioned = mediaSample.messages.filter(
      (m: any) => m.mediaType && m.mediaType !== "webpage" && m.text !== "[Media/Non-text message]"
    );
    record(
      "mediaType and t.me link present",
      withMedia.length > 0 && withLink.length > 0,
      `media=${withMedia.length} links=${withLink.length} of ${mediaSample.messages.length}`
    );
    record(
      "captioned media carry caption text",
      captioned.length > 0,
      `captioned=${captioned.length}`
    );

    // ---- handoff bug: search_messages works with full handling ----
    const search = await client.tool("search_messages", { channel: "@bbcrussian", query: "the", limit: 3 });
    record(
      "search_messages works (resolved + messages)",
      Array.isArray(search.messages) && !!search.resolved,
      `count=${search.resultsCount}`
    );

    // ---- handoff bug + item 3: get_available_channels returns peer ----
    const channels = await client.tool("get_available_channels", { limit: 10 });
    record(
      "get_available_channels returns peer fields",
      channels.totalFound > 0 && channels.channels.every((c: any) => typeof c.peer === "string"),
      `totalFound=${channels.totalFound} firstPeer=${channels.channels?.[0]?.peer}`
    );
  } finally {
    client.kill();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("live-check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
