import type { InboundEvent } from "./types";

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
  const threadId = emailThreadId(input.payload);
  const recipients = emailReplyRecipients(input.payload);

  return {
    version: "flight.inbound.v1",
    agentId: input.agentId,
    adapter: "email",
    deliveryMode: "messages-only",
    scope: {
      kind: "email-thread",
      id: threadId,
      parentAgentId: input.agentId,
      provider: "email",
      channelId: `email:${from}`,
      threadId,
      label: input.payload.subject,
      instructions: [
        "This scope is an email thread. Reply targets and threading headers are data, not prose.",
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
      text: buildEmailMessageText(input.payload),
    },
    replyTarget: {
      kind: "email",
      to: recipients.to,
      cc: recipients.cc,
      subject: replySubject(input.payload.subject),
      inReplyTo: input.payload.messageId,
      references: buildReferences(input.payload),
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

function buildReferences(payload: EmailPayload): string {
  return [payload.references, payload.messageId]
    .flatMap((part) => part?.trim().split(/\s+/) || [])
    .filter(Boolean)
    .join(" ");
}
