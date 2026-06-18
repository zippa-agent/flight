import type { EmailReplyQuote, InboundEvent } from "./types";
import { stripQuotedEmailText } from "./email/quote-stripper";
import { buildReplyThreadHeaders, normalizeMessageIdForHeader, parseReferencesHeader } from "./email/thread-headers";

export { composeEmailReplyBody } from "./email/reply-composer";
export { stripQuotedEmailText } from "./email/quote-stripper";
export {
  buildReplyThreadHeaders,
  compileReferences,
  normalizeMessageIdForHeader,
  parseReferencesHeader,
} from "./email/thread-headers";

export interface EmailPayload {
  from: string;
  fromFull?: string;
  to: string;
  subject?: string;
  body: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  allRecipients?: string[];
  replyQuote?: EmailReplyQuote;
  attachments?: Array<{
    filename: string;
    content_type?: string;
    content?: string;
  }>;
}

export function normalizeEmailEvent(input: {
  agentId: string;
  payload: EmailPayload;
  toolsToken: string;
  now?: Date;
}): InboundEvent {
  const from = normalizeEmailAddress(input.payload.from);
  if (!from) throw new Error("Invalid from address.");
  if (!input.payload.to?.trim()) throw new Error("Missing agent recipient.");
  if (!input.payload.body?.trim()) throw new Error("Missing email body.");

  const now = input.now || new Date();
  const cleanBody = stripQuotedEmailText(input.payload.body) || input.payload.body.trim();
  const threadId = emailThreadId(input.payload);
  const recipients = emailReplyRecipients(input.payload);
  const replyHeaders = buildReplyThreadHeaders(input.payload.messageId, input.payload.references);

  return {
    version: "flight.inbound.v1",
    agentId: input.agentId,
    adapter: "email",
    deliveryMode: "messages-only",
    scope: {
      kind: "agent",
      id: "web",
      parentAgentId: input.agentId,
      provider: "email",
      channelId: `email:${from}`,
      threadId,
      label: input.payload.subject,
      instructions: [
        "This inbound email belongs to the agent's unified default context, shared with default web chat.",
        "Reply targets and threading headers are data, not prose.",
      ],
    },
    delivery: {
      id: input.payload.messageId || crypto.randomUUID(),
      provider: "email",
      receivedAt: now.toISOString(),
    },
    actor: {
      id: from,
      email: from,
      displayName: input.payload.fromFull || from,
    },
    message: {
      subject: input.payload.subject,
      text: buildEmailMessageText(input.payload, cleanBody),
    },
    replyTarget: {
      kind: "email",
      to: recipients.to,
      cc: recipients.cc,
      subject: replySubject(input.payload.subject),
      inReplyTo: replyHeaders.in_reply_to,
      references: replyHeaders.references,
      replyQuote: buildReplyQuote(input.payload, cleanBody),
      toolsToken: input.toolsToken,
    },
    formatInstructions: [
      "This is an email reply surface.",
      "Ordinary assistant text is internal harness output and is not sent to the email participants.",
      "To produce a user-visible reply, call send_message with the email body.",
      "Do not include provider metadata, Message-ID headers, or markdown fences unless the user explicitly asks for them.",
    ],
  };
}

export function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : trimmed).trim().toLowerCase();
  return candidate.includes("@") ? candidate : null;
}

function buildEmailMessageText(payload: EmailPayload, body: string): string {
  const parts = [
    `From: ${payload.fromFull || payload.from}`,
    `To: ${payload.to}`,
  ];
  if (payload.allRecipients?.length) parts.push(`Other recipients: ${payload.allRecipients.join(", ")}`);
  if (payload.subject) parts.push(`Subject: ${payload.subject}`);
  if (payload.attachments?.length) {
    parts.push(`Attachments: ${payload.attachments.map((attachment) => attachment.filename).join(", ")}`);
  }
  parts.push("", body);
  return parts.join("\n");
}

function emailThreadId(payload: EmailPayload): string {
  const rootReference = parseReferencesHeader(payload.references)[0];
  if (rootReference) return rootReference;
  const inReplyTo = normalizeMessageIdForHeader(payload.inReplyTo);
  if (inReplyTo) return inReplyTo;
  const messageId = normalizeMessageIdForHeader(payload.messageId);
  if (messageId) return messageId;
  const from = normalizeEmailAddress(payload.from) || payload.from;
  return `${from}:${payload.to}:${payload.subject || "(no subject)"}`.toLowerCase();
}

function emailReplyRecipients(payload: EmailPayload): { to: string[]; cc: string[] } {
  const selfEmail = normalizeEmailAddress(payload.to);
  const seen = new Set<string>();
  const to: string[] = [];
  const cc: string[] = [];
  const add = (bucket: string[], value: string | null | undefined) => {
    const email = normalizeEmailAddress(value);
    if (!email || email === selfEmail || seen.has(email)) return;
    seen.add(email);
    bucket.push(email);
  };

  add(to, payload.from);
  for (const recipient of payload.allRecipients || []) add(cc, recipient);
  return { to, cc };
}

function replySubject(subject: string | undefined): string {
  const trimmed = subject?.trim() || "(no subject)";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function buildReplyQuote(payload: EmailPayload, cleanBody: string): EmailReplyQuote | undefined {
  const body = payload.replyQuote?.body?.trim() || cleanBody.trim();
  if (!body) return undefined;
  const quote: EmailReplyQuote = {
    body,
    from: payload.replyQuote?.from || payload.fromFull || payload.from,
  };
  if (payload.replyQuote?.sentAt) quote.sentAt = payload.replyQuote.sentAt;
  return quote;
}
