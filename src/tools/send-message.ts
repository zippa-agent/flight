import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { EmailReplyTarget, FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { buildReplyThreadHeaders, composeEmailReplyBody, normalizeEmailAddress } from "../adapters/email";
import {
  appendEmailThreadEvent,
  buildThreadedReplyQuote,
  parseEmailThreadTarget,
  readEmailThreadById,
} from "../adapters/email/thread-ledger";
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
      "Send the user-visible reply for the active messages-only surface. For email, provide only the human-readable email body; Flight supplies authorized recipients, thread headers, and native-style quoted history. Optional target accepts email-thread:<id> for a known email thread.",
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

  const parsed = parseEmailThreadTarget(input.requestedTarget);
  if (!parsed) {
    throw new Error(`Unsupported send_message target "${input.requestedTarget}". Expected email-thread:<id>.`);
  }

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
