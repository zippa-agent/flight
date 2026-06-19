import type { Env } from "../../env";
import { workspaceRootPrefix } from "../../sandboxes/r2-workspace";

export interface SlackThreadLedgerEvent {
  type: "inbound" | "outbound";
  at: string;
  channelId: string;
  channelName?: string;
  threadTs?: string;
  messageTs?: string;
  userId?: string;
  userName?: string;
  body?: string;
  directlyAddressed?: boolean;
  sourceEventType?: string;
}

export interface SlackThreadLedgerRecord extends SlackThreadLedgerEvent {
  threadKey: string;
  threadId: string;
  sendTarget: string;
}

export interface SlackThreadListing {
  adapter: "slack";
  threadId: string;
  sendTarget: string;
  channelId: string;
  channelName?: string;
  rootPreview: string;
  lastPreview: string;
  participants: string[];
  messageCount: number;
  lastSeen: string;
  source: "slack-ledger";
}

export interface SlackThreadTarget {
  channel: string;
  threadTs?: string;
  inputTarget: string;
}

const LEDGER_PREFIX = ".flight/slack-thread-events";
const SLACK_THREAD_TARGET_RE = /^slack:([CDG][A-Z0-9]+):(\d+\.\d+)$/iu;
const SLACK_CHANNEL_TARGET_RE = /^slack:([CDG][A-Z0-9]+)$/iu;
const RAW_SLACK_CHANNEL_RE = /^[CDG][A-Z0-9]+$/u;

export function parseSlackThreadTarget(target: string | undefined | null): SlackThreadTarget | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;

  const threadMatch = trimmed.match(SLACK_THREAD_TARGET_RE);
  if (threadMatch) {
    return {
      channel: threadMatch[1].toUpperCase(),
      threadTs: threadMatch[2],
      inputTarget: `slack:${threadMatch[1].toUpperCase()}:${threadMatch[2]}`,
    };
  }

  const channelMatch = trimmed.match(SLACK_CHANNEL_TARGET_RE);
  if (channelMatch) {
    return {
      channel: channelMatch[1].toUpperCase(),
      inputTarget: `slack:${channelMatch[1].toUpperCase()}`,
    };
  }

  if (RAW_SLACK_CHANNEL_RE.test(trimmed)) {
    return {
      channel: trimmed.toUpperCase(),
      inputTarget: `slack:${trimmed.toUpperCase()}`,
    };
  }

  return null;
}

export function slackThreadTarget(channel: string, threadTs?: string): string {
  const normalizedChannel = channel.trim().toUpperCase();
  return threadTs ? `slack:${normalizedChannel}:${threadTs}` : `slack:${normalizedChannel}`;
}

export function slackThreadKeyForEvent(
  event: Pick<SlackThreadLedgerEvent, "channelId" | "threadTs" | "messageTs">,
): string {
  const channelId = event.channelId.trim().toUpperCase();
  const rootTs = event.threadTs || event.messageTs || "top";
  return `slack:${channelId}:${rootTs}`;
}

export function slackThreadIdForKey(threadKey: string): string {
  return fnv1a64(threadKey);
}

export function slackThreadIdForEvent(
  event: Pick<SlackThreadLedgerEvent, "channelId" | "threadTs" | "messageTs">,
): string {
  return slackThreadIdForKey(slackThreadKeyForEvent(event));
}

export async function appendSlackThreadEvent(
  env: Env,
  agentId: string,
  event: SlackThreadLedgerEvent,
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

export async function readSlackThreadLedger(env: Env, agentId: string): Promise<SlackThreadLedgerRecord[]> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return [];

  const prefix = `${workspaceRootPrefix(agentId)}${LEDGER_PREFIX}/`;
  const records: SlackThreadLedgerRecord[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) {
      const body = await bucket.get(object.key);
      if (!body) continue;
      const parsed = await body.json<unknown>().catch(() => null);
      const event = normalizeLedgerEvent(parsed);
      if (!event) continue;
      const threadKey = slackThreadKeyForEvent(event);
      const threadId = slackThreadIdForKey(threadKey);
      records.push({
        ...event,
        threadKey,
        threadId,
        sendTarget: slackThreadTarget(event.channelId, event.threadTs || event.messageTs),
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function readSlackThreadByTarget(
  env: Env,
  agentId: string,
  target: SlackThreadTarget,
  limit = 80,
): Promise<SlackThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  const expectedKey = slackThreadKeyForEvent({
    channelId: target.channel,
    threadTs: target.threadTs,
    messageTs: target.threadTs,
  });
  const expectedId = slackThreadIdForKey(expectedKey);

  return (await readSlackThreadLedger(env, agentId))
    .filter((record) => {
      if (record.threadId === expectedId) return true;
      if (record.channelId.toUpperCase() !== target.channel.toUpperCase()) return false;
      if (!target.threadTs) return !record.threadTs;
      return record.threadTs === target.threadTs || record.messageTs === target.threadTs;
    })
    .slice(-boundedLimit);
}

export async function collectSlackThreadListings(
  env: Env,
  agentId: string,
  limit = 20,
): Promise<SlackThreadListing[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 20, 50));
  const byThread = new Map<string, SlackThreadListing & { participantSet: Set<string>; firstSeen: string }>();

  for (const event of await readSlackThreadLedger(env, agentId)) {
    const threadId = event.threadId;
    const existing = byThread.get(threadId);
    const bodyPreview = preview(event.body);
    const participantSet = existing?.participantSet || new Set<string>();
    for (const participant of participantsForEvent(event)) participantSet.add(participant);

    if (!existing) {
      byThread.set(threadId, {
        adapter: "slack",
        threadId,
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
        source: "slack-ledger",
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

function normalizeLedgerEvent(value: unknown): SlackThreadLedgerEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<SlackThreadLedgerEvent>;
  if (raw.type !== "inbound" && raw.type !== "outbound") return null;
  const channelId = stringValue(raw.channelId)?.toUpperCase();
  if (typeof raw.at !== "string" || !raw.at || !channelId) return null;
  return {
    type: raw.type,
    at: raw.at,
    channelId,
    channelName: stringValue(raw.channelName),
    threadTs: slackTsValue(raw.threadTs),
    messageTs: slackTsValue(raw.messageTs),
    userId: stringValue(raw.userId),
    userName: stringValue(raw.userName),
    body: stringValue(raw.body),
    directlyAddressed: raw.directlyAddressed === true,
    sourceEventType: stringValue(raw.sourceEventType),
  };
}

function participantsForEvent(event: SlackThreadLedgerEvent): string[] {
  return [
    event.userName,
    event.userId,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function slackTsValue(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+\.\d+$/u.test(value.trim()) ? value.trim() : undefined;
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
