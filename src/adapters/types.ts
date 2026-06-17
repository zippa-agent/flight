export type DeliveryMode = "direct" | "messages-only";

export type AdapterName =
  | "web"
  | "email"
  | "flight"
  | "embed"
  | "docs"
  | "support"
  | "slack"
  | "telegram"
  | "sms"
  | "voice"
  | "custom";

export type ScopeKind =
  | "agent"
  | "relationship"
  | "channel"
  | "thread"
  | "embed-session"
  | "support-ticket"
  | "email-thread"
  | "phone-number"
  | "custom";

export interface RelationshipScope {
  kind: ScopeKind;
  id: string;
  parentAgentId: string;
  label?: string;
  provider?: string;
  channelId?: string;
  threadId?: string;
  instructions?: string[];
}

export interface InboundActor {
  id: string;
  displayName?: string;
  email?: string;
  phone?: string;
  username?: string;
}

export interface InboundMessage {
  text: string;
  subject?: string;
}

export interface InboundDelivery {
  id: string;
  provider: string;
  receivedAt: string;
}

export interface EmailReplyTarget {
  kind: "email";
  to: string[];
  cc?: string[];
  subject: string;
  inReplyTo?: string;
  references?: string;
  toolsToken: string;
}

export interface WebhookReplyTarget {
  kind: "webhook";
  url: string;
  token?: string;
}

export type ReplyTarget = EmailReplyTarget | WebhookReplyTarget;

export interface InboundEvent {
  version: "flight.inbound.v1";
  agentId: string;
  adapter: AdapterName;
  deliveryMode: DeliveryMode;
  scope: RelationshipScope;
  delivery: InboundDelivery;
  actor: InboundActor;
  message: InboundMessage;
  replyTarget?: ReplyTarget;
  formatInstructions: string[];
  context?: Record<string, unknown>;
}

export interface FlightTurnPayload {
  version: "flight.turn.v1";
  event: InboundEvent;
  awarenessTail: unknown[];
  prompt: string;
  toolPolicy: {
    allowSendMessage: boolean;
    allowFullBash: boolean;
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map(stringValue).filter((item): item is string => !!item);
  return strings.length ? strings : undefined;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function parseFlightTurnPayload(value: unknown): FlightTurnPayload | null {
  if (!isRecord(value)) return null;
  const direct = value.version === "flight.turn.v1" ? value : null;
  const dispatchInput = isRecord(value.input) && value.input.version === "flight.turn.v1"
    ? value.input
    : null;
  const candidate = direct || dispatchInput;
  if (!isRecord(candidate) || !isRecord(candidate.event)) return null;
  if (candidate.version !== "flight.turn.v1") return null;
  return candidate as unknown as FlightTurnPayload;
}
