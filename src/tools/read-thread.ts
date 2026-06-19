import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import {
  parseEmailThreadTarget,
  readEmailThreadById,
  type EmailThreadLedgerRecord,
} from "../adapters/email/thread-ledger";
import {
  parseSlackThreadTarget,
  readSlackThreadByTarget,
  type SlackThreadLedgerRecord,
} from "../adapters/slack/thread-ledger";

const ReadThreadInput = v.object({
  target: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
});

export function createReadThreadTool(input: {
  env: Env;
  agentId: string;
}): ToolDefinition {
  return defineTool({
    name: "read_thread",
    description:
      "Read the transcript for a known conversation target, currently email-thread:<id>, slack:<channel_id>:<thread_ts>, slack:<channel_id>, or a raw Slack channel/DM/group id. Use this after list_channels when several conversations are active and you need context before choosing a send_message target.",
    parameters: ReadThreadInput,
    execute: async ({ target, limit }) => {
      const emailTarget = parseEmailThreadTarget(target);
      if (emailTarget) {
        const records = await readEmailThreadById(input.env, input.agentId, emailTarget.threadId, limit);
        if (records.length === 0) return `No transcript found for ${emailTarget.inputTarget}.`;
        return formatEmailThreadTranscript(emailTarget.inputTarget, records);
      }

      const slackTarget = parseSlackThreadTarget(target);
      if (slackTarget) {
        const records = await readSlackThreadByTarget(input.env, input.agentId, slackTarget, limit);
        if (records.length === 0) return `No transcript found for ${slackTarget.inputTarget}.`;
        return formatSlackThreadTranscript(slackTarget.inputTarget, records);
      }

      throw new Error(`Invalid conversation target "${target}". Expected email-thread:<id>, slack:<channel_id>:<thread_ts>, slack:<channel_id>, or a raw Slack channel/DM/group id.`);
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

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}
