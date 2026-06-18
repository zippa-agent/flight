import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { collectEmailThreadListings, type EmailThreadListing } from "../adapters/email/thread-ledger";

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
      "List known conversation targets for this Flight agent. The current Flight implementation returns recent email-thread:<id> targets from the durable email ledger; use these exact targets with read_thread or send_message when choosing a specific email thread.",
    parameters: ListChannelsInput,
    execute: async ({ limit }) => {
      const threads = await collectEmailThreadListings(input.env, input.agentId, limit);
      return formatEmailThreadTable(threads);
    },
  });
}

function formatEmailThreadTable(threads: EmailThreadListing[]): string {
  if (threads.length === 0) return "No known email thread targets.";
  return [
    "Recent email thread targets:",
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

function cell(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|") || "-";
}
