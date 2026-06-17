import type { AuthenticatedUser } from "../platform/supabase";
import type { InboundEvent, RelationshipScope } from "./types";
import { isRecord, stringValue } from "./types";

export function normalizeWebEvent(input: {
  agentId: string;
  body: unknown;
  user: AuthenticatedUser;
  now?: Date;
}): InboundEvent {
  const body = isRecord(input.body) ? input.body : {};
  const message = stringValue(body.message) || stringValue(body.text);
  if (!message) throw new Error("Missing message.");

  const now = input.now || new Date();
  const scope = webScope(input.agentId, body);
  const actorName = input.user.email || input.user.id;

  return {
    version: "flight.inbound.v1",
    agentId: input.agentId,
    adapter: "web",
    deliveryMode: "direct",
    scope,
    delivery: {
      id: stringValue(body.deliveryId) || crypto.randomUUID(),
      provider: "web",
      receivedAt: now.toISOString(),
    },
    actor: {
      id: input.user.id,
      email: input.user.email,
      displayName: actorName,
    },
    message: { text: message },
    formatInstructions: [
      "This is direct web chat. User-visible assistant text is delivered directly to the browser.",
      "Use ordinary assistant output for the reply. Do not use a provider delivery tool for web chat.",
    ],
    context: isRecord(body.context) ? body.context : undefined,
  };
}

export function defaultWebScope(agentId: string): RelationshipScope {
  return { kind: "agent", id: "web", parentAgentId: agentId, provider: "web" };
}

export function webScopeFromQuery(agentId: string, url: URL): RelationshipScope {
  const scopeId = url.searchParams.get("scope")?.trim();
  const channelId = url.searchParams.get("channel")?.trim();
  const sessionId = url.searchParams.get("session")?.trim();
  if (scopeId) return { kind: "relationship", id: scopeId, parentAgentId: agentId, provider: "web" };
  if (channelId && channelId !== "web") {
    return { kind: "channel", id: channelId, channelId, parentAgentId: agentId, provider: "web" };
  }
  if (sessionId) return { kind: "relationship", id: sessionId, parentAgentId: agentId, provider: "web" };
  return defaultWebScope(agentId);
}

function webScope(agentId: string, body: Record<string, unknown>): RelationshipScope {
  const scopeId = stringValue(body.scopeId) || stringValue(body.scope);
  const channelId = stringValue(body.channelId);
  const sessionId = stringValue(body.sessionId) || stringValue(body.session_id);
  if (scopeId) return { kind: "relationship", id: scopeId, parentAgentId: agentId, provider: "web" };
  if (channelId && channelId !== "web") {
    return { kind: "channel", id: channelId, channelId, parentAgentId: agentId, provider: "web" };
  }
  if (sessionId) return { kind: "relationship", id: sessionId, parentAgentId: agentId, provider: "web" };
  return defaultWebScope(agentId);
}
