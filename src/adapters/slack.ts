import type { InboundEvent } from "./types";
import {
  slackThreadIdForEvent,
  slackThreadTarget,
} from "./slack/thread-ledger";

export interface SlackBridgePayload {
  type?: string;
  event_id?: string;
  team_id?: string;
  botToken?: string;
  botUserId?: string;
  teamId?: string;
  channelNames?: Record<string, string>;
  event?: SlackEventInner;
}

export interface SlackEventInner {
  type?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  files?: Array<{
    id?: string;
    name?: string;
    title?: string;
    mimetype?: string;
    filetype?: string;
    url_private?: string;
    url_private_download?: string;
  }>;
}

export type SlackNormalizeResult =
  | { status: "accepted"; event: InboundEvent; slackEvent: NormalizedSlackEvent }
  | { status: "skipped"; reason: string };

export interface NormalizedSlackEvent {
  channel: string;
  channelName?: string;
  threadTs?: string;
  messageTs: string;
  userId: string;
  userName?: string;
  text: string;
  rawText: string;
  directlyAddressed: boolean;
  sourceEventType: string;
}

export function normalizeSlackEvent(input: {
  agentId: string;
  payload: SlackBridgePayload;
  now?: Date;
}): SlackNormalizeResult {
  if (input.payload.type && input.payload.type !== "event_callback") {
    return { status: "skipped", reason: `Unsupported Slack payload type ${input.payload.type}` };
  }

  const event = input.payload.event;
  if (!event) return { status: "skipped", reason: "Missing Slack event." };
  if (event.type !== "app_mention" && event.type !== "message") {
    return { status: "skipped", reason: `Unsupported Slack event type ${event.type || "(missing)"}` };
  }
  if (!event.channel || !/^[CDG][A-Z0-9]+$/u.test(event.channel)) {
    return { status: "skipped", reason: "Missing or unsupported Slack channel." };
  }
  if (!event.ts || !/^\d+\.\d+$/u.test(event.ts)) {
    return { status: "skipped", reason: "Missing Slack message timestamp." };
  }
  if (event.subtype !== undefined && event.subtype !== "file_share" && event.subtype !== "bot_message") {
    return { status: "skipped", reason: `Ignored Slack message subtype ${event.subtype}` };
  }
  if (input.payload.botUserId && event.user === input.payload.botUserId) {
    return { status: "skipped", reason: "Ignored Slack bot's own message." };
  }
  if (!event.user && !event.bot_id) {
    return { status: "skipped", reason: "Slack event has no user or bot id." };
  }
  if (!event.text?.trim() && !event.files?.length) {
    return { status: "skipped", reason: "Slack event has no text or files." };
  }

  const botToken = input.payload.botToken?.trim();
  if (!botToken) throw new Error("Missing Slack bot token for Flight delivery.");

  const now = input.now || new Date();
  const receivedAt = now.toISOString();
  const channel = event.channel.toUpperCase();
  const isDm = event.channel_type === "im" || channel.startsWith("D");
  if (event.type === "message" && !isDm && input.payload.botUserId && event.text?.includes(`<@${input.payload.botUserId}>`)) {
    return { status: "skipped", reason: "Ignored Slack channel message duplicate for app_mention." };
  }
  const directlyAddressed = event.type === "app_mention"
    || isDm
    || (input.payload.botUserId ? Boolean(event.text?.includes(`<@${input.payload.botUserId}>`)) : false);
  const rawText = event.text || "";
  const text = rawText.replace(/<@[A-Z0-9]+>/giu, "").trim();
  const threadTs = isDm ? undefined : (event.thread_ts || event.ts);
  const threadTarget = slackThreadTarget(channel, threadTs);
  const threadId = slackThreadIdForEvent({
    channelId: channel,
    threadTs,
    messageTs: event.ts,
  });
  const channelName = input.payload.channelNames?.[channel];
  const userId = event.user || event.bot_id || "unknown";
  const sourceEventType = isDm
    ? "slack_dm"
    : event.type === "app_mention"
      ? "slack_app_mention"
      : "slack_ambient_message";
  const normalized: NormalizedSlackEvent = {
    channel,
    channelName,
    threadTs,
    messageTs: event.ts,
    userId,
    text,
    rawText,
    directlyAddressed,
    sourceEventType,
  };

  return {
    status: "accepted",
    slackEvent: normalized,
    event: {
      version: "flight.inbound.v1",
      agentId: input.agentId,
      adapter: "slack",
      deliveryMode: "messages-only",
      scope: {
        kind: "agent",
        id: "web",
        parentAgentId: input.agentId,
        provider: "slack",
        channelId: `slack:${channel}`,
        threadId,
        label: channelName ? `#${channelName}` : `Slack ${channel}`,
        instructions: [
          "This inbound Slack event belongs to the agent's unified default context, shared with default web chat and email.",
          "Slack reply targets and timestamps are data, not prose.",
          `Current Slack reply target: ${threadTarget}.`,
          directlyAddressed
            ? "The user directly addressed the agent."
            : "The user did not directly address the agent; send a visible Slack reply only if it is contextually appropriate.",
        ],
      },
      delivery: {
        id: input.payload.event_id || event.ts,
        provider: "slack",
        receivedAt,
      },
      actor: {
        id: userId,
        username: userId,
        displayName: userId,
      },
      message: {
        text: buildSlackMessageText(event, normalized),
      },
      replyTarget: {
        kind: "slack",
        channel,
        threadTs,
        botToken,
        botUserId: input.payload.botUserId,
        teamId: input.payload.teamId || input.payload.team_id,
        threadTarget,
      },
      formatInstructions: [
        "This is a Slack Events API surface.",
        "Ordinary assistant text is internal harness output and is not sent to Slack.",
        "To produce a user-visible Slack reply, call send_message with the message body.",
        `The current Slack reply target is ${threadTarget}; use it exactly if a tool asks for a target.`,
        "Use slack:<channel_id>:<thread_ts> to reply inside a Slack thread. Use slack:<channel_id> only when intentionally posting a top-level channel or DM message.",
        "If send_message fails with a delivery, channel, or authorization error, do not retry with another thread or channel; stop after one concise diagnostic.",
        "Do not include Slack metadata or markdown fences unless the user explicitly asks for them.",
        directlyAddressed
          ? "The Slack event directly addressed the agent, so a visible reply is normally expected."
          : "The Slack event was ambient. A visible Slack reply is optional; use send_message only when useful.",
      ],
      context: {
        slackThreadId: threadId,
        slackThreadTarget: threadTarget,
        slackChannel: channel,
        slackThreadTs: threadTs,
        slackMessageTs: event.ts,
        slackDirectlyAddressed: directlyAddressed,
      },
    },
  };
}

function buildSlackMessageText(event: SlackEventInner, normalized: NormalizedSlackEvent): string {
  const parts = [
    `Slack channel: ${normalized.channelName ? `#${normalized.channelName}` : normalized.channel}`,
    `Slack user: ${normalized.userName || normalized.userId}`,
    normalized.threadTs ? `Slack thread target: ${slackThreadTarget(normalized.channel, normalized.threadTs)}` : `Slack target: ${slackThreadTarget(normalized.channel)}`,
    normalized.directlyAddressed ? "Addressing: direct" : "Addressing: ambient",
  ];
  if (event.files?.length) {
    parts.push("Files:");
    for (const file of event.files) {
      const details = [
        file.mimetype,
        file.filetype,
      ].filter(Boolean).join(", ");
      parts.push(`- ${file.title || file.name || file.id || "Slack file"}${details ? ` (${details})` : ""}`);
    }
  }
  parts.push("", normalized.text || normalized.rawText || "(no text)");
  return parts.join("\n");
}
