import type { InboundEvent } from "./types";
import {
  discordThreadIdForEvent,
  discordThreadTarget,
} from "./discord/thread-ledger";

export interface DiscordBridgePayload {
  type?: string;
  event_id?: string;
  guild_id?: string;
  botToken?: string;
  botUserId?: string;
  applicationId?: string;
  channelNames?: Record<string, string>;
  userNames?: Record<string, string>;
  event?: DiscordEventInner;
}

export interface DiscordEventInner {
  type?: string;
  channel_id?: string;
  channel_type?: number;
  guild_id?: string;
  id?: string;
  author?: {
    id?: string;
    username?: string;
    global_name?: string;
    bot?: boolean;
  };
  content?: string;
  thread_id?: string;
  id_message?: string;
  referenced_message?: {
    id?: string;
    channel_id?: string;
  };
  attachments?: Array<{
    id?: string;
    filename?: string;
    content_type?: string;
    size?: number;
    url?: string;
  }>;
  embeds?: Array<Record<string, unknown>>;
}

export type DiscordNormalizeResult =
  | { status: "accepted"; event: InboundEvent; discordEvent: NormalizedDiscordEvent }
  | { status: "skipped"; reason: string };

export interface NormalizedDiscordEvent {
  channelId: string;
  channelName?: string;
  threadId?: string;
  replyToMessageId?: string;
  messageId: string;
  userId: string;
  userName?: string;
  displayName?: string;
  text: string;
  rawText: string;
  directlyAddressed: boolean;
  isDm: boolean;
  sourceEventType: string;
}

export function normalizeDiscordEvent(input: {
  agentId: string;
  payload: DiscordBridgePayload;
  now?: Date;
}): DiscordNormalizeResult {
  const event = input.payload.event;
  if (!event) return { status: "skipped", reason: "Missing Discord event." };
  if (event.type && event.type !== "MESSAGE_CREATE") {
    return { status: "skipped", reason: `Unsupported Discord event type ${event.type}` };
  }
  if (!event.channel_id || !/^\d{17,20}$/u.test(event.channel_id)) {
    return { status: "skipped", reason: "Missing or unsupported Discord channel id." };
  }
  if (!event.id || !/^\d{17,20}$/u.test(event.id)) {
    return { status: "skipped", reason: "Missing Discord message id." };
  }
  if (event.author?.bot === true) {
    return { status: "skipped", reason: "Ignored Discord bot's own message." };
  }
  if (!event.author?.id) {
    return { status: "skipped", reason: "Discord event has no author id." };
  }
  if (!event.content?.trim() && !event.attachments?.length) {
    return { status: "skipped", reason: "Discord event has no text or attachments." };
  }

  const botToken = input.payload.botToken?.trim();
  if (!botToken) throw new Error("Missing Discord bot token for Flight delivery.");

  const now = input.now || new Date();
  const receivedAt = now.toISOString();
  const channelId = event.channel_id;
  const isDm = event.channel_type === 1 || !event.guild_id;
  const threadId = event.thread_id || undefined;
  const replyToMessageId = event.referenced_message?.id || undefined;

  const botUserId = input.payload.botUserId || input.payload.applicationId;
  const mentionPattern = botUserId ? new RegExp(`<@!?${botUserId}>`, "iu") : null;
  const directlyAddressed = isDm || (mentionPattern ? mentionPattern.test(event.content || "") : false);

  const rawText = event.content || "";
  const text = rawText.replace(/<@!?\d+>/giu, "").trim();

  const threadTarget = discordThreadTarget(channelId, replyToMessageId);
  const threadIdHash = discordThreadIdForEvent({
    channelId,
    replyToMessageId,
  });

  const channelName = input.payload.channelNames?.[channelId];
  const userId = event.author.id;
  const userName = event.author.username || userId;
  const displayName = event.author.global_name || userName;
  const sourceEventType = isDm
    ? "discord_dm"
    : directlyAddressed
      ? "discord_mention"
      : "discord_ambient_message";

  const normalized: NormalizedDiscordEvent = {
    channelId,
    channelName,
    threadId,
    replyToMessageId,
    messageId: event.id,
    userId,
    userName,
    displayName,
    text,
    rawText,
    directlyAddressed,
    isDm,
    sourceEventType,
  };

  return {
    status: "accepted",
    discordEvent: normalized,
    event: {
      version: "flight.inbound.v1",
      agentId: input.agentId,
      adapter: "discord",
      deliveryMode: "messages-only",
      scope: {
        kind: "agent",
        id: "web",
        parentAgentId: input.agentId,
        provider: "discord",
        channelId: `discord:${discordChannelDisplayLabel(channelId, channelName)}`,
        threadId: threadIdHash,
        label: channelName ? `#${channelName}` : `Discord ${channelId}`,
        instructions: [
          "This inbound Discord event belongs to the agent's unified default context, shared with default web chat and email.",
          "Discord reply targets and message ids are data, not prose.",
          `Current Discord reply target: ${threadTarget}.`,
          directlyAddressed
            ? "The user directly addressed the agent."
            : "The user did not directly address the agent; send a visible Discord reply only if it is contextually appropriate.",
        ],
      },
      delivery: {
        id: input.payload.event_id || event.id,
        provider: "discord",
        receivedAt,
      },
      actor: {
        id: userId,
        username: userName,
        displayName,
      },
      message: {
        text: directlyAddressed
          ? buildDiscordDisplayMessageText(event, normalized)
          : buildDiscordAmbientMessageText([normalized], {
            temperature: 1,
            recentParticipants: 1,
            timeSinceMyLastMs: Infinity,
          }),
        modelText: directlyAddressed
          ? buildDiscordModelMessageText(event, normalized)
          : buildDiscordAmbientMessageText([normalized], {
            temperature: 1,
            recentParticipants: 1,
            timeSinceMyLastMs: Infinity,
          }),
      },
      replyTarget: {
        kind: "discord",
        channel: channelId,
        channelName,
        replyToMessageId,
        botToken,
        botUserId: botUserId || undefined,
        guildId: input.payload.guild_id || event.guild_id,
        threadTarget,
      },
      formatInstructions: [
        "This is a Discord gateway/webhook surface.",
        "Ordinary assistant text is internal harness output and is not sent to Discord.",
        "To produce a user-visible Discord reply, call send_message with the message body.",
        `The current Discord reply target is ${threadTarget}; use it exactly if a tool asks for a target.`,
        "Use discord:<channel_id>:<message_id> to create a Discord message reply. Use discord:<channel_id> to post in that channel, DM, or Discord thread channel.",
        "Discord messages have a 2000 character limit. If your reply exceeds this, Flight will split it into multiple messages automatically.",
        "Do not include Discord metadata or markdown fences unless the user explicitly asks for them.",
        directlyAddressed
          ? "The Discord event directly addressed the agent, so a visible reply is normally expected."
          : "The Discord event was ambient. A visible Discord reply is optional; use send_message only when useful.",
      ],
      context: {
        discordThreadId: threadIdHash,
        discordThreadTarget: threadTarget,
        discordChannel: channelId,
        discordThreadIdRaw: threadId,
        discordReplyToMessageId: replyToMessageId,
        discordMessageId: event.id,
        discordDirectlyAddressed: directlyAddressed,
      },
    },
  };
}

function discordChannelDisplayLabel(channel: string, channelName?: string): string {
  return channelName ? `#${channelName}` : channel;
}

function buildDiscordDisplayMessageText(event: DiscordEventInner, normalized: NormalizedDiscordEvent): string {
  const parts: string[] = [];
  const messageText = normalized.text || normalized.rawText || "";
  if (messageText.trim()) parts.push(messageText.trim());
  appendDiscordFileDisplay(parts, event);
  return parts.join("\n").trim() || "(no text)";
}

function buildDiscordModelMessageText(event: DiscordEventInner, normalized: NormalizedDiscordEvent): string {
  const parts = [
    `Discord channel: ${normalized.channelName ? `#${normalized.channelName}` : normalized.channelId}`,
    `Discord user: ${normalized.displayName || normalized.userName || normalized.userId}`,
    normalized.replyToMessageId ? `Discord reply target: ${discordThreadTarget(normalized.channelId, normalized.replyToMessageId)}` : `Discord target: ${discordThreadTarget(normalized.channelId)}`,
    normalized.directlyAddressed ? "Addressing: direct" : "Addressing: ambient",
  ];
  appendDiscordFileDisplay(parts, event);
  parts.push("", normalized.text || normalized.rawText || "(no text)");
  return parts.join("\n");
}

function buildDiscordAmbientMessageText(
  messages: NormalizedDiscordEvent[],
  _summary: {
    temperature: number;
    recentParticipants: number;
    timeSinceMyLastMs: number;
  },
): string {
  const first = messages[0];
  const channelLabel = first?.channelName ? `#${first.channelName}` : `Discord ${first?.channelId || "channel"}`;
  const messageLines = messages.map((message) => {
    const who = message.displayName
      ? `${message.displayName} (${message.userId})`
      : message.userId;
    const target = message.replyToMessageId
      ? ` [Reply target: ${discordThreadTarget(message.channelId, message.replyToMessageId)}; message_id: ${message.messageId}; reply_to: ${message.replyToMessageId}]`
      : ` [Reply target: ${discordThreadTarget(message.channelId)}; message_id: ${message.messageId}]`;
    return `${who}${target}: ${message.text || message.rawText || "(no text)"}`;
  }).join("\n");

  return [
    `[AMBIENT] A conversation is happening in ${channelLabel}. New unseen messages since your last ambient wake:`,
    "",
    messageLines,
    "",
    "You're observing this conversation naturally. You were not directly addressed. If you choose to respond to a specific Discord thread, use that message's exact Reply target with send_message. Keep it brief and conversational. If you have nothing to add, use the yield_no_action tool.",
  ].join("\n");
}

function appendDiscordFileDisplay(parts: string[], event: DiscordEventInner): void {
  if (!event.attachments?.length) return;
  parts.push("Files:");
  for (const attachment of event.attachments) {
    const details = [
      attachment.content_type,
      typeof attachment.size === "number" ? `${attachment.size} bytes` : undefined,
    ].filter(Boolean).join(", ");
    parts.push(`- ${attachment.filename || attachment.id || "Discord file"}${details ? ` (${details})` : ""}`);
  }
}
