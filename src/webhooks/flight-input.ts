export const FLIGHT_INPUT_VERSION = "flight.v1" as const;

export type FlightSurface =
  | "web"
  | "embed"
  | "docs"
  | "email"
  | "support"
  | "slack"
  | "telegram"
  | "sms"
  | "voice"
  | "custom";

export type FlightScopeKind =
  | "agent"
  | "relationship"
  | "channel"
  | "thread"
  | "embed-session"
  | "support-ticket"
  | "email-thread"
  | "phone-number"
  | "custom";

export interface FlightActor {
  id: string;
  displayName?: string;
  email?: string;
  phone?: string;
  username?: string;
}

export interface FlightScope {
  kind: FlightScopeKind;
  id: string;
  parentAgentId: string;
  label?: string;
  provider?: string;
  channelId?: string;
  threadId?: string;
  instructions?: string[];
}

export interface FlightDelivery {
  id: string;
  provider: string;
  receivedAt: string;
}

export interface FlightMessage {
  text: string;
  subject?: string;
}

export interface FlightWebhookInput {
  version: typeof FLIGHT_INPUT_VERSION;
  agentId: string;
  surface: FlightSurface;
  scope: FlightScope;
  delivery: FlightDelivery;
  actor: FlightActor;
  message: FlightMessage;
  context?: Record<string, unknown>;
}

export interface NormalizeFlightWebhookOptions {
  agentId: string;
  now?: Date;
  defaultProvider?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map(stringValue).filter((item): item is string => !!item);
  return strings.length ? strings : undefined;
}

function coerceSurface(value: unknown, fallback: string): FlightSurface {
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
      return candidate;
    default:
      return "custom";
  }
}

function coerceScopeKind(value: unknown, surface: FlightSurface): FlightScopeKind {
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
      return candidate;
    case "custom":
      return "custom";
    default:
      if (surface === "embed" || surface === "docs") return "embed-session";
      if (surface === "email") return "email-thread";
      if (surface === "support") return "support-ticket";
      if (surface === "sms" || surface === "voice") return "phone-number";
      if (surface === "slack" || surface === "telegram") return "channel";
      return "agent";
  }
}

function inferMessage(body: Record<string, unknown>): FlightMessage {
  const message = recordValue(body.message);
  const text =
    stringValue(message.text) ||
    stringValue(body.text) ||
    stringValue(body.body) ||
    stringValue(body.prompt);
  if (!text) {
    throw new Error("Flight webhook requires message.text, text, body, or prompt");
  }
  return {
    text,
    subject: stringValue(message.subject) || stringValue(body.subject),
  };
}

function inferActor(body: Record<string, unknown>): FlightActor {
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

function inferDelivery(
  body: Record<string, unknown>,
  provider: string,
  now: Date,
): FlightDelivery {
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

function inferScope(
  body: Record<string, unknown>,
  agentId: string,
  surface: FlightSurface,
  provider: string,
): FlightScope {
  const scope = recordValue(body.scope);
  const kind = coerceScopeKind(scope.kind ?? body.scopeKind, surface);
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

export function normalizeFlightWebhook(
  raw: unknown,
  options: NormalizeFlightWebhookOptions,
): FlightWebhookInput {
  const body = recordValue(raw);
  const now = options.now || new Date();
  const provider =
    stringValue(body.provider) ||
    stringValue(body.surface) ||
    options.defaultProvider ||
    "flight";
  const surface = coerceSurface(body.surface, provider);
  const agentId = stringValue(body.agentId) || options.agentId;

  if (!agentId) throw new Error("Flight webhook requires an agent id");

  return {
    version: FLIGHT_INPUT_VERSION,
    agentId,
    surface,
    scope: inferScope(body, agentId, surface, provider),
    delivery: inferDelivery(body, provider, now),
    actor: inferActor(body),
    message: inferMessage(body),
    context: isRecord(body.context) ? body.context : undefined,
  };
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function flightInstanceId(input: Pick<FlightWebhookInput, "agentId" | "scope">): string {
  return `${input.agentId}--${input.scope.kind}--${base64Url(input.scope.id)}`;
}

export function parentAgentIdFromInstanceId(instanceId: string): string | null {
  const [agentId, kind, encoded] = instanceId.split("--");
  if (!agentId || !kind || !encoded) return null;
  try {
    fromBase64Url(encoded);
    return agentId;
  } catch {
    return null;
  }
}

export function decodeFlightInstanceId(instanceId: string): {
  agentId: string;
  scopeKind: string;
  scopeId: string;
} | null {
  const [agentId, scopeKind, encoded] = instanceId.split("--");
  if (!agentId || !scopeKind || !encoded) return null;
  try {
    return { agentId, scopeKind, scopeId: fromBase64Url(encoded) };
  } catch {
    return null;
  }
}

export function describeFlightInstanceId(instanceId: string): string {
  const decoded = decodeFlightInstanceId(instanceId);
  if (!decoded) {
    return "Current Flight scope: unknown. Treat this as an isolated relationship scope.";
  }
  return [
    "Current Flight scope:",
    `- TinyFat agent id: ${decoded.agentId}`,
    `- Scope kind: ${decoded.scopeKind}`,
    `- Scope id: ${decoded.scopeId}`,
    "Only use information that belongs in this scope unless trusted tool output or the user explicitly provides more context.",
  ].join("\n");
}

export function renderFlightPrompt(input: FlightWebhookInput): string {
  const actor = [
    input.actor.displayName || input.actor.username || input.actor.id,
    input.actor.email ? `<${input.actor.email}>` : "",
    input.actor.phone ? `<${input.actor.phone}>` : "",
  ].filter(Boolean).join(" ");

  const lines = [
    "[Flight scoped inbound event]",
    `Surface: ${input.surface}`,
    `Provider: ${input.delivery.provider}`,
    `TinyFat agent: ${input.agentId}`,
    `Scope: ${input.scope.kind}:${input.scope.id}`,
    input.scope.label ? `Scope label: ${input.scope.label}` : "",
    input.scope.channelId ? `Channel: ${input.scope.channelId}` : "",
    input.scope.threadId ? `Thread: ${input.scope.threadId}` : "",
    `Actor: ${actor}`,
    input.message.subject ? `Subject: ${input.message.subject}` : "",
    "",
    input.message.text,
  ].filter((line) => line !== "");

  if (input.scope.instructions?.length) {
    lines.splice(6, 0, "Scope instructions:", ...input.scope.instructions.map((line) => `- ${line}`));
  }

  return lines.join("\n");
}
