import type { FlightTurnPayload } from "../adapters/types";
import { parseFlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";

const TURN_CONTEXT_PREFIX = "tiny-agents-runtime/turn-contexts";
const TURN_CONTEXT_MARKER = "[[flight-turn-context:";

export async function storeTurnContext(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload;
}): Promise<string> {
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");

  const contextId = crypto.randomUUID();
  await bucket.put(turnContextKey(input.instanceId, contextId), JSON.stringify({
    version: "flight.turn-context.v1",
    createdAt: new Date().toISOString(),
    instanceId: input.instanceId,
    turn: input.turn,
  }));
  await bucket.put(latestTurnContextKey(input.instanceId), JSON.stringify({
    version: "flight.turn-context-latest.v1",
    updatedAt: new Date().toISOString(),
    contextId,
  }));
  return contextId;
}

export async function resolveTurnContext(input: {
  env: Env;
  instanceId: string;
  payload: unknown;
}): Promise<FlightTurnPayload | null> {
  const direct = parseFlightTurnPayload(input.payload);
  if (direct) return direct;

  const contextId = turnContextIdFromPayload(input.payload)
    || await latestTurnContextId(input.env, input.instanceId);
  if (!contextId) return null;
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");

  const object = await bucket.get(turnContextKey(input.instanceId, contextId));
  if (!object) return null;
  const stored = await object.json<{ turn?: unknown }>().catch(() => null);
  return parseFlightTurnPayload(stored?.turn);
}

export function promptWithTurnContext(input: {
  contextId: string;
  prompt: string;
}): string {
  return `${TURN_CONTEXT_MARKER}${input.contextId}]]\n\n${input.prompt}`;
}

function turnContextIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || "";
  if (!firstLine.startsWith(TURN_CONTEXT_MARKER) || !firstLine.endsWith("]]")) return null;
  const id = firstLine.slice(TURN_CONTEXT_MARKER.length, -2).trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function turnContextKey(instanceId: string, contextId: string): string {
  const safeInstanceId = instanceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `${TURN_CONTEXT_PREFIX}/${safeInstanceId}/${contextId}.json`;
}

async function latestTurnContextId(env: Env, instanceId: string): Promise<string | null> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return null;
  const object = await bucket.get(latestTurnContextKey(instanceId));
  if (!object) return null;
  const stored = await object.json<{ contextId?: unknown }>().catch(() => null);
  return typeof stored?.contextId === "string" && /^[0-9a-f-]{36}$/i.test(stored.contextId)
    ? stored.contextId
    : null;
}

function latestTurnContextKey(instanceId: string): string {
  const safeInstanceId = instanceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `${TURN_CONTEXT_PREFIX}/${safeInstanceId}/latest.json`;
}
