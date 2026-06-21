import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { EmailReplyTarget, DiscordReplyTarget, FlightTurnPayload, SlackReplyTarget, TelegramReplyTarget } from "../adapters/types";
import type { Env } from "../env";
import { buildReplyThreadHeaders, composeEmailReplyBody, normalizeEmailAddress } from "../adapters/email";
import {
  appendEmailThreadEvent,
  buildThreadedReplyQuote,
  parseEmailThreadTarget,
  readEmailThreadById,
} from "../adapters/email/thread-ledger";
import { markdownToSlackMrkdwn } from "../adapters/slack/format";
import {
  appendSlackThreadEvent,
  parseSlackThreadTarget,
  slackThreadTarget,
} from "../adapters/slack/thread-ledger";
import { markdownToDiscordMarkdown, chunkDiscordMessage } from "../adapters/discord/format";
import {
  appendDiscordThreadEvent,
  parseDiscordThreadTarget,
  discordThreadTarget,
} from "../adapters/discord/thread-ledger";
import { markdownToTelegramHtml, chunkTelegramMessage } from "../adapters/telegram/format";
import {
  appendTelegramThreadEvent,
  parseTelegramThreadTarget,
  telegramThreadTarget,
} from "../adapters/telegram/thread-ledger";
import { appendAwarenessEntry, assistantAwarenessEntry } from "../awareness/store";

const SendMessageInput = v.object({
  body: v.pipe(v.string(), v.minLength(1), v.maxLength(40_000)),
  subject: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(300))),
  target: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(300))),
});

export function createSendMessageTool(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload;
}): ToolDefinition {
  return defineTool({
    name: "send_message",
    description:
      "Send the user-visible reply for the active messages-only surface. For email, provide only the human-readable email body; Flight supplies authorized recipients, thread headers, and native-style quoted history. For Slack, provide the Slack message body; Flight posts it with Slack mrkdwn formatting. For Discord, provide the message body; Flight posts it with Discord markdown formatting, splitting messages over 2000 chars. For Telegram, provide the message body; Flight posts it with Telegram HTML formatting, splitting messages over 4096 chars. Optional target accepts email-thread:<id>, slack:<channel_id>:<thread_ts>, slack:<channel_id>, discord:<channel_id>:<thread_id>, discord:<channel_id>, telegram:<chat_id>:<reply_to_message_id>, telegram:<chat_id>, or a raw Slack/Discord channel id when the active turn has that provider context.",
    parameters: SendMessageInput,
    execute: async ({ body, subject, target: requestedTarget }, signal) => {
      const target = await resolveReplyTarget({
        env: input.env,
        turn: input.turn,
        requestedTarget,
      });
      if (!target) throw new Error("This turn has no reply target.");

      if (target.kind === "email") {
        const resolvedSubject = subject || target.subject;
        const deliveredBody = composeEmailReplyBody(body, target.replyQuote);
        const result = await sendEmail(input.env, target.toolsToken, {
          to: target.to,
          cc: target.cc?.length ? target.cc : undefined,
          subject: resolvedSubject,
          body: deliveredBody,
          in_reply_to: target.inReplyTo,
          references: target.references,
          log: "none",
        }, signal);

        const timestamp = new Date().toISOString();
        await appendEmailThreadEvent(input.env, input.turn.event.agentId, {
          type: "outbound",
          at: timestamp,
          channelId: target.channelId || input.turn.event.scope.channelId || input.turn.event.scope.id,
          from: target.from,
          to: target.to,
          subject: resolvedSubject,
          body,
          providerMessageId: result.messageId,
          inReplyTo: target.inReplyTo,
          references: target.references,
        }).catch((error) => {
          console.warn("Flight email thread ledger outbound append failed:", error);
        });
        await appendAwarenessEntry(input.env, input.instanceId, assistantAwarenessEntry({
          id: `delivery-${input.turn.event.delivery.id}-${result.messageId || crypto.randomUUID()}`,
          timestamp,
          adapter: input.turn.event.adapter,
          channel: input.turn.event.scope.channelId || input.turn.event.scope.id,
          text: body,
          content: [{ type: "text", text: body }],
        })).catch((error) => {
          console.warn("Flight send_message awareness append failed:", error);
        });

        return `Sent email to ${target.to.join(", ")}${result.messageId ? ` (message id ${result.messageId})` : ""}.`;
      }

      if (target.kind === "slack") {
        const result = await sendSlackMessage(target, body, signal);
        const timestamp = new Date().toISOString();
        await appendSlackThreadEvent(input.env, input.turn.event.agentId, {
          type: "outbound",
          at: timestamp,
          channelId: result.channel || target.channel,
          channelName: target.channelName,
          threadTs: target.threadTs,
          messageTs: result.ts,
          userId: target.botUserId || "agent",
          userName: "agent",
          body,
          sourceEventType: "flight_send_message",
        }).catch((error) => {
          console.warn("Flight Slack thread ledger outbound append failed:", error);
        });
        await appendAwarenessEntry(input.env, input.instanceId, assistantAwarenessEntry({
          id: `delivery-${input.turn.event.delivery.id}-${result.ts || crypto.randomUUID()}`,
          timestamp,
          adapter: input.turn.event.adapter,
          channel: input.turn.event.scope.channelId || `slack:${target.channelName ? `#${target.channelName}` : result.channel || target.channel}`,
          text: body,
          content: [{ type: "text", text: body }],
        })).catch((error) => {
          console.warn("Flight Slack send_message awareness append failed:", error);
        });

        const destination = target.threadTs
          ? `${target.channel} thread ${target.threadTs}`
          : target.channel;
        return `Sent Slack message to ${destination}${result.ts ? ` (ts ${result.ts})` : ""}.`;
      }

      if (target.kind === "discord") {
        const results = await sendDiscordMessage(target, body, signal);
        const timestamp = new Date().toISOString();
        const lastMessageId = results[results.length - 1]?.id;
        await appendDiscordThreadEvent(input.env, input.turn.event.agentId, {
          type: "outbound",
          at: timestamp,
          channelId: target.channel,
          channelName: target.channelName,
          threadId: target.threadId,
          messageId: lastMessageId,
          userId: target.botUserId || "agent",
          userName: "agent",
          body,
          sourceEventType: "flight_send_message",
        }).catch((error) => {
          console.warn("Flight Discord thread ledger outbound append failed:", error);
        });
        await appendAwarenessEntry(input.env, input.instanceId, assistantAwarenessEntry({
          id: `delivery-${input.turn.event.delivery.id}-${lastMessageId || crypto.randomUUID()}`,
          timestamp,
          adapter: input.turn.event.adapter,
          channel: input.turn.event.scope.channelId || `discord:${target.channelName ? `#${target.channelName}` : target.channel}`,
          text: body,
          content: [{ type: "text", text: body }],
        })).catch((error) => {
          console.warn("Flight Discord send_message awareness append failed:", error);
        });

        const destination = target.threadId
          ? `${target.channel} thread ${target.threadId}`
          : target.channel;
        return `Sent Discord message to ${destination}${lastMessageId ? ` (message id ${lastMessageId})` : ""}.`;
      }

      if (target.kind === "telegram") {
        const results = await sendTelegramMessage(target, body, signal);
        const timestamp = new Date().toISOString();
        const lastMessageId = results[results.length - 1]?.messageId;
        await appendTelegramThreadEvent(input.env, input.turn.event.agentId, {
          type: "outbound",
          at: timestamp,
          chatId: target.chatId,
          chatName: target.chatName,
          chatType: target.chatType,
          messageId: lastMessageId,
          replyToMessageId: target.replyToMessageId,
          userId: target.botUserId || "agent",
          userName: "agent",
          body,
          sourceEventType: "flight_send_message",
        }).catch((error) => {
          console.warn("Flight Telegram thread ledger outbound append failed:", error);
        });
        await appendAwarenessEntry(input.env, input.instanceId, assistantAwarenessEntry({
          id: `delivery-${input.turn.event.delivery.id}-${lastMessageId || crypto.randomUUID()}`,
          timestamp,
          adapter: input.turn.event.adapter,
          channel: input.turn.event.scope.channelId || `telegram:${target.chatName || target.chatId}`,
          text: body,
          content: [{ type: "text", text: body }],
        })).catch((error) => {
          console.warn("Flight Telegram send_message awareness append failed:", error);
        });

        const destination = target.replyToMessageId
          ? `${target.chatId} (reply to ${target.replyToMessageId})`
          : target.chatId;
        return `Sent Telegram message to ${destination}${lastMessageId ? ` (message id ${lastMessageId})` : ""}.`;
      }

      if (target.kind === "webhook") {
        const response = await fetch(target.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
          },
          body: JSON.stringify({
            body,
            subject,
            agentId: input.turn.event.agentId,
            scope: input.turn.event.scope,
            deliveryId: input.turn.event.delivery.id,
          }),
          signal,
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || `Webhook delivery failed (${response.status}).`);
        await appendAwarenessEntry(input.env, input.instanceId, assistantAwarenessEntry({
          id: `delivery-${input.turn.event.delivery.id}-${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          adapter: input.turn.event.adapter,
          channel: input.turn.event.scope.channelId || input.turn.event.scope.id,
          text: body,
        })).catch((error) => {
          console.warn("Flight webhook send awareness append failed:", error);
        });
        return "Sent webhook message.";
      }

      throw new Error("Unsupported reply target kind.");
    },
  });
}

async function resolveReplyTarget(input: {
  env: Env;
  turn: FlightTurnPayload;
  requestedTarget?: string;
}): Promise<FlightTurnPayload["event"]["replyTarget"]> {
  const activeTarget = input.turn.event.replyTarget;
  if (!input.requestedTarget?.trim()) return activeTarget;

  const parsedEmail = parseEmailThreadTarget(input.requestedTarget);
  if (parsedEmail) return resolveEmailTarget(input, parsedEmail);

  const parsedSlack = parseSlackThreadTarget(input.requestedTarget);
  if (parsedSlack) return resolveSlackTarget(input.turn, parsedSlack);

  const parsedDiscord = parseDiscordThreadTarget(input.requestedTarget);
  if (parsedDiscord) return resolveDiscordTarget(input.turn, parsedDiscord);

  const parsedTelegram = parseTelegramThreadTarget(input.requestedTarget);
  if (parsedTelegram) return resolveTelegramTarget(input.turn, parsedTelegram);

  throw new Error(`Unsupported send_message target "${input.requestedTarget}". Expected email-thread:<id>, slack:<channel_id>:<thread_ts>, slack:<channel_id>, discord:<channel_id>:<thread_id>, discord:<channel_id>, telegram:<chat_id>:<reply_to_message_id>, telegram:<chat_id>, or a raw Slack/Discord channel id.`);
}

async function resolveEmailTarget(
  input: {
    env: Env;
    turn: FlightTurnPayload;
    requestedTarget?: string;
  },
  parsed: { threadId: string; inputTarget: string },
): Promise<EmailReplyTarget> {
  const activeTarget = input.turn.event.replyTarget;
  if (activeTarget?.kind === "email" && activeTarget.threadTarget === parsed.inputTarget) {
    return activeTarget;
  }
  if (activeTarget?.kind !== "email") {
    throw new Error("Email thread targets require an active email reply context.");
  }

  const records = await readEmailThreadById(input.env, input.turn.event.agentId, parsed.threadId);
  const latestInbound = records
    .filter((record) => record.type === "inbound" && !!record.from)
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    [0];
  if (!latestInbound?.from) {
    throw new Error(`No known inbound email exists for ${parsed.inputTarget}.`);
  }

  const priorRecords = records.filter((record) => record !== latestInbound);
  const currentBody = latestInbound.body?.trim() || "";
  const replyQuote = currentBody
    ? buildThreadedReplyQuote({
      records: priorRecords,
      currentBody,
      currentFrom: latestInbound.from,
      currentSentAt: latestInbound.at,
    })
    : undefined;
  const replyHeaders = buildReplyThreadHeaders(latestInbound.messageId, latestInbound.references);
  const to = normalizeEmailAddress(latestInbound.from);
  if (!to) throw new Error(`Could not resolve recipient for ${parsed.inputTarget}.`);

  return {
    kind: "email",
    to: [to],
    from: latestInbound.to?.[0] || activeTarget.from,
    channelId: latestInbound.channelId,
    subject: replySubject(latestInbound.subject),
    inReplyTo: replyHeaders.in_reply_to,
    references: replyHeaders.references,
    replyQuote,
    threadId: parsed.threadId,
    threadTarget: parsed.inputTarget,
    toolsToken: activeTarget.toolsToken,
  } satisfies EmailReplyTarget;
}

function resolveSlackTarget(
  turn: FlightTurnPayload,
  parsed: { channel: string; threadTs?: string; inputTarget: string },
): SlackReplyTarget {
  const activeTarget = turn.event.replyTarget;
  if (activeTarget?.kind !== "slack") {
    throw new Error("Slack targets require an active Slack reply context.");
  }

  return {
    kind: "slack",
    channel: parsed.channel,
    channelName: activeTarget.channelName,
    threadTs: parsed.threadTs,
    botToken: activeTarget.botToken,
    botUserId: activeTarget.botUserId,
    teamId: activeTarget.teamId,
    threadTarget: slackThreadTarget(parsed.channel, parsed.threadTs),
  } satisfies SlackReplyTarget;
}

function resolveDiscordTarget(
  turn: FlightTurnPayload,
  parsed: { channel: string; threadId?: string; inputTarget: string },
): DiscordReplyTarget {
  const activeTarget = turn.event.replyTarget;
  if (activeTarget?.kind !== "discord") {
    throw new Error("Discord targets require an active Discord reply context.");
  }

  return {
    kind: "discord",
    channel: parsed.channel,
    channelName: activeTarget.channelName,
    threadId: parsed.threadId,
    botToken: activeTarget.botToken,
    botUserId: activeTarget.botUserId,
    guildId: activeTarget.guildId,
    threadTarget: discordThreadTarget(parsed.channel, parsed.threadId),
  } satisfies DiscordReplyTarget;
}

function resolveTelegramTarget(
  turn: FlightTurnPayload,
  parsed: { chatId: string; replyToMessageId?: string; inputTarget: string },
): TelegramReplyTarget {
  const activeTarget = turn.event.replyTarget;
  if (activeTarget?.kind !== "telegram") {
    throw new Error("Telegram targets require an active Telegram reply context.");
  }

  return {
    kind: "telegram",
    chatId: parsed.chatId,
    chatType: activeTarget.chatType,
    chatName: activeTarget.chatName,
    messageId: activeTarget.messageId,
    replyToMessageId: parsed.replyToMessageId,
    botToken: activeTarget.botToken,
    botUserId: activeTarget.botUserId,
    threadTarget: telegramThreadTarget(parsed.chatId, parsed.replyToMessageId),
  } satisfies TelegramReplyTarget;
}

function replySubject(subject: string | undefined): string {
  const trimmed = subject?.trim() || "(no subject)";
  return /^re:/iu.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

async function sendEmail(
  env: Env,
  toolsToken: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ messageId?: string }> {
  const url = env.TINYFAT_EMAIL_SEND_URL?.trim() || "https://tinyfat.com/api/email/send";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${toolsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Email send failed (${response.status}): ${text}`);
  }
  const parsed = text ? JSON.parse(text) as { messageId?: string; id?: string } : {};
  return { messageId: parsed.messageId || parsed.id };
}

async function sendSlackMessage(
  target: SlackReplyTarget,
  body: string,
  signal?: AbortSignal,
): Promise<{ channel?: string; ts?: string }> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: target.channel,
      text: markdownToSlackMrkdwn(body),
      ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Slack send failed (${response.status}): ${text}`);
  }
  const parsed = text ? JSON.parse(text) as { ok?: boolean; error?: string; channel?: string; ts?: string } : {};
  if (parsed.ok === false) {
    throw new Error(`Slack send failed: ${parsed.error || "unknown_error"}`);
  }
  return { channel: parsed.channel, ts: parsed.ts };
}

const DISCORD_API = "https://discord.com/api/v10";

async function sendDiscordMessage(
  target: DiscordReplyTarget,
  body: string,
  signal?: AbortSignal,
): Promise<Array<{ id?: string }>> {
  const chunks = chunkDiscordMessage(markdownToDiscordMarkdown(body), 2000);
  const results: Array<{ id?: string }> = [];

  for (const chunk of chunks) {
    const response = await fetch(`${DISCORD_API}/channels/${target.channel}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${target.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: chunk,
        ...(target.threadId ? { message_reference: { message_id: target.threadId, channel_id: target.channel } } : {}),
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Discord send failed (${response.status}): ${text}`);
    }
    const parsed = text ? JSON.parse(text) as { id?: string } : {};
    results.push({ id: parsed.id });
  }

  return results;
}

async function sendTelegramMessage(
  target: TelegramReplyTarget,
  body: string,
  signal?: AbortSignal,
): Promise<Array<{ messageId?: string }>> {
  const chunks = chunkTelegramMessage(markdownToTelegramHtml(body), 4096);
  const results: Array<{ messageId?: string }> = [];
  const chatId = target.chatId;
  let firstReplyId = target.replyToMessageId;

  for (const chunk of chunks) {
    const url = new URL("https://api.telegram.org");
    url.pathname = `/bot${target.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text: chunk,
        parse_mode: "HTML",
        ...(firstReplyId ? { reply_to_message_id: Number(firstReplyId) } : {}),
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Telegram send failed (${response.status}): ${text}`);
    }
    const parsed = text ? JSON.parse(text) as { ok?: boolean; description?: string; result?: { message_id?: number } } : {};
    if (parsed.ok === false) {
      throw new Error(`Telegram send failed: ${parsed.description || "unknown_error"}`);
    }
    const msgId = parsed.result?.message_id ? String(parsed.result.message_id) : undefined;
    results.push({ messageId: msgId });
    // Only reply to the original message on the first chunk
    firstReplyId = undefined;
  }

  return results;
}
