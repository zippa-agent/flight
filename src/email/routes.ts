import type { Context } from "hono";
import type { Env } from "../env";
import { promptAgentForResult } from "../console/stream";
import { fetchAgentRuntimeRecord } from "../platform/supabase";
import { jsonError, requireBearer } from "../shared/http";
import { flightInstanceId, normalizeFlightWebhook, renderFlightPrompt } from "../webhooks/flight-input";

type AppContext = Context<{ Bindings: Env }>;

interface EmailPayload {
  from: string;
  fromFull?: string;
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  allRecipients?: string[];
  attachments?: Array<{
    filename: string;
    content_type: string;
    content: string;
  }>;
}

export async function handleEmailWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);

  let payload: EmailPayload;
  try {
    payload = await c.req.json() as EmailPayload;
  } catch {
    return jsonError("Expected JSON body", 400);
  }

  const record = await fetchAgentRuntimeRecord(agentId, c.env);
  if (!record || record.runtime !== "flight" || record.enabled === false) {
    return jsonError("Flight agent not found", 404);
  }
  if (!record.tools_token) {
    return jsonError("Agent tools token is not configured", 500);
  }

  const from = normalizeEmailAddress(payload.from);
  if (!from) return jsonError("Invalid from address", 400);
  if (!payload.to?.trim()) return jsonError("Missing agent recipient", 400);
  if (!payload.body?.trim()) return jsonError("Missing email body", 400);

  const threadId = emailThreadId(payload);
  const messageText = buildEmailMessageText(payload);
  const input = normalizeFlightWebhook({
    surface: "email",
    provider: "resend",
    scope: {
      kind: "email-thread",
      id: threadId,
      label: payload.subject,
      channelId: `email:${from}`,
      threadId,
      instructions: [
        "This is an email reply surface.",
        "Answer with the exact body text that should be sent back to the email participants.",
        "Do not include provider metadata, Message-ID headers, or markdown fences unless the user asked for them.",
      ],
    },
    actor: {
      id: from,
      email: from,
      displayName: payload.fromFull || from,
    },
    message: {
      subject: payload.subject,
      text: messageText,
    },
    delivery: {
      id: payload.messageId || crypto.randomUUID(),
      provider: "resend",
      receivedAt: new Date().toISOString(),
    },
  }, { agentId });

  const finalText = await promptAgentForResult(c, {
    agentId,
    instanceId: flightInstanceId(input),
    message: renderFlightPrompt(input),
  });
  if (!finalText) return jsonError("Flight produced no email reply", 502);

  const reply = buildEmailReplyRequest(payload, finalText);
  const sendResult = await sendEmail(c.env, record.tools_token, reply);
  return c.json({
    ok: true,
    runtime: "flight",
    agentId,
    instanceId: flightInstanceId(input),
    messageId: sendResult.messageId || null,
  });
}

function buildEmailMessageText(payload: EmailPayload): string {
  const parts = [
    `From: ${payload.fromFull || payload.from}`,
    `To: ${payload.to}`,
  ];
  if (payload.allRecipients?.length) parts.push(`Other recipients: ${payload.allRecipients.join(", ")}`);
  if (payload.subject) parts.push(`Subject: ${payload.subject}`);
  if (payload.messageId) parts.push(`Message-ID: ${payload.messageId}`);
  if (payload.inReplyTo) parts.push(`In-Reply-To: ${payload.inReplyTo}`);
  if (payload.references) parts.push(`References: ${payload.references}`);
  if (payload.attachments?.length) {
    parts.push(`Attachments: ${payload.attachments.map((attachment) => attachment.filename).join(", ")}`);
  }
  parts.push("", payload.body);
  return parts.join("\n");
}

function emailThreadId(payload: EmailPayload): string {
  if (payload.inReplyTo?.trim()) return payload.inReplyTo.trim();
  if (payload.references?.trim()) {
    const references = payload.references.trim().split(/\s+/);
    if (references[0]) return references[0];
  }
  if (payload.messageId?.trim()) return payload.messageId.trim();
  const from = normalizeEmailAddress(payload.from) || payload.from;
  return `${from}:${payload.to}:${payload.subject || "(no subject)"}`.toLowerCase();
}

function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : trimmed).trim().toLowerCase();
  return candidate.includes("@") ? candidate : null;
}

function buildEmailReplyRequest(payload: EmailPayload, body: string): {
  to: string[];
  subject: string;
  body: string;
  in_reply_to?: string;
  references?: string;
} {
  const selfEmail = normalizeEmailAddress(payload.to);
  const seen = new Set<string>();
  const to: string[] = [];
  const add = (value: string | null | undefined) => {
    const email = normalizeEmailAddress(value);
    if (!email || email === selfEmail || seen.has(email)) return;
    seen.add(email);
    to.push(email);
  };

  add(payload.from);
  for (const recipient of payload.allRecipients || []) add(recipient);

  const references = buildReferences(payload);
  return {
    to,
    subject: replySubject(payload.subject),
    body,
    ...(payload.messageId ? { in_reply_to: payload.messageId } : {}),
    ...(references ? { references } : {}),
  };
}

function replySubject(subject: string | undefined): string {
  const trimmed = subject?.trim() || "(no subject)";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function buildReferences(payload: EmailPayload): string {
  return [payload.references, payload.messageId]
    .flatMap((part) => part?.trim().split(/\s+/) || [])
    .filter(Boolean)
    .join(" ");
}

async function sendEmail(
  env: Env,
  toolsToken: string,
  body: Record<string, unknown>,
): Promise<{ messageId?: string }> {
  const url = env.TINYFAT_EMAIL_SEND_URL?.trim() || "https://tinyfat.com/api/email/send";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${toolsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, log: "none" }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Email send failed (${response.status}): ${text}`);
  }
  const parsed = text ? JSON.parse(text) as { messageId?: string; id?: string } : {};
  return { messageId: parsed.messageId || parsed.id };
}
