import type { AdapterName, InboundEvent, ScopeKind } from "./types";
import { isRecord, recordValue, stringArray, stringValue } from "./types";

export function normalizeFlightEvent(
  raw: unknown,
  options: { agentId: string; now?: Date; defaultProvider?: string },
): InboundEvent {
  const body = recordValue(raw);
  const now = options.now || new Date();
  const provider =
    stringValue(body.provider) ||
    stringValue(body.surface) ||
    options.defaultProvider ||
    "flight";
  const adapter = coerceAdapter(body.adapter ?? body.surface, provider);
  const agentId = stringValue(body.agentId) || options.agentId;
  if (!agentId) throw new Error("Flight webhook requires an agent id.");

  return {
    version: "flight.inbound.v1",
    agentId,
    adapter,
    deliveryMode: coerceDeliveryMode(body.deliveryMode, adapter),
    scope: inferScope(body, agentId, adapter, provider),
    delivery: inferDelivery(body, provider, now),
    actor: inferActor(body),
    message: inferMessage(body),
    replyTarget: inferReplyTarget(body),
    formatInstructions: inferFormatInstructions(body, adapter),
    context: isRecord(body.context) ? body.context : undefined,
  };
}

function coerceAdapter(value: unknown, fallback: string): AdapterName {
  const candidate = stringValue(value) || fallback;
  switch (candidate) {
    case "web":
    case "embed":
    case "docs":
    case "email":
    case "support":
    case "slack":
    case "telegram":
    case "sms":
    case "voice":
    case "flight":
      return candidate;
    default:
      return "custom";
  }
}

function coerceScopeKind(value: unknown, adapter: AdapterName): ScopeKind {
  const candidate = stringValue(value);
  switch (candidate) {
    case "agent":
    case "relationship":
    case "channel":
    case "thread":
    case "embed-session":
    case "support-ticket":
    case "email-thread":
    case "phone-number":
    case "custom":
      return candidate;
    default:
      if (adapter === "embed" || adapter === "docs") return "embed-session";
      if (adapter === "email") return "email-thread";
      if (adapter === "support") return "support-ticket";
      if (adapter === "sms" || adapter === "voice") return "phone-number";
      if (adapter === "slack" || adapter === "telegram") return "channel";
      return "agent";
  }
}

function coerceDeliveryMode(value: unknown, adapter: AdapterName): "direct" | "messages-only" {
  const candidate = stringValue(value);
  if (candidate === "direct" || candidate === "messages-only") return candidate;
  return adapter === "web" || adapter === "embed" || adapter === "docs" || adapter === "voice"
    ? "direct"
    : "messages-only";
}

function inferMessage(body: Record<string, unknown>): { text: string; subject?: string } {
  const message = recordValue(body.message);
  const text =
    stringValue(message.text) ||
    stringValue(body.text) ||
    stringValue(body.body) ||
    stringValue(body.prompt);
  if (!text) throw new Error("Flight webhook requires message.text, text, body, or prompt.");
  return {
    text,
    subject: stringValue(message.subject) || stringValue(body.subject),
  };
}

function inferActor(body: Record<string, unknown>) {
  const actor = recordValue(body.actor);
  return {
    id:
      stringValue(actor.id) ||
      stringValue(body.actorId) ||
      stringValue(body.userId) ||
      stringValue(actor.email) ||
      stringValue(actor.phone) ||
      "anonymous",
    displayName:
      stringValue(actor.displayName) ||
      stringValue(actor.name) ||
      stringValue(body.userName),
    email: stringValue(actor.email) || stringValue(body.email),
    phone: stringValue(actor.phone) || stringValue(body.phone),
    username: stringValue(actor.username) || stringValue(body.username),
  };
}

function inferDelivery(body: Record<string, unknown>, provider: string, now: Date) {
  const delivery = recordValue(body.delivery);
  return {
    id:
      stringValue(delivery.id) ||
      stringValue(body.deliveryId) ||
      stringValue(body.eventId) ||
      crypto.randomUUID(),
    provider: stringValue(delivery.provider) || provider,
    receivedAt:
      stringValue(delivery.receivedAt) ||
      stringValue(body.receivedAt) ||
      now.toISOString(),
  };
}

function inferScope(body: Record<string, unknown>, agentId: string, adapter: AdapterName, provider: string) {
  const scope = recordValue(body.scope);
  const kind = coerceScopeKind(scope.kind ?? body.scopeKind, adapter);
  const channelId = stringValue(scope.channelId) || stringValue(body.channelId);
  const threadId = stringValue(scope.threadId) || stringValue(body.threadId);
  const id =
    stringValue(scope.id) ||
    stringValue(body.scopeId) ||
    threadId ||
    channelId ||
    stringValue(body.sessionId) ||
    stringValue(body.ticketId) ||
    stringValue(body.threadKey) ||
    agentId;

  return {
    kind,
    id,
    parentAgentId: agentId,
    label: stringValue(scope.label) || stringValue(body.scopeLabel),
    provider: stringValue(scope.provider) || provider,
    channelId,
    threadId,
    instructions: stringArray(scope.instructions ?? body.scopeInstructions),
  };
}

function inferReplyTarget(body: Record<string, unknown>): InboundEvent["replyTarget"] {
  const target = recordValue(body.replyTarget);
  if (target.kind === "webhook") {
    const url = stringValue(target.url);
    if (!url) return undefined;
    return {
      kind: "webhook",
      url,
      token: stringValue(target.token),
    };
  }
  return undefined;
}

function inferFormatInstructions(body: Record<string, unknown>, adapter: AdapterName): string[] {
  const explicit = stringArray(body.formatInstructions);
  if (explicit?.length) return explicit;
  if (adapter === "web" || adapter === "embed" || adapter === "docs") {
    return ["This is a direct browser chat surface. Ordinary assistant text is user-visible."];
  }
  return [
    "This is a messages-only surface. Ordinary assistant text is internal harness output.",
    "Use the provider delivery tool when a user-visible reply is required and that tool is listed as available.",
  ];
}
