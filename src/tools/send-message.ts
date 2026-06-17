import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { appendAwarenessEntry, assistantAwarenessEntry } from "../awareness/store";

const SendMessageInput = v.object({
  body: v.pipe(v.string(), v.minLength(1), v.maxLength(40_000)),
  subject: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(300))),
});

export function createSendMessageTool(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload;
}): ToolDefinition {
  return defineTool({
    name: "send_message",
    description:
      "Send the user-visible reply for the active messages-only surface. For email, provide only the human-readable email body; Flight supplies the authorized recipients and thread headers.",
    parameters: SendMessageInput,
    execute: async ({ body, subject }, signal) => {
      const target = input.turn.event.replyTarget;
      if (!target) throw new Error("This turn has no reply target.");

      if (target.kind === "email") {
        const result = await sendEmail(input.env, target.toolsToken, {
          to: target.to,
          cc: target.cc?.length ? target.cc : undefined,
          subject: subject || target.subject,
          body,
          in_reply_to: target.inReplyTo,
          references: target.references,
          log: "none",
        }, signal);

        const timestamp = new Date().toISOString();
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
