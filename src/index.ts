#!/usr/bin/env node

// Suppress all console output to prevent JSON corruption in MCP communication
const originalConsole = console;
console.log = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};
console.trace = () => {};
// Keep console.error suppressed except for critical errors
const originalError = console.error;
console.error = () => {};

// Suppress process warnings and set environment variables to disable logging
process.removeAllListeners('warning');
process.env.NODE_NO_WARNINGS = '1';
process.env.TELEGRAM_CLIENT_LOGGER_DISABLED = '1';
process.env.DEBUG = '';

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
  channel: z.string().describe("Channel username or ID (e.g., @channelname or channel ID)"),
  limit: z.number().optional().default(10).describe("Number of recent messages to retrieve (default: 10, max: 100)"),
  sinceMinutes: z.number().optional().describe("Get messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Get messages from the last N hours"),
  sinceDate: z.string().optional().describe("Get messages since this date (ISO format: 2023-12-01T10:00:00Z)"),
});

const GetChannelInfoSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
});

const SearchMessagesSchema = z.object({
  channel: z.string().describe("Channel username or ID"),
  query: z.string().describe("Search query"),
  limit: z.number().optional().default(10).describe("Number of messages to retrieve (default: 10, max: 100)"),
  sinceMinutes: z.number().optional().describe("Search messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Search messages from the last N hours"),
  sinceDate: z.string().optional().describe("Search messages since this date (ISO format: 2023-12-01T10:00:00Z)"),
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
  limit: z.number().optional().default(10).describe("Number of messages to retrieve (default: 10, max: 100)"),
  sinceMinutes: z.number().optional().describe("Get messages from the last N minutes"),
  sinceHours: z.number().optional().describe("Get messages from the last N hours"),
  sinceDate: z.string().optional().describe("Get messages since this date (ISO format: 2023-12-01T10:00:00Z)"),
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

class TelegramMCPServer {
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

  private calculateCutoffDate(sinceMinutes?: number, sinceHours?: number, sinceDate?: string): Date | null {
    if (sinceDate) {
      return new Date(sinceDate);
    }
    if (sinceMinutes) {
      return new Date(Date.now() - sinceMinutes * 60 * 1000);
    }
    if (sinceHours) {
      return new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    }
    return null;
  }

  private async initializeTelegramClient(): Promise<void> {
    // Check if we already have a session (static from env or dynamic)
    const sessionString = process.env.TELEGRAM_SESSION || this.dynamicSession || "";
    
    this.session = new StringSession(sessionString);
    this.client = new TelegramClient(this.session, parseInt(this.apiId), this.apiHash, {
      connectionRetries: 5,
    });

    // If we have a session string, try to connect
    if (sessionString) {
      try {
        if (!this.client.connected) {
          await this.client.connect();
        }
        // Test the connection by getting info about ourselves
        await this.client.getMe();
        return; // Successfully connected with existing session
      } catch (error) {
        // Failed to connect with existing session - console.error removed to prevent JSON corruption
        // Clear the invalid dynamic session and continue to require authorization
        this.dynamicSession = null;
        if (this.client) {
          await this.client.disconnect();
        }
      }
    }

    // If no valid session, throw error indicating authorization is needed
    throw new Error("TELEGRAM_AUTHORIZATION_REQUIRED: No valid session found. Please use telegram_authorize to authenticate.");
  }

  private async ensureClientReady(): Promise<void> {
    if (!this.client || !this.client.connected) {
      await this.initializeTelegramClient();
    }
    
    // Reset session timeout on activity (for dynamic sessions)
    this.resetSessionTimeout();
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
        tools: [
          {
            name: "get_recent_messages",
            description: "Get recent messages from a Telegram channel, group, or private chat",
            inputSchema: {
              type: "object",
              properties: {
                channel: {
                  type: "string",
                  description: "Channel username (@channelname), group username, private chat username (@username), phone number (+1234567890), or chat ID",
                },
                limit: {
                  type: "number",
                  description: "Number of recent messages to retrieve (default: 10, max: 100)",
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
                  description: "Get messages since this date (ISO format: 2023-12-01T10:00:00Z)",
                },
              },
              required: ["channel"],
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
                  description: "Search messages since this date (ISO format: 2023-12-01T10:00:00Z)",
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
                  description: "Get messages since this date (ISO format: 2023-12-01T10:00:00Z)",
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
          case "get_available_channels":
            return await this.getAvailableChannels(args);
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
    });
  }

  private async getRecentMessages(args: unknown): Promise<CallToolResult> {
    const { channel, limit, sinceMinutes, sinceHours, sinceDate } = GetRecentMessagesSchema.parse(args);

    try {
      await this.ensureClientReady();
    } catch (error) {
      if (error instanceof Error && error.message.includes("TELEGRAM_AUTHORIZATION_REQUIRED")) {
        return this.createAuthRequiredResponse();
      }
      throw error;
    }

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Resolve channel entity
      const entity = await this.client.getEntity(channel);
      
      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(sinceMinutes, sinceHours, sinceDate);
      
      // Get recent messages
      const messages = await this.client.getMessages(entity, { limit: cutoffDate ? limit * 3 : limit });

      let filteredMessages = messages.map((msg: any) => {
        const date = new Date(msg.date * 1000);
        
        // Determine sender info based on entity type
        let sender = "Unknown";
        let isOutgoing = false;
        
        if ((entity as any).className === "User") {
          // Private chat
          if (msg.out) {
            sender = "You";
            isOutgoing = true;
          } else {
            const firstName = (entity as any).firstName || "";
            const lastName = (entity as any).lastName || "";
            sender = `${firstName} ${lastName}`.trim() || (entity as any).username || "Contact";
          }
        } else {
          // Channel or group
          if (msg.out) {
            sender = "You";
            isOutgoing = true;
          } else {
            sender = msg.fromId ? `ID: ${msg.fromId}` : "Channel";
          }
        }
        
        const messageData: any = {
          id: msg.id,
          date: date.toISOString(),
          timestamp: msg.date,
          sender,
          text: msg.text || "[Media/Non-text message]",
        };

        // Add additional fields based on entity type
        if ((entity as any).className === "User") {
          messageData.isOutgoing = isOutgoing;
          messageData.messageType = msg.text ? "text" : "media";
        } else {
          messageData.views = msg.views || 0;
        }

        if (msg.replyToMsgId) {
          messageData.replyToMsgId = msg.replyToMsgId;
        }

        return messageData;
      });

      // Apply time filtering if specified
      if (cutoffDate) {
        filteredMessages = filteredMessages.filter(msg => 
          new Date(msg.timestamp * 1000) >= cutoffDate
        );
        // Limit after filtering
        filteredMessages = filteredMessages.slice(0, limit);
      }

      const channelTitle = (entity as any).title || (entity as any).firstName || channel;

      const result: any = {
        channel: channelTitle,
        messagesCount: filteredMessages.length,
        messages: filteredMessages,
      };

      // Add time filter info to result
      if (cutoffDate) {
        result.timeFilter = {
          since: cutoffDate.toISOString(),
          sinceMinutes,
          sinceHours,
          sinceDate,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get messages from channel ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getChannelInfo(args: unknown): Promise<CallToolResult> {
    const { channel } = GetChannelInfoSchema.parse(args);

    try {
      await this.ensureClientReady();
    } catch (error) {
      if (error instanceof Error && error.message.includes("TELEGRAM_AUTHORIZATION_REQUIRED")) {
        return this.createAuthRequiredResponse();
      }
      throw error;
    }

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
    const { channel, query, limit, sinceMinutes, sinceHours, sinceDate } = SearchMessagesSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      const entity = await this.client.getEntity(channel);
      
      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(sinceMinutes, sinceHours, sinceDate);
      
      // Search messages - if we have time filter, get more results to account for filtering
      const searchLimit = cutoffDate ? Math.min(limit * 5, 100) : limit;
      
      const result = await this.client.invoke(
        new Api.messages.Search({
          peer: entity,
          q: query,
          limit: searchLimit,
          filter: new Api.InputMessagesFilterEmpty(),
        })
      );

      let messages = (result as any).messages?.map((msg: any) => {
        const date = new Date(msg.date * 1000);
        const sender = msg.fromId ? `ID: ${msg.fromId}` : "Channel";
        
        return {
          id: msg.id,
          date: date.toISOString(),
          timestamp: msg.date,
          sender,
          text: msg.message || "[Media/Non-text message]",
          views: msg.views || 0,
        };
      }) || [];

      // Apply time filtering if specified
      if (cutoffDate) {
        messages = messages.filter((msg: any) => 
          new Date(msg.timestamp * 1000) >= cutoffDate
        );
        // Limit after filtering
        messages = messages.slice(0, limit);
      }

      const channelTitle = (entity as any).title || (entity as any).firstName || channel;

      const searchResult: any = {
        channel: channelTitle,
        query,
        resultsCount: messages.length,
        messages,
      };

      // Add time filter info to result
      if (cutoffDate) {
        searchResult.timeFilter = {
          since: cutoffDate.toISOString(),
          sinceMinutes,
          sinceHours,
          sinceDate,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(searchResult, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search messages in channel ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getAvailableChannels(args: unknown): Promise<CallToolResult> {
    const { limit, includeGroups } = GetAvailableChannelsSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Get all dialogs (conversations)
      const dialogs = await this.client.getDialogs({ limit });

      const channels: any[] = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        
        // Check if entity exists and is a channel or supergroup
        if (entity && (entity as any).className === "Channel") {
          const isChannel = (entity as any).broadcast;
          const isGroup = (entity as any).megagroup;
          
          // Include channels always, groups only if requested
          if (isChannel || (includeGroups && isGroup)) {
            const channelInfo: any = {
              id: (entity as any).id?.toString(),
              title: (entity as any).title,
              username: (entity as any).username ? `@${(entity as any).username}` : null,
              type: isChannel ? "channel" : "group",
              participantsCount: (entity as any).participantsCount || 0,
              isPrivate: !(entity as any).username,
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
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get available channels: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async markMessagesRead(args: unknown): Promise<CallToolResult> {
    const { channel, messageIds, maxId } = MarkMessagesReadSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Resolve channel entity
      const entity = await this.client.getEntity(channel);
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
              await this.client.invoke(
                new Api.messages.ReadMessageContents({
                  id: messageIds,
                })
              );
              apiMethod = "ReadMessageContents";
            } catch (contentError) {
              // Fall back to ReadHistory
              result = await this.client.invoke(
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
            result = await this.client.invoke(
              new Api.messages.ReadHistory({
                peer: entity,
                maxId: maxId,
              })
            );
            markedCount = maxId;
          } else {
            // Mark all messages as read in private chat
            const messages = await this.client.getMessages(entity, { limit: 1 });
            if (messages.length > 0) {
              const latestMessageId = messages[0].id;
              result = await this.client.invoke(
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
          result = await this.client.invoke(
            new Api.messages.ReadHistory({
              peer: entity,
              maxId: Math.max(...messageIds),
            })
          );
          markedCount = messageIds.length;
        } else if (maxId) {
          result = await this.client.invoke(
            new Api.messages.ReadHistory({
              peer: entity,
              maxId: maxId,
            })
          );
          markedCount = maxId;
        } else {
          // Mark all messages as read (get latest message ID first)
          const messages = await this.client.getMessages(entity, { limit: 1 });
          if (messages.length > 0) {
            const latestMessageId = messages[0].id;
            result = await this.client.invoke(
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
        const dialogs = await this.client.getDialogs({ limit: 100 });
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

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Get dialogs (conversations) that the user has access to
      const dialogs = await this.client.getDialogs({ limit });
      
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
    const { contact, limit, sinceMinutes, sinceHours, sinceDate } = GetPrivateMessagesSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Resolve contact entity - could be username, phone, or user ID
      let entity;
      try {
        entity = await this.client.getEntity(contact);
      } catch (error) {
        throw new Error(`Could not find contact "${contact}". Make sure the username (@username), phone number (+1234567890), or user ID is correct and you have a conversation with this contact.`);
      }

      // Verify it's a private chat (User entity)
      if ((entity as any).className !== "User") {
        throw new Error(`"${contact}" is not a private chat. Use get_recent_messages for channels and groups.`);
      }
      
      // Calculate cutoff date if time filtering is requested
      const cutoffDate = this.calculateCutoffDate(sinceMinutes, sinceHours, sinceDate);
      
      // Get recent messages from the private conversation
      const messages = await this.client.getMessages(entity, { limit: cutoffDate ? limit * 3 : limit });

      let filteredMessages = messages.map((msg: any) => {
        const date = new Date(msg.date * 1000);
        
        // Determine sender info
        let sender = "Unknown";
        let isOutgoing = false;
        
        if (msg.out) {
          sender = "You";
          isOutgoing = true;
        } else {
          // For incoming messages in private chat, it's from the contact
          const firstName = (entity as any).firstName || "";
          const lastName = (entity as any).lastName || "";
          sender = `${firstName} ${lastName}`.trim() || (entity as any).username || "Contact";
        }
        
        return {
          id: msg.id,
          date: date.toISOString(),
          timestamp: msg.date,
          sender,
          isOutgoing,
          text: msg.text || "[Media/Non-text message]",
          messageType: msg.text ? "text" : "media",
          replyToMsgId: msg.replyToMsgId || null,
        };
      });

      // Apply time filtering if specified
      if (cutoffDate) {
        filteredMessages = filteredMessages.filter(msg => 
          new Date(msg.timestamp * 1000) >= cutoffDate
        );
        // Limit after filtering
        filteredMessages = filteredMessages.slice(0, limit);
      }

      const contactName = `${(entity as any).firstName || ""} ${(entity as any).lastName || ""}`.trim() 
        || (entity as any).username 
        || contact;

      const result: any = {
        success: true,
        contact: contactName,
        contactId: (entity as any).id.toString(),
        contactUsername: (entity as any).username || null,
        messageCount: filteredMessages.length,
        messages: filteredMessages,
        timeFilter: cutoffDate ? {
          since: cutoffDate.toISOString(),
          sinceMinutes,
          sinceHours,
          sinceDate,
        } : null,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get private messages from ${contact}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getChatStatus(args: unknown): Promise<CallToolResult> {
    const { chat } = GetChatStatusSchema.parse(args);

    if (!this.client) {
      throw new Error("Telegram client not initialized");
    }

    try {
      // Resolve chat entity
      const entity = await this.client.getEntity(chat);
      const entityType = (entity as any).className;
      
      // Get dialog info to check unread status
      const dialogs = await this.client.getDialogs({ limit: 100 });
      const targetDialog = dialogs.find(d => d.entity && (d.entity as any).id === (entity as any).id);
      
      // Get recent messages to see read status
      const recentMessages = await this.client.getMessages(entity, { limit: 5 });
      
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
          text: (msg.text || "[Media/Non-text message]").substring(0, 100) + (msg.text && msg.text.length > 100 ? "..." : ""),
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
      this.client = new TelegramClient(this.session, parseInt(this.apiId), this.apiHash, {
        connectionRetries: 5,
      });

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

// Start the server
const server = new TelegramMCPServer();

// Enhanced cleanup on process exit
process.on('exit', async () => {
  // Process exiting - console.error removed to prevent JSON corruption
  await server.cleanup();
});

process.on('SIGINT', async () => {
  // Received SIGINT - console.error removed to prevent JSON corruption
  await server.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  // Received SIGTERM - console.error removed to prevent JSON corruption
  await server.cleanup();
  process.exit(0);
});

server.start().catch((error) => {
  // Failed to start server - console.error removed to prevent JSON corruption
  process.exit(1);
});
