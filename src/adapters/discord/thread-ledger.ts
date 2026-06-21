import type { Env } from "../../env";
import { workspaceRootPrefix } from "../../sandboxes/r2-workspace";

export interface DiscordThreadLedgerEvent {
  type: "inbound" | "outbound";
  at: string;
  channelId: string;
  channelName?: string;
  threadId?: string;
  messageId?: string;
  userId?: string;
  userName?: string;
  displayName?: string;
  body?: string;
  directlyAddressed?: boolean;
  sourceEventType?: string;
}

export interface DiscordThreadLedgerRecord extends DiscordThreadLedgerEvent {
  threadKey: string;
  threadIdHash: string;
  sendTarget: string;
}

export interface DiscordThreadListing {
  adapter: "discord";
  threadIdHash: string;
  sendTarget: string;
  channelId: string;
  channelName?: string;
  rootPreview: string;
  lastPreview: string;
  participants: string[];
  messageCount: number;
  lastSeen: string;
  source: "discord-ledger";
}

export interface DiscordThreadTarget {
  channel: string;
  threadId?: string;
  inputTarget: string;
}

const LEDGER_PREFIX = ".flight/discord-thread-events";
const DISCORD_THREAD_TARGET_RE = /^discord:(\d{17,20}):(\d{17,20})$/iu;
const DISCORD_CHANNEL_TARGET_RE = /^discord:(\d{17,20})$/iu;
const RAW_DISCORD_CHANNEL_RE = /^\d{17,20}$/u;

export function parseDiscordThreadTarget(target: string | undefined | null): DiscordThreadTarget | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;

  const threadMatch = trimmed.match(DISCORD_THREAD_TARGET_RE);
  if (threadMatch) {
    return {
      channel: threadMatch[1],
      threadId: threadMatch[2],
      inputTarget: `discord:${threadMatch[1]}:${threadMatch[2]}`,
    };
  }

  const channelMatch = trimmed.match(DISCORD_CHANNEL_TARGET_RE);
  if (channelMatch) {
    return {
      channel: channelMatch[1],
      inputTarget: `discord:${channelMatch[1]}`,
    };
  }

  if (RAW_DISCORD_CHANNEL_RE.test(trimmed)) {
    return {
      channel: trimmed,
      inputTarget: `discord:${trimmed}`,
    };
  }

  return null;
}

export function discordThreadTarget(channel: string, threadId?: string): string {
  const normalizedChannel = channel.trim();
  return threadId ? `discord:${normalizedChannel}:${threadId}` : `discord:${normalizedChannel}`;
}

export function discordThreadKeyForEvent(
  event: Pick<DiscordThreadLedgerEvent, "channelId" | "threadId" | "messageId">,
): string {
  const channelId = event.channelId.trim();
  const rootId = event.threadId || event.messageId || "top";
  return `discord:${channelId}:${rootId}`;
}

export function discordThreadIdForKey(threadKey: string): string {
  return fnv1a64(threadKey);
}

export function discordThreadIdForEvent(
  event: Pick<DiscordThreadLedgerEvent, "channelId" | "threadId" | "messageId">,
): string {
  return discordThreadIdForKey(discordThreadKeyForEvent(event));
}

export async function appendDiscordThreadEvent(
  env: Env,
  agentId: string,
  event: DiscordThreadLedgerEvent,
): Promise<void> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return;

  const key = [
    workspaceRootPrefix(agentId),
    LEDGER_PREFIX,
    "/",
    safeKeyPart(event.at || new Date().toISOString()),
    "-",
    crypto.randomUUID(),
    ".json",
  ].join("");

  await bucket.put(key, JSON.stringify(event));
}

export async function readDiscordThreadLedger(env: Env, agentId: string): Promise<DiscordThreadLedgerRecord[]> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return [];

  const prefix = `${workspaceRootPrefix(agentId)}${LEDGER_PREFIX}/`;
  const records: DiscordThreadLedgerRecord[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) {
      const body = await bucket.get(object.key);
      if (!body) continue;
      const parsed = await body.json<unknown>().catch(() => null);
      const event = normalizeLedgerEvent(parsed);
      if (!event) continue;
      const threadKey = discordThreadKeyForEvent(event);
      const threadIdHash = discordThreadIdForKey(threadKey);
      records.push({
        ...event,
        threadKey,
        threadIdHash,
        sendTarget: discordThreadTarget(event.channelId, event.threadId || event.messageId),
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function readDiscordThreadByTarget(
  env: Env,
  agentId: string,
  target: DiscordThreadTarget,
  limit = 80,
): Promise<DiscordThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  const expectedKey = discordThreadKeyForEvent({
    channelId: target.channel,
    threadId: target.threadId,
    messageId: target.threadId,
  });
  const expectedId = discordThreadIdForKey(expectedKey);

  return (await readDiscordThreadLedger(env, agentId))
    .filter((record) => {
      if (record.threadIdHash === expectedId) return true;
      if (record.channelId !== target.channel) return false;
      if (!target.threadId) return !record.threadId;
      return record.threadId === target.threadId || record.messageId === target.threadId;
    })
    .slice(-boundedLimit);
}

export async function collectDiscordThreadListings(
  env: Env,
  agentId: string,
  limit = 20,
): Promise<DiscordThreadListing[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 20, 50));
  const byThread = new Map<string, DiscordThreadListing & { participantSet: Set<string>; firstSeen: string }>();

  for (const event of await readDiscordThreadLedger(env, agentId)) {
    const threadId = event.threadIdHash;
    const existing = byThread.get(threadId);
    const bodyPreview = preview(event.body);
    const participantSet = existing?.participantSet || new Set<string>();
    for (const participant of participantsForEvent(event)) participantSet.add(participant);

    if (!existing) {
      byThread.set(threadId, {
        adapter: "discord",
        threadIdHash: threadId,
        sendTarget: event.sendTarget,
        channelId: event.channelId,
        channelName: event.channelName,
        rootPreview: bodyPreview,
        lastPreview: bodyPreview,
        participants: [],
        participantSet,
        messageCount: 1,
        firstSeen: event.at || "",
        lastSeen: event.at || "",
        source: "discord-ledger",
      });
      continue;
    }

    existing.messageCount += 1;
    if (event.channelName) existing.channelName = event.channelName;
    if (bodyPreview && (!existing.rootPreview || (event.at && event.at < existing.firstSeen))) {
      existing.rootPreview = bodyPreview;
      existing.firstSeen = event.at || existing.firstSeen;
    }
    if (!existing.lastSeen || (event.at && event.at > existing.lastSeen)) {
      existing.lastSeen = event.at || existing.lastSeen;
      existing.lastPreview = bodyPreview || existing.lastPreview;
    }
  }

  return Array.from(byThread.values())
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, boundedLimit)
    .map(({ participantSet, firstSeen: _firstSeen, ...thread }) => ({
      ...thread,
      rootPreview: thread.rootPreview || thread.lastPreview || "(no text captured)",
      lastPreview: thread.lastPreview || thread.rootPreview || "(no text captured)",
      participants: Array.from(participantSet).slice(0, 6),
    }));
}

function normalizeLedgerEvent(value: unknown): DiscordThreadLedgerEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<DiscordThreadLedgerEvent>;
  if (raw.type !== "inbound" && raw.type !== "outbound") return null;
  const channelId = stringValue(raw.channelId);
  if (typeof raw.at !== "string" || !raw.at || !channelId) return null;
  return {
    type: raw.type,
    at: raw.at,
    channelId,
    channelName: stringValue(raw.channelName),
    threadId: discordIdValue(raw.threadId),
    messageId: discordIdValue(raw.messageId),
    userId: stringValue(raw.userId),
    userName: stringValue(raw.userName),
    displayName: stringValue(raw.displayName),
    body: stringValue(raw.body),
    directlyAddressed: raw.directlyAddressed === true,
    sourceEventType: stringValue(raw.sourceEventType),
  };
}

function participantsForEvent(event: DiscordThreadLedgerEvent): string[] {
  return [
    event.displayName,
    event.userName,
    event.userId,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function discordIdValue(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{17,20}$/u.test(value.trim()) ? value.trim() : undefined;
}

function safeKeyPart(value: string): string {
  return value.replace(/[^a-z0-9.-]/giu, "-").replace(/-+/gu, "-").slice(0, 80) || "event";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function preview(text: unknown, maxLength = 96): string {
  if (typeof text !== "string") return "";
  const normalized = text.replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
