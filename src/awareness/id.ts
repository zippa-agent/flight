import type { InboundEvent, RelationshipScope } from "../adapters/types";

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

export function flightInstanceId(input: Pick<InboundEvent, "agentId" | "scope">): string {
  return `${input.agentId}--${input.scope.kind}--${base64Url(input.scope.id)}`;
}

export function instanceIdForScope(agentId: string, scope: Pick<RelationshipScope, "kind" | "id">): string {
  return `${agentId}--${scope.kind}--${base64Url(scope.id)}`;
}

export function parentAgentIdFromInstanceId(instanceId: string): string | null {
  return decodeFlightInstanceId(instanceId)?.agentId || null;
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

export function describeInstanceScope(instanceId: string): string {
  const decoded = decodeFlightInstanceId(instanceId);
  if (!decoded) return "Current scope: unknown isolated Flight relationship.";
  return [
    "Current scope:",
    `- TinyFat agent id: ${decoded.agentId}`,
    `- Scope kind: ${decoded.scopeKind}`,
    `- Scope id: ${decoded.scopeId}`,
    "Treat this as the only relationship scope unless trusted input explicitly provides more context.",
  ].join("\n");
}
