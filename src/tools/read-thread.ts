import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import {
  parseEmailThreadTarget,
  readEmailThreadById,
  type EmailThreadLedgerRecord,
} from "../adapters/email/thread-ledger";

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
      "Read the transcript for a known conversation target, currently email-thread:<id>. Use this after list_channels when several email threads are active and you need context before choosing a send_message target.",
    parameters: ReadThreadInput,
    execute: async ({ target, limit }) => {
      const parsed = parseEmailThreadTarget(target);
      if (!parsed) throw new Error(`Invalid conversation target "${target}". Expected email-thread:<id>.`);

      const records = await readEmailThreadById(input.env, input.agentId, parsed.threadId, limit);
      if (records.length === 0) return `No transcript found for ${parsed.inputTarget}.`;
      return formatThreadTranscript(parsed.inputTarget, records);
    },
  });
}

function formatThreadTranscript(target: string, records: EmailThreadLedgerRecord[]): string {
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

function sender(record: EmailThreadLedgerRecord): string {
  if (record.type === "outbound") return record.from || "agent";
  return record.from || "unknown sender";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}
