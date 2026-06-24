import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import {
  parseEmailThreadTarget,
  readEmailThreadById,
  type EmailThreadLedgerRecord,
} from "../adapters/email/thread-ledger";
import {
  parsePhoneThreadTarget,
  readPhoneThreadByTarget,
  type PhoneThreadLedgerRecord,
} from "../adapters/phone/thread-ledger";
import {
  parseSlackThreadTarget,
  readSlackThreadByTarget,
  type SlackThreadLedgerRecord,
} from "../adapters/slack/thread-ledger";
import {
  parseDiscordThreadTarget,
  readDiscordThreadByTarget,
  type DiscordThreadLedgerRecord,
} from "../adapters/discord/thread-ledger";
import {
  parseTelegramThreadTarget,
  readTelegramThreadByTarget,
  type TelegramThreadLedgerRecord,
} from "../adapters/telegram/thread-ledger";
import { formatContactList, formatResolvedIdentity, readContactBook, type ContactBook } from "../listener/contacts";
import { setListenerThreadReadState } from "../listener/store";
import type { ListenerReadMark } from "../listener/types";

const ReadThreadInput = v.object({
  target: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
  mark: v.optional(v.union([
    v.literal("unchanged"),
    v.literal("read"),
    v.literal("unread"),
  ])),
});

export function createReadThreadTool(input: {
  env: Env;
  agentId: string;
}): ToolDefinition {
  return defineTool({
    name: "read_thread",
    description:
      "Read the transcript for a known conversation target, currently email-thread:<id>, phone-..., slack:<channel_id>:<thread_ts>, slack:<channel_id>, discord:<channel_id>:<thread_id>, discord:<channel_id>, telegram:<chat_id>:<reply_to_message_id>, telegram:<chat_id>, or a raw Slack/Discord channel id. By default this does not change read state; pass mark: \"read\" or mark: \"unread\" only when you deliberately want to update listener state.",
    parameters: ReadThreadInput,
    execute: async ({ target, limit, mark }) => {
      const contactBook = await readContactBook(input.env, input.agentId);
      const emailTarget = parseEmailThreadTarget(target);
      if (emailTarget) {
        const records = await readEmailThreadById(input.env, input.agentId, emailTarget.threadId, limit);
        if (records.length === 0) return `No transcript found for ${emailTarget.inputTarget}.`;
        return withMarkResult(
          formatEmailThreadTranscript(emailTarget.inputTarget, records, contactBook),
          await applyMark(input.env, input.agentId, emailTarget.inputTarget, mark),
        );
      }

      const phoneTarget = parsePhoneThreadTarget(target);
      if (phoneTarget) {
        const records = await readPhoneThreadByTarget(input.env, input.agentId, phoneTarget, limit);
        if (records.length === 0) return `No transcript found for ${phoneTarget.inputTarget}.`;
        return withMarkResult(
          formatPhoneThreadTranscript(phoneTarget.inputTarget, records, contactBook),
          await applyMark(input.env, input.agentId, phoneTarget.inputTarget, mark),
        );
      }

      const slackTarget = parseSlackThreadTarget(target);
      if (slackTarget) {
        const records = await readSlackThreadByTarget(input.env, input.agentId, slackTarget, limit);
        if (records.length === 0) return `No transcript found for ${slackTarget.inputTarget}.`;
        return withMarkResult(
          formatSlackThreadTranscript(slackTarget.inputTarget, records, contactBook),
          await applyMark(input.env, input.agentId, slackTarget.inputTarget, mark),
        );
      }

      const discordTarget = parseDiscordThreadTarget(target);
      if (discordTarget) {
        const records = await readDiscordThreadByTarget(input.env, input.agentId, discordTarget, limit);
        if (records.length === 0) return `No transcript found for ${discordTarget.inputTarget}.`;
        return withMarkResult(
          formatDiscordThreadTranscript(discordTarget.inputTarget, records, contactBook),
          await applyMark(input.env, input.agentId, discordTarget.inputTarget, mark),
        );
      }

      const telegramTarget = parseTelegramThreadTarget(target);
      if (telegramTarget) {
        const records = await readTelegramThreadByTarget(input.env, input.agentId, telegramTarget, limit);
        if (records.length === 0) return `No transcript found for ${telegramTarget.inputTarget}.`;
        return withMarkResult(
          formatTelegramThreadTranscript(telegramTarget.inputTarget, records, contactBook),
          await applyMark(input.env, input.agentId, telegramTarget.inputTarget, mark),
        );
      }

      throw new Error(`Invalid conversation target "${target}". Expected email-thread:<id>, phone-..., slack:<channel_id>:<thread_ts>, slack:<channel_id>, discord:<channel_id>:<thread_id>, discord:<channel_id>, telegram:<chat_id>:<reply_to_message_id>, telegram:<chat_id>, or a raw Slack/Discord channel id.`);
    },
  });
}

function formatEmailThreadTranscript(
  target: string,
  records: EmailThreadLedgerRecord[],
  contactBook: ContactBook,
): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${emailSender(record, contactBook)}`,
      record.subject ? `Subject: ${record.subject}` : "",
      "",
      normalizeText(record.body) || "(no body captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatPhoneThreadTranscript(
  target: string,
  records: PhoneThreadLedgerRecord[],
  contactBook: ContactBook,
): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${phoneSender(record, contactBook)}`,
      `Transport: ${record.transport || "unknown"}`,
      record.conversationId ? `Conversation: ${record.conversationId}` : "",
      phoneParticipants(record, contactBook),
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatSlackThreadTranscript(
  target: string,
  records: SlackThreadLedgerRecord[],
  contactBook: ContactBook,
): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${slackSender(record, contactBook)}`,
      record.channelName ? `Channel: #${record.channelName}` : `Channel: ${record.channelId}`,
      record.threadTs ? `Thread ts: ${record.threadTs}` : "",
      record.messageTs ? `Message ts: ${record.messageTs}` : "",
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatDiscordThreadTranscript(
  target: string,
  records: DiscordThreadLedgerRecord[],
  contactBook: ContactBook,
): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${discordSender(record, contactBook)}`,
      record.channelName ? `Channel: #${record.channelName}` : `Channel: ${record.channelId}`,
      record.threadId ? `Thread id: ${record.threadId}` : "",
      record.replyToMessageId ? `Reply to: ${record.replyToMessageId}` : "",
      record.messageId ? `Message id: ${record.messageId}` : "",
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatTelegramThreadTranscript(
  target: string,
  records: TelegramThreadLedgerRecord[],
  contactBook: ContactBook,
): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${telegramSender(record, contactBook)}`,
      record.chatName ? `Chat: ${record.chatName}` : `Chat: ${record.chatId}`,
      record.chatType ? `Type: ${record.chatType}` : "",
      record.messageId ? `Message id: ${record.messageId}` : "",
      record.replyToMessageId ? `Reply to: ${record.replyToMessageId}` : "",
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function emailSender(record: EmailThreadLedgerRecord, contactBook: ContactBook): string {
  if (record.type === "outbound") return record.from || "agent";
  return formatResolvedIdentity(contactBook, record.from) || "unknown sender";
}

function slackSender(record: SlackThreadLedgerRecord, contactBook: ContactBook): string {
  if (record.type === "outbound") return record.userName || "agent";
  const userIdLabel = formatResolvedIdentity(contactBook, record.userId);
  if (record.userId && userIdLabel && userIdLabel !== record.userId) return userIdLabel;
  return formatResolvedIdentity(contactBook, record.userName) || userIdLabel || "unknown Slack sender";
}

function discordSender(record: DiscordThreadLedgerRecord, contactBook: ContactBook): string {
  if (record.type === "outbound") return record.userName || "agent";
  const userIdLabel = formatResolvedIdentity(contactBook, record.userId);
  if (record.userId && userIdLabel && userIdLabel !== record.userId) return userIdLabel;
  return formatResolvedIdentity(contactBook, record.displayName) || formatResolvedIdentity(contactBook, record.userName) || userIdLabel || "unknown Discord sender";
}

function telegramSender(record: TelegramThreadLedgerRecord, contactBook: ContactBook): string {
  if (record.type === "outbound") return record.userName || "agent";
  const userIdLabel = formatResolvedIdentity(contactBook, record.userId);
  if (record.userId && userIdLabel && userIdLabel !== record.userId) return userIdLabel;
  return formatResolvedIdentity(contactBook, record.displayName) || formatResolvedIdentity(contactBook, record.userName) || userIdLabel || "unknown Telegram sender";
}

function phoneSender(record: PhoneThreadLedgerRecord, contactBook: ContactBook): string {
  if (record.type === "outbound") return record.sender || record.to || "agent";
  return formatResolvedIdentity(contactBook, record.from) || "unknown phone sender";
}

function phoneParticipants(record: PhoneThreadLedgerRecord, contactBook: ContactBook): string {
  const participants = formatContactList(contactBook, [
    record.from,
    record.to,
    record.sender,
    ...(record.recipients || []),
  ]);
  return participants.length ? `Participants: ${participants.join(", ")}` : "";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

async function applyMark(
  env: Env,
  agentId: string,
  target: string,
  mark: ListenerReadMark | undefined,
): Promise<string> {
  if (!mark || mark === "unchanged") return "";
  const state = await setListenerThreadReadState(env, agentId, target, mark === "read", { readBy: "agent" });
  return state ? `Read state: ${state.read ? "read" : "unread"}.` : "";
}

function withMarkResult(transcript: string, markResult: string): string {
  return markResult ? `${transcript}\n\n${markResult}` : transcript;
}
