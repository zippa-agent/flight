import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";
import type { ListenerAdapter, ListenerThreadState } from "./types";

const STATE_KEY = ".flight/listener-thread-state.json";

export async function readListenerThreadStates(
  env: Pick<Env, "FLIGHT_WORKSPACE">,
  agentId: string,
): Promise<Record<string, ListenerThreadState>> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return {};
  const object = await bucket.get(stateKey(agentId));
  if (!object) return {};
  const parsed = await object.json<unknown>().catch(() => null);
  return normalizeStateIndex(parsed);
}

export async function noteListenerInboundThread(input: {
  env: Pick<Env, "FLIGHT_WORKSPACE">;
  agentId: string;
  target: string;
  adapter: ListenerAdapter;
  at: string;
  eventId?: string;
  label?: string;
  lastPreview?: string;
  participants?: string[];
}): Promise<ListenerThreadState | null> {
  const now = new Date().toISOString();
  return updateListenerThreadState(input.env, input.agentId, input.target, {
    adapter: input.adapter,
    read: false,
    lastEventId: input.eventId,
    lastInboundAt: input.at,
    label: input.label,
    lastPreview: input.lastPreview,
    participants: input.participants,
    readAt: undefined,
    readBy: undefined,
    updatedAt: now,
  });
}

export async function setListenerThreadReadState(
  env: Pick<Env, "FLIGHT_WORKSPACE">,
  agentId: string,
  target: string,
  read: boolean,
  options: {
    adapter?: ListenerAdapter;
    readBy?: ListenerThreadState["readBy"];
  } = {},
): Promise<ListenerThreadState | null> {
  const now = new Date().toISOString();
  return updateListenerThreadState(env, agentId, target, {
    adapter: options.adapter,
    read,
    readAt: read ? now : undefined,
    readBy: read ? options.readBy || "agent" : undefined,
    updatedAt: now,
  });
}

async function updateListenerThreadState(
  env: Pick<Env, "FLIGHT_WORKSPACE">,
  agentId: string,
  target: string,
  patch: Partial<ListenerThreadState> & { adapter?: ListenerAdapter; updatedAt: string },
): Promise<ListenerThreadState | null> {
  const bucket = env.FLIGHT_WORKSPACE;
  const normalizedTarget = target.trim();
  if (!bucket || !normalizedTarget) return null;

  const states = await readListenerThreadStates(env, agentId);
  const existing = states[normalizedTarget];
  const adapter = patch.adapter || existing?.adapter || inferAdapter(normalizedTarget);
  const next: ListenerThreadState = pruneUndefined({
    target: normalizedTarget,
    adapter,
    read: patch.read ?? existing?.read ?? true,
    lastEventId: patch.lastEventId ?? existing?.lastEventId,
    lastInboundAt: patch.lastInboundAt ?? existing?.lastInboundAt,
    readAt: patch.read === false ? undefined : patch.readAt ?? existing?.readAt,
    readBy: patch.read === false ? undefined : patch.readBy ?? existing?.readBy,
    label: patch.label ?? existing?.label,
    lastPreview: patch.lastPreview ?? existing?.lastPreview,
    participants: patch.participants ?? existing?.participants,
    updatedAt: patch.updatedAt,
  });
  states[normalizedTarget] = next;
  await bucket.put(stateKey(agentId), JSON.stringify(states, null, 2));
  return next;
}

function stateKey(agentId: string): string {
  return `${workspaceRootPrefix(agentId)}${STATE_KEY}`;
}

function normalizeStateIndex(value: unknown): Record<string, ListenerThreadState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, ListenerThreadState> = {};
  for (const [target, raw] of Object.entries(value as Record<string, unknown>)) {
    const state = normalizeThreadState(raw, target);
    if (state) result[state.target] = state;
  }
  return result;
}

function normalizeThreadState(value: unknown, fallbackTarget: string): ListenerThreadState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<ListenerThreadState>;
  const target = stringValue(raw.target) || fallbackTarget.trim();
  if (!target) return null;
  const adapter = normalizeAdapter(raw.adapter) || inferAdapter(target);
  return pruneUndefined({
    target,
    adapter,
    read: raw.read !== false,
    lastEventId: stringValue(raw.lastEventId),
    lastInboundAt: stringValue(raw.lastInboundAt),
    readAt: stringValue(raw.readAt),
    readBy: raw.readBy === "agent" || raw.readBy === "admin" || raw.readBy === "system" ? raw.readBy : undefined,
    label: stringValue(raw.label),
    lastPreview: stringValue(raw.lastPreview),
    participants: Array.isArray(raw.participants)
      ? raw.participants.map(stringValue).filter((item): item is string => !!item)
      : undefined,
    updatedAt: stringValue(raw.updatedAt) || new Date(0).toISOString(),
  });
}

function inferAdapter(target: string): ListenerAdapter {
  if (target.startsWith("email-thread:")) return "email";
  if (target.startsWith("slack:")) return "slack";
  if (target.startsWith("discord:")) return "discord";
  if (target.startsWith("telegram:")) return "telegram";
  return "phone";
}

function normalizeAdapter(value: unknown): ListenerAdapter | undefined {
  return value === "email" || value === "phone" || value === "slack" || value === "discord" || value === "telegram"
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}
