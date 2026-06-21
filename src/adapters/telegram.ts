import type { InboundEvent } from "./types";
import {
  telegramThreadIdForEvent,
  telegramThreadTarget,
} from "./telegram/thread-ledger";

export interface TelegramBridgePayload {
  type?: string;
  event_id?: string;
  botToken?: string;
  botUserId?: string;
  chatNames?: Record<string, string>;
  userNames?: Record<string, string>;
  update?: TelegramUpdateInner;
}

export interface TelegramUpdateInner {
  message?: TelegramMessageInner;
  edited_message?: TelegramMessageInner;
  channel_post?: TelegramMessageInner;
}

export interface TelegramMessageInner {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  chat?: TelegramChatInner;
  from?: TelegramUserInner;
  reply_to_message?: TelegramMessageInner;
  voice?: TelegramMediaFile;
  audio?: TelegramMediaFile;
  document?: TelegramMediaFile;
  photo?: TelegramPhotoSize[];
  video?: TelegramMediaFile;
  video_note?: TelegramMediaFile;
  sticker?: TelegramSticker;
}

export interface TelegramChatInner {
  id?: number;
  type?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramUserInner {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMediaFile {
  file_id?: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  title?: string;
  duration?: number;
}

export interface TelegramPhotoSize {
  file_id?: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export interface TelegramSticker {
  file_id?: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  emoji?: string;
  set_name?: string;
  is_animated?: boolean;
  is_video?: boolean;
}

export type TelegramNormalizeResult =
  | { status: "accepted"; event: InboundEvent; telegramEvent: NormalizedTelegramEvent }
  | { status: "skipped"; reason: string };

export interface NormalizedTelegramEvent {
  chatId: string;
  chatName?: string;
  chatType: string;
  messageId: string;
  replyToMessageId?: string;
  userId: string;
  userName?: string;
  displayName?: string;
  text: string;
  rawText: string;
  directlyAddressed: boolean;
  isPrivate: boolean;
  hasMedia: boolean;
  mediaDescription?: string;
  sourceEventType: string;
}

export function normalizeTelegramEvent(input: {
  agentId: string;
  payload: TelegramBridgePayload;
  now?: Date;
}): TelegramNormalizeResult {
  const update = input.payload.update;
  if (!update) return { status: "skipped", reason: "Missing Telegram update." };

  const message = update.message || update.edited_message || update.channel_post;
  if (!message) return { status: "skipped", reason: "Missing Telegram message in update." };

  if (!message.message_id || typeof message.message_id !== "number") {
    return { status: "skipped", reason: "Missing Telegram message id." };
  }
  if (!message.chat?.id) {
    return { status: "skipped", reason: "Missing Telegram chat id." };
  }

  // Channel posts have no from; use chat as actor
  const isChannelPost = !!update.channel_post;
  const fromUser = message.from;
  if (!isChannelPost && fromUser?.is_bot === true) {
    return { status: "skipped", reason: "Ignored Telegram bot's own message." };
  }
  if (!isChannelPost && !fromUser?.id) {
    return { status: "skipped", reason: "Telegram message has no sender id." };
  }

  const hasMedia = !!(message.voice || message.audio || message.document || message.photo || message.video || message.video_note || message.sticker);
  const rawText = message.text || message.caption || "";
  if (!rawText.trim() && !hasMedia) {
    return { status: "skipped", reason: "Telegram event has no text or media." };
  }

  const botToken = input.payload.botToken?.trim();
  if (!botToken) throw new Error("Missing Telegram bot token for Flight delivery.");

  const now = input.now || new Date();
  const receivedAt = message.date ? new Date(message.date * 1000).toISOString() : now.toISOString();

  const chatId = String(message.chat.id);
  const chatType = message.chat.type || "private";
  const isPrivate = chatType === "private";
  const messageId = String(message.message_id);
  const replyToMessageId = message.reply_to_message?.message_id
    ? String(message.reply_to_message.message_id)
    : undefined;

  const userId = isChannelPost
    ? String(message.chat.id)
    : String(fromUser!.id);
  const userName = isChannelPost
    ? message.chat.username || message.chat.title
    : fromUser!.username || fromUser!.first_name || userId;
  const displayName = isChannelPost
    ? message.chat.title || message.chat.username || `Channel ${chatId}`
    : [fromUser!.first_name, fromUser!.last_name].filter(Boolean).join(" ") || userName;

  const botUserId = input.payload.botUserId;
  const mentionPattern = botUserId ? new RegExp(`@${botUserId}`, "iu") : null;
  const directlyAddressed = isPrivate || (mentionPattern ? mentionPattern.test(rawText) : false);

  const text = rawText.replace(/@\w+/gu, "").trim();
  const mediaDescription = hasMedia ? describeTelegramMedia(message) : undefined;
  const threadTarget = telegramThreadTarget(chatId, replyToMessageId);
  const threadIdHash = telegramThreadIdForEvent({
    chatId,
    replyToMessageId,
    messageId,
  });

  const chatName = input.payload.chatNames?.[chatId] || message.chat.title || (isPrivate ? `DM:${displayName}` : undefined);
  const sourceEventType = isPrivate
    ? "telegram_dm"
    : directlyAddressed
      ? "telegram_mention"
      : isChannelPost
        ? "telegram_channel_post"
        : "telegram_group_message";

  const normalized: NormalizedTelegramEvent = {
    chatId,
    chatName,
    chatType,
    messageId,
    replyToMessageId,
    userId,
    userName,
    displayName,
    text: text || mediaDescription || "",
    rawText,
    directlyAddressed,
    isPrivate,
    hasMedia,
    mediaDescription,
    sourceEventType,
  };

  return {
    status: "accepted",
    telegramEvent: normalized,
    event: {
      version: "flight.inbound.v1",
      agentId: input.agentId,
      adapter: "telegram",
      deliveryMode: "messages-only",
      scope: {
        kind: "channel",
        id: threadTarget,
        parentAgentId: input.agentId,
        provider: "telegram",
        channelId: `telegram:${telegramChatDisplayLabel(chatId, chatName)}`,
        threadId: threadIdHash,
        label: chatName || `Telegram ${chatId}`,
        instructions: [
          "This inbound Telegram event belongs to the agent's unified default context, shared with default web chat and email.",
          "Telegram reply targets and message ids are data, not prose.",
          `Current Telegram reply target: ${threadTarget}.`,
          directlyAddressed
            ? "The user directly addressed the agent."
            : "The user did not directly address the agent; send a visible Telegram reply only if it is contextually appropriate.",
        ],
      },
      delivery: {
        id: input.payload.event_id || messageId,
        provider: "telegram",
        receivedAt,
      },
      actor: {
        id: userId,
        username: userName,
        displayName,
      },
      message: {
        text: directlyAddressed
          ? buildTelegramDisplayMessageText(normalized)
          : buildTelegramAmbientMessageText([normalized]),
        modelText: directlyAddressed
          ? buildTelegramModelMessageText(normalized)
          : buildTelegramAmbientMessageText([normalized]),
      },
      replyTarget: {
        kind: "telegram",
        chatId,
        chatType,
        chatName,
        messageId,
        replyToMessageId,
        botToken,
        botUserId: botUserId || undefined,
        threadTarget,
      },
      formatInstructions: [
        "This is a Telegram Bot API surface.",
        "Ordinary assistant text is internal harness output and is not sent to Telegram.",
        "To produce a user-visible Telegram reply, call send_message with the message body.",
        `The current Telegram reply target is ${threadTarget}; use it exactly if a tool asks for a target.`,
        "Use telegram:<chat_id>:<reply_to_message_id> to reply to a specific message. Use telegram:<chat_id> for a top-level reply in the chat.",
        "Telegram messages have a 4096 character limit. If your reply exceeds this, Flight will split it into multiple messages automatically.",
        "Do not include Telegram metadata or HTML tags unless the user explicitly asks for them.",
        directlyAddressed
          ? "The Telegram event directly addressed the agent, so a visible reply is normally expected."
          : "The Telegram event was ambient. A visible Telegram reply is optional; use send_message only when useful.",
      ],
      context: {
        telegramThreadId: threadIdHash,
        telegramThreadTarget: threadTarget,
        telegramChatId: chatId,
        telegramChatType: chatType,
        telegramMessageId: messageId,
        telegramReplyToMessageId: replyToMessageId,
        telegramDirectlyAddressed: directlyAddressed,
      },
    },
  };
}

function telegramChatDisplayLabel(chatId: string, chatName?: string): string {
  return chatName || chatId;
}

function describeTelegramMedia(message: TelegramMessageInner): string {
  if (message.voice) return "[Voice message]";
  if (message.audio) return `[Audio: ${message.audio.title || "audio"}]`;
  if (message.video_note) return "[Video message]";
  if (message.video) return "[Video]";
  if (message.document) return `[File: ${message.document.file_name || "document"}]`;
  if (message.photo) return "[Photo]";
  if (message.sticker) return `[Sticker: ${message.sticker.emoji || "sticker"}]`;
  return "[Media]";
}

function buildTelegramDisplayMessageText(normalized: NormalizedTelegramEvent): string {
  const parts: string[] = [];
  if (normalized.text.trim()) parts.push(normalized.text.trim());
  if (normalized.mediaDescription) parts.push(normalized.mediaDescription);
  return parts.join("\n").trim() || "(no text)";
}

function buildTelegramModelMessageText(normalized: NormalizedTelegramEvent): string {
  const parts = [
    `Telegram chat: ${normalized.chatName || normalized.chatId} (${normalized.chatType})`,
    `Telegram user: ${normalized.displayName || normalized.userName || normalized.userId}`,
    normalized.replyToMessageId
      ? `Telegram thread target: ${telegramThreadTarget(normalized.chatId, normalized.replyToMessageId)}`
      : `Telegram target: ${telegramThreadTarget(normalized.chatId)}`,
    normalized.directlyAddressed ? "Addressing: direct" : "Addressing: ambient",
  ];
  if (normalized.mediaDescription) parts.push(normalized.mediaDescription);
  parts.push("", normalized.text || normalized.rawText || "(no text)");
  return parts.join("\n");
}

function buildTelegramAmbientMessageText(messages: NormalizedTelegramEvent[]): string {
  const first = messages[0];
  const chatLabel = first?.chatName || `Telegram ${first?.chatId || "chat"}`;
  const messageLines = messages.map((message) => {
    const who = message.displayName
      ? `${message.displayName} (${message.userId})`
      : message.userId;
    const target = message.replyToMessageId
      ? ` [Reply target: ${telegramThreadTarget(message.chatId, message.replyToMessageId)}; message_id: ${message.messageId}; reply_to: ${message.replyToMessageId}]`
      : ` [Reply target: ${telegramThreadTarget(message.chatId)}; message_id: ${message.messageId}]`;
    return `${who}${target}: ${message.text || message.rawText || "(no text)"}`;
  }).join("\n");

  return [
    `[AMBIENT] A conversation is happening in ${chatLabel}. New unseen messages since your last ambient wake:`,
    "",
    messageLines,
    "",
    "You're observing this conversation naturally. You were not directly addressed. If you choose to respond, use the message's exact Reply target with send_message. Keep it brief and conversational. If you have nothing to add, use the yield_no_action tool.",
  ].join("\n");
}
