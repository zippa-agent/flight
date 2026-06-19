import type { InboundEvent } from "./types";
import {
  phoneThreadTargetForEvent,
  type PhoneAttachmentLedgerRecord,
  type PhoneThreadLedgerEvent,
  type PhoneTransport,
} from "./phone/thread-ledger";

export type PhoneProviderName = "loop" | "twilio" | "phone";

export interface PhoneInboundPayload {
  provider: PhoneProviderName;
  transport?: PhoneTransport;
  direction?: "inbound" | "outbound";
  status?: "received" | "sent" | "queued" | "failed" | "rejected" | "delivered" | "read";
  messageId: string;
  conversationId?: string;
  from: string;
  to?: string;
  sender?: string;
  recipients?: string[];
  text: string;
  attachments?: PhoneAttachmentLedgerRecord[];
  timestamp?: string;
  replyToId?: string;
  providerData?: Record<string, unknown>;
}

export function normalizePhoneEvent(input: {
  agentId: string;
  payload: PhoneInboundPayload;
  now?: Date;
}): InboundEvent {
  const payload = normalizePhonePayload(input.payload, input.now || new Date());
  const ledgerEvent = phoneLedgerEventFromPayload(payload);
  const threadTarget = phoneThreadTargetForEvent(ledgerEvent);
  const receivedAt = ledgerEvent.at;
  const displayName = phoneDisplayName(payload);

  return {
    version: "flight.inbound.v1",
    agentId: input.agentId,
    adapter: "phone",
    deliveryMode: "messages-only",
    scope: {
      kind: "phone-number",
      id: threadTarget,
      parentAgentId: input.agentId,
      provider: payload.provider,
      channelId: threadTarget,
      threadId: payload.conversationId || threadTarget,
      label: displayName,
      instructions: [
        "This inbound phone message is a listener thread.",
        "Do not send or imply a reply into the phone thread unless a future explicit phone delivery tool is available.",
        `Current phone thread target: ${threadTarget}.`,
      ],
    },
    delivery: {
      id: payload.messageId,
      provider: payload.provider,
      receivedAt,
    },
    actor: {
      id: payload.from,
      phone: payload.from,
      displayName,
    },
    message: {
      text: buildPhoneMessageText(payload),
    },
    formatInstructions: [
      "This is a listener-only phone/SMS/MMS surface.",
      "Ordinary assistant text is internal harness output and is not sent to phone participants.",
      `The current phone thread target is ${threadTarget}; use it exactly with read_thread when needed.`,
      "Do not message this phone thread. Admin summaries or CRM updates must use separate configured tools or surfaces.",
    ],
    context: {
      phoneThreadTarget: threadTarget,
      phoneConversationId: payload.conversationId,
      phoneTransport: payload.transport || "unknown",
      phoneProvider: payload.provider,
      phoneSender: payload.sender || payload.to,
    },
  };
}

export function phoneLedgerEventFromPayload(payload: PhoneInboundPayload): PhoneThreadLedgerEvent {
  const normalized = normalizePhonePayload(payload);
  return {
    type: normalized.direction === "outbound" ? "outbound" : "inbound",
    at: normalized.timestamp || new Date().toISOString(),
    provider: normalized.provider || "phone",
    transport: normalized.transport || "unknown",
    messageId: normalized.messageId,
    conversationId: normalized.conversationId,
    from: normalized.from,
    to: normalized.to,
    sender: normalized.sender || normalized.to,
    recipients: normalized.recipients,
    body: normalized.text,
    attachments: normalized.attachments,
  };
}

export function normalizePhonePayload(payload: PhoneInboundPayload, now = new Date()): PhoneInboundPayload {
  const provider = normalizeProvider(payload.provider);
  const from = normalizeAddress(payload.from);
  const to = normalizeAddress(payload.to);
  const sender = normalizeAddress(payload.sender || to);
  const messageId = stringValue(payload.messageId) || crypto.randomUUID();
  if (!from) throw new Error("Phone payload requires from.");
  if (!sender && !to) throw new Error("Phone payload requires sender or to.");

  return {
    provider,
    transport: normalizeTransport(payload.transport),
    direction: payload.direction === "outbound" ? "outbound" : "inbound",
    status: payload.status,
    messageId,
    conversationId: stringValue(payload.conversationId) || `${sender || to}:${from}`,
    from,
    to: to || sender || undefined,
    sender: sender || to || undefined,
    recipients: Array.isArray(payload.recipients)
      ? payload.recipients.map(normalizeAddress).filter(Boolean)
      : undefined,
    text: typeof payload.text === "string" ? payload.text : "",
    attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
    timestamp: stringValue(payload.timestamp) || now.toISOString(),
    replyToId: stringValue(payload.replyToId),
    providerData: payload.providerData,
  };
}

function buildPhoneMessageText(payload: PhoneInboundPayload): string {
  const parts = [
    `From: ${payload.from}`,
    `To: ${payload.to || payload.sender || "(unknown)"}`,
    `Transport: ${payload.transport || "unknown"}`,
  ];
  if (payload.recipients?.length) parts.push(`Participants: ${payload.recipients.join(", ")}`);
  if (payload.attachments?.length) {
    parts.push("Attachments:");
    for (const attachment of payload.attachments) {
      const details = [
        attachment.content_type,
        typeof attachment.size === "number" ? `${attachment.size} bytes` : undefined,
      ].filter(Boolean).join(", ");
      parts.push([
        `- ${attachment.filename || attachment.url || "attachment"}`,
        details ? `(${details})` : "",
        attachment.workspace_path ? `-> ${attachment.workspace_path}` : "",
      ].filter(Boolean).join(" "));
    }
  }
  parts.push("", payload.text?.trim() || "(no text captured)");
  return parts.join("\n");
}

function phoneDisplayName(payload: PhoneInboundPayload): string {
  const others = payload.recipients?.filter((recipient) => recipient !== payload.sender && recipient !== payload.to && recipient !== payload.from);
  if (others?.length) return [payload.from, ...others].join(", ");
  return payload.from;
}

function normalizeProvider(value: unknown): PhoneProviderName {
  if (value === "loop" || value === "twilio") return value;
  return "phone";
}

function normalizeTransport(value: unknown): PhoneTransport {
  if (value === "imessage" || value === "sms" || value === "mms" || value === "rcs" || value === "whatsapp") return value;
  return "unknown";
}

function normalizeAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const cleaned = trimmed.replace(/[^\d+]/gu, "");
  return cleaned || trimmed.toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
