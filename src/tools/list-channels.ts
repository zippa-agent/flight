import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { collectEmailThreadListings, type EmailThreadListing } from "../adapters/email/thread-ledger";
import { collectPhoneThreadListings, type PhoneThreadListing } from "../adapters/phone/thread-ledger";
import { collectSlackThreadListings, type SlackThreadListing } from "../adapters/slack/thread-ledger";
import { formatContactList, readContactBook, type ContactBook } from "../listener/contacts";
import { readListenerThreadStates } from "../listener/store";
import type { ListenerThreadState } from "../listener/types";

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
      "List known conversation targets for this Flight agent. Returns recent email-thread:<id>, phone-..., and slack:<channel_id>:<thread_ts> targets from durable ledgers; use these exact targets with read_thread or send_message when choosing a specific conversation.",
    parameters: ListChannelsInput,
    execute: async ({ limit }) => {
      const [emailThreads, phoneThreads, slackThreads, listenerStates, contactBook] = await Promise.all([
        collectEmailThreadListings(input.env, input.agentId, limit),
        collectPhoneThreadListings(input.env, input.agentId, limit),
        collectSlackThreadListings(input.env, input.agentId, limit),
        readListenerThreadStates(input.env, input.agentId),
        readContactBook(input.env, input.agentId),
      ]);
      return formatThreadTables(emailThreads, phoneThreads, slackThreads, listenerStates, contactBook);
    },
  });
}

function formatThreadTables(
  emailThreads: EmailThreadListing[],
  phoneThreads: PhoneThreadListing[],
  slackThreads: SlackThreadListing[],
  listenerStates: Record<string, ListenerThreadState>,
  contactBook: ContactBook,
): string {
  if (emailThreads.length === 0 && phoneThreads.length === 0 && slackThreads.length === 0) return "No known conversation targets.";
  return [
    emailThreads.length ? formatEmailThreadTable(emailThreads, listenerStates, contactBook) : "",
    phoneThreads.length ? formatPhoneThreadTable(phoneThreads, listenerStates, contactBook) : "",
    slackThreads.length ? formatSlackThreadTable(slackThreads, listenerStates, contactBook) : "",
  ].filter(Boolean).join("\n\n");
}

function formatEmailThreadTable(
  threads: EmailThreadListing[],
  listenerStates: Record<string, ListenerThreadState>,
  contactBook: ContactBook,
): string {
  return [
    "Recent email targets:",
    "| Status | Send Target | Subject | Latest Message | Participants | Last Seen | Source |",
    "|--------|-------------|---------|----------------|--------------|-----------|--------|",
    ...threads.map((thread) => [
      statusCell(listenerStates[thread.sendTarget]),
      `\`${thread.sendTarget}\``,
      cell(thread.subject),
      cell(thread.lastPreview),
      `${formatParticipants(contactBook, thread.participants)} (${thread.messageCount})`,
      cell(thread.lastSeen || "-"),
      "email ledger",
    ].join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function formatPhoneThreadTable(
  threads: PhoneThreadListing[],
  listenerStates: Record<string, ListenerThreadState>,
  contactBook: ContactBook,
): string {
  return [
    "Recent phone targets:",
    "| Status | Send Target | Transport | Latest Message | Participants | Last Seen | Source |",
    "|--------|-------------|-----------|----------------|--------------|-----------|--------|",
    ...threads.map((thread) => [
      statusCell(listenerStates[thread.sendTarget]),
      `\`${thread.sendTarget}\``,
      cell(thread.transport),
      cell(thread.lastPreview),
      `${formatParticipants(contactBook, thread.participants)} (${thread.messageCount})`,
      cell(thread.lastSeen || "-"),
      "phone ledger",
    ].join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function formatSlackThreadTable(
  threads: SlackThreadListing[],
  listenerStates: Record<string, ListenerThreadState>,
  contactBook: ContactBook,
): string {
  return [
    "Recent Slack targets:",
    "| Status | Send Target | Channel | Latest Message | Participants | Last Seen | Source |",
    "|--------|-------------|---------|----------------|--------------|-----------|--------|",
    ...threads.map((thread) => [
      statusCell(listenerStates[thread.sendTarget]),
      `\`${thread.sendTarget}\``,
      cell(thread.channelName ? `#${thread.channelName}` : thread.channelId),
      cell(thread.lastPreview),
      `${formatParticipants(contactBook, thread.participants)} (${thread.messageCount})`,
      cell(thread.lastSeen || "-"),
      "slack ledger",
    ].join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function formatParticipants(contactBook: ContactBook, participants: string[]): string {
  return formatContactList(contactBook, participants).map(cell).join(", ") || "-";
}

function cell(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|") || "-";
}

function statusCell(state: ListenerThreadState | undefined): string {
  if (!state) return "-";
  return state.read ? "read" : "unread";
}
