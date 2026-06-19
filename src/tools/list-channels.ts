import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { collectEmailThreadListings, type EmailThreadListing } from "../adapters/email/thread-ledger";
import { collectSlackThreadListings, type SlackThreadListing } from "../adapters/slack/thread-ledger";

const ListChannelsInput = v.object({
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50))),
});

export function createListChannelsTool(input: {
  env: Env;
  agentId: string;
}): ToolDefinition {
  return defineTool({
    name: "list_channels",
    description:
      "List known conversation targets for this Flight agent. Returns recent email-thread:<id> and slack:<channel_id>:<thread_ts> targets from durable ledgers; use these exact targets with read_thread or send_message when choosing a specific conversation.",
    parameters: ListChannelsInput,
    execute: async ({ limit }) => {
      const [emailThreads, slackThreads] = await Promise.all([
        collectEmailThreadListings(input.env, input.agentId, limit),
        collectSlackThreadListings(input.env, input.agentId, limit),
      ]);
      return formatThreadTables(emailThreads, slackThreads);
    },
  });
}

function formatThreadTables(emailThreads: EmailThreadListing[], slackThreads: SlackThreadListing[]): string {
  if (emailThreads.length === 0 && slackThreads.length === 0) return "No known conversation targets.";
  return [
    emailThreads.length ? formatEmailThreadTable(emailThreads) : "",
    slackThreads.length ? formatSlackThreadTable(slackThreads) : "",
  ].filter(Boolean).join("\n\n");
}

function formatEmailThreadTable(threads: EmailThreadListing[]): string {
  return [
    "Recent email targets:",
    "| Send Target | Subject | Latest Message | Participants | Last Seen | Source |",
    "|-------------|---------|----------------|--------------|-----------|--------|",
    ...threads.map((thread) => [
      `\`${thread.sendTarget}\``,
      cell(thread.subject),
      cell(thread.lastPreview),
      `${thread.participants.map(cell).join(", ") || "-"} (${thread.messageCount})`,
      cell(thread.lastSeen || "-"),
      "email ledger",
    ].join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function formatSlackThreadTable(threads: SlackThreadListing[]): string {
  return [
    "Recent Slack targets:",
    "| Send Target | Channel | Latest Message | Participants | Last Seen | Source |",
    "|-------------|---------|----------------|--------------|-----------|--------|",
    ...threads.map((thread) => [
      `\`${thread.sendTarget}\``,
      cell(thread.channelName ? `#${thread.channelName}` : thread.channelId),
      cell(thread.lastPreview),
      `${thread.participants.map(cell).join(", ") || "-"} (${thread.messageCount})`,
      cell(thread.lastSeen || "-"),
      "slack ledger",
    ].join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function cell(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|") || "-";
}
