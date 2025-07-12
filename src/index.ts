#!/usr/bin/env node

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

// Validation schemas
const GetRecentMessagesSchema = z.object({
  channel: z.string().describe("Channel username or ID (e.g., @channelname or channel ID)"),
  limit: z.number().optional().default(10).describe("Number of recent messages to retrieve (default: 10, max: 100)"),
});

const GetChannelInfoSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
});

const SearchMessagesSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
  query: z.string().describe("Search query"),
  limit: z.number().optional().default(10).describe("Number of messages to retrieve (default: 10, max: 100)"),
});

class TelegramMCPServer {
  private server: Server;
  private client: TelegramClient | null = null;
  private session: StringSession;

  constructor() {
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
  }

  private async initializeTelegramClient(): Promise<void> {
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    const sessionString = process.env.TELEGRAM_SESSION;

    if (!apiId || !apiHash) {
      throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables are required");
    }

    this.session = new StringSession(sessionString || "");
    this.client = new TelegramClient(this.session, parseInt(apiId), apiHash, {
      connectionRetries: 5,
    });

    if (!this.client.connected) {
      await this.client.start({
        phoneNumber: async () => {
          throw new Error("Phone number authentication not supported in MCP server. Please provide TELEGRAM_SESSION.");
        },
        password: async () => {
          throw new Error("Password authentication not supported in MCP server. Please provide TELEGRAM_SESSION.");
        },
        phoneCode: async () => {
          throw new Error("Phone code authentication not supported in MCP server. Please provide TELEGRAM_SESSION.");
        },
        onError: (err: any) => console.error("Telegram auth error:", err),
      });
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_recent_messages",
            description: "Get recent messages from a Telegram channel",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (e.g., @channelname) or channel ID",
                },
                limit: {
                  type: "number",
                  description: "Number of recent messages to retrieve (default: 10, max: 100)",
                  default: 10,
                  minimum: 1,
                  maximum: 100,
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "get_channel_info",
            description: "Get information about a Telegram channel",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (e.g., @channelname) or channel ID",
                },
              },
              required: ["channel"],
            },
          },
          {
            name: "search_messages",
            description: "Search for messages in a Telegram channel",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (e.g., @channelname) or channel ID",
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
              },
              required: ["channel", "query"],
            },
          },
        ] as Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      try {
        if (!this.client) {
          await this.initializeTelegramClient();
        }

        const { name, arguments: args } = request.params;

        switch (name) {
          case "get_recent_messages":
            return await this.getRecentMessages(args);
          case "get_channel_info":
            return await this.getChannelInfo(args);
          case "search_messages":
            return await this.searchMessages(args);
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
    });
  }

  private async getRecentMessages(args: unknown): Promise<CallToolResult> {
    const { channel, limit } = GetRecentMessagesSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Resolve channel entity
      const entity = await this.client.getEntity(channel);
      
      // Get recent messages
      const messages = await this.client.getMessages(entity, { limit });

      const formattedMessages = messages.map((msg: any) => {
        const date = new Date(msg.date * 1000).toISOString();
        const sender = msg.fromId ? `ID: ${msg.fromId}` : "Channel";
        
        return {
          id: msg.id,
          date,
          sender,
          text: msg.text || "[Media/Non-text message]",
          views: msg.views || 0,
        };
      });

      const channelTitle = (entity as any).title || (entity as any).firstName || channel;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              channel: channelTitle,
              messagesCount: formattedMessages.length,
              messages: formattedMessages,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get messages from channel ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getChannelInfo(args: unknown): Promise<CallToolResult> {
    const { channel } = GetChannelInfoSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      const entity = await this.client.getEntity(channel);
      
      let channelInfo: any = {
        id: (entity as any).id?.toString(),
        title: (entity as any).title || (entity as any).firstName,
        username: (entity as any).username,
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
            text: JSON.stringify(channelInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get channel info for ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async searchMessages(args: unknown): Promise<CallToolResult> {
    const { channel, query, limit } = SearchMessagesSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      const entity = await this.client.getEntity(channel);
      
      // Search messages
      const result = await this.client.invoke(
        new Api.messages.Search({
          peer: entity,
          q: query,
          limit,
          filter: new Api.InputMessagesFilterEmpty(),
        })
      );

      const messages = (result as any).messages?.map((msg: any) => {
        const date = new Date(msg.date * 1000).toISOString();
        const sender = msg.fromId ? `ID: ${msg.fromId}` : "Channel";
        
        return {
          id: msg.id,
          date,
          sender,
          text: msg.message || "[Media/Non-text message]",
          views: msg.views || 0,
        };
      }) || [];

      const channelTitle = (entity as any).title || (entity as any).firstName || channel;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              channel: channelTitle,
              query,
              resultsCount: messages.length,
              messages,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search messages in channel ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Telegram MCP Server running on stdio");
  }
}

// Start the server
const server = new TelegramMCPServer();
server.start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
