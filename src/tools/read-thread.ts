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
      "Read the transcript for a known conversation target, currently email-thread:<id>, phone-..., slack:<channel_id>:<thread_ts>, slack:<channel_id>, or a raw Slack channel/DM/group id. By default this does not change read state; pass mark: \"read\" or mark: \"unread\" only when you deliberately want to update listener state.",
    parameters: ReadThreadInput,
    execute: async ({ target, limit, mark }) => {
      const emailTarget = parseEmailThreadTarget(target);
      if (emailTarget) {
        const records = await readEmailThreadById(input.env, input.agentId, emailTarget.threadId, limit);
        if (records.length === 0) return `No transcript found for ${emailTarget.inputTarget}.`;
        return withMarkResult(
          formatEmailThreadTranscript(emailTarget.inputTarget, records),
          await applyMark(input.env, input.agentId, emailTarget.inputTarget, mark),
        );
      }

      const phoneTarget = parsePhoneThreadTarget(target);
      if (phoneTarget) {
        const records = await readPhoneThreadByTarget(input.env, input.agentId, phoneTarget, limit);
        if (records.length === 0) return `No transcript found for ${phoneTarget.inputTarget}.`;
        return withMarkResult(
          formatPhoneThreadTranscript(phoneTarget.inputTarget, records),
          await applyMark(input.env, input.agentId, phoneTarget.inputTarget, mark),
        );
      }

      const slackTarget = parseSlackThreadTarget(target);
      if (slackTarget) {
        const records = await readSlackThreadByTarget(input.env, input.agentId, slackTarget, limit);
        if (records.length === 0) return `No transcript found for ${slackTarget.inputTarget}.`;
        return withMarkResult(
          formatSlackThreadTranscript(slackTarget.inputTarget, records),
          await applyMark(input.env, input.agentId, slackTarget.inputTarget, mark),
        );
      }

      throw new Error(`Invalid conversation target "${target}". Expected email-thread:<id>, phone-..., slack:<channel_id>:<thread_ts>, slack:<channel_id>, or a raw Slack channel/DM/group id.`);
    },
  });
}

function formatEmailThreadTranscript(target: string, records: EmailThreadLedgerRecord[]): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${sender(record)}`,
      record.subject ? `Subject: ${record.subject}` : "",
      "",
      normalizeText(record.body) || "(no body captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatPhoneThreadTranscript(target: string, records: PhoneThreadLedgerRecord[]): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${phoneSender(record)}`,
      `Transport: ${record.transport || "unknown"}`,
      record.conversationId ? `Conversation: ${record.conversationId}` : "",
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function formatSlackThreadTranscript(target: string, records: SlackThreadLedgerRecord[]): string {
  const lines = [
    `Thread: ${target}`,
    "",
    ...records.map((record) => [
      `## ${record.at || "(unknown time)"} - ${slackSender(record)}`,
      record.channelName ? `Channel: #${record.channelName}` : `Channel: ${record.channelId}`,
      record.threadTs ? `Thread ts: ${record.threadTs}` : "",
      record.messageTs ? `Message ts: ${record.messageTs}` : "",
      "",
      normalizeText(record.body) || "(no text captured)",
    ].filter(Boolean).join("\n")),
  ];
  return lines.join("\n\n");
}

function sender(record: EmailThreadLedgerRecord): string {
  if (record.type === "outbound") return record.from || "agent";
  return record.from || "unknown sender";
}

function slackSender(record: SlackThreadLedgerRecord): string {
  if (record.type === "outbound") return record.userName || "agent";
  return record.userName || record.userId || "unknown Slack sender";
}

function phoneSender(record: PhoneThreadLedgerRecord): string {
  if (record.type === "outbound") return record.sender || record.to || "agent";
  return record.from || "unknown phone sender";
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
