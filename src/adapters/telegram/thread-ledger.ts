import type { Env } from "../../env";
import { workspaceRootPrefix } from "../../sandboxes/r2-workspace";

export interface TelegramThreadLedgerEvent {
  type: "inbound" | "outbound";
  at: string;
  chatId: string;
  chatName?: string;
  chatType?: string;
  messageId?: string;
  replyToMessageId?: string;
  userId?: string;
  userName?: string;
  displayName?: string;
  body?: string;
  directlyAddressed?: boolean;
  sourceEventType?: string;
}

export interface TelegramThreadLedgerRecord extends TelegramThreadLedgerEvent {
  threadKey: string;
  threadIdHash: string;
  sendTarget: string;
}

export interface TelegramThreadListing {
  adapter: "telegram";
  threadIdHash: string;
  sendTarget: string;
  chatId: string;
  chatName?: string;
  chatType?: string;
  rootPreview: string;
  lastPreview: string;
  participants: string[];
  messageCount: number;
  lastSeen: string;
  source: "telegram-ledger";
}

export interface TelegramThreadTarget {
  chatId: string;
  replyToMessageId?: string;
  inputTarget: string;
}

const LEDGER_PREFIX = ".flight/telegram-thread-events";
const TELEGRAM_THREAD_TARGET_RE = /^telegram:(-?\d+):(\d+)$/iu;
const TELEGRAM_CHAT_TARGET_RE = /^telegram:(-?\d+)$/iu;
const RAW_TELEGRAM_CHAT_RE = /^-?\d+$/u;

export function parseTelegramThreadTarget(target: string | undefined | null): TelegramThreadTarget | null {
  const trimmed = target?.trim();
  if (!trimmed) return null;

  const threadMatch = trimmed.match(TELEGRAM_THREAD_TARGET_RE);
  if (threadMatch) {
    return {
      chatId: threadMatch[1],
      replyToMessageId: threadMatch[2],
      inputTarget: `telegram:${threadMatch[1]}:${threadMatch[2]}`,
    };
  }

  const chatMatch = trimmed.match(TELEGRAM_CHAT_TARGET_RE);
  if (chatMatch) {
    return {
      chatId: chatMatch[1],
      inputTarget: `telegram:${chatMatch[1]}`,
    };
  }

  if (RAW_TELEGRAM_CHAT_RE.test(trimmed)) {
    return {
      chatId: trimmed,
      inputTarget: `telegram:${trimmed}`,
    };
  }

  return null;
}

export function telegramThreadTarget(chatId: string, replyToMessageId?: string): string {
  const normalizedChatId = chatId.trim();
  return replyToMessageId ? `telegram:${normalizedChatId}:${replyToMessageId}` : `telegram:${normalizedChatId}`;
}

export function telegramThreadKeyForEvent(
  event: Pick<TelegramThreadLedgerEvent, "chatId" | "replyToMessageId">,
): string {
  const chatId = event.chatId.trim();
  const rootId = event.replyToMessageId || "top";
  return `telegram:${chatId}:${rootId}`;
}

export function telegramThreadIdForKey(threadKey: string): string {
  return fnv1a64(threadKey);
}

export function telegramThreadIdForEvent(
  event: Pick<TelegramThreadLedgerEvent, "chatId" | "replyToMessageId">,
): string {
  return telegramThreadIdForKey(telegramThreadKeyForEvent(event));
}

export async function appendTelegramThreadEvent(
  env: Env,
  agentId: string,
  event: TelegramThreadLedgerEvent,
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

export async function readTelegramThreadLedger(env: Env, agentId: string): Promise<TelegramThreadLedgerRecord[]> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return [];

  const prefix = `${workspaceRootPrefix(agentId)}${LEDGER_PREFIX}/`;
  const records: TelegramThreadLedgerRecord[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) {
      const body = await bucket.get(object.key);
      if (!body) continue;
      const parsed = await body.json<unknown>().catch(() => null);
      const event = normalizeLedgerEvent(parsed);
      if (!event) continue;
      const threadKey = telegramThreadKeyForEvent(event);
      const threadIdHash = telegramThreadIdForKey(threadKey);
      records.push({
        ...event,
        threadKey,
        threadIdHash,
        sendTarget: telegramThreadTarget(event.chatId, event.replyToMessageId),
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function readTelegramThreadByTarget(
  env: Env,
  agentId: string,
  target: TelegramThreadTarget,
  limit = 80,
): Promise<TelegramThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  const expectedKey = telegramThreadKeyForEvent({
    chatId: target.chatId,
    replyToMessageId: target.replyToMessageId,
  });
  const expectedId = telegramThreadIdForKey(expectedKey);

  return (await readTelegramThreadLedger(env, agentId))
    .filter((record) => {
      if (record.threadIdHash === expectedId) return true;
      if (record.chatId !== target.chatId) return false;
      if (!target.replyToMessageId) return !record.replyToMessageId;
      return record.replyToMessageId === target.replyToMessageId || record.messageId === target.replyToMessageId;
    })
    .slice(-boundedLimit);
}

export async function collectTelegramThreadListings(
  env: Env,
  agentId: string,
  limit = 20,
): Promise<TelegramThreadListing[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 20, 50));
  const byThread = new Map<string, TelegramThreadListing & { participantSet: Set<string>; firstSeen: string }>();

  for (const event of await readTelegramThreadLedger(env, agentId)) {
    const threadId = event.threadIdHash;
    const existing = byThread.get(threadId);
    const bodyPreview = preview(event.body);
    const participantSet = existing?.participantSet || new Set<string>();
    for (const participant of participantsForEvent(event)) participantSet.add(participant);

    if (!existing) {
      byThread.set(threadId, {
        adapter: "telegram",
        threadIdHash: threadId,
        sendTarget: event.sendTarget,
        chatId: event.chatId,
        chatName: event.chatName,
        chatType: event.chatType,
        rootPreview: bodyPreview,
        lastPreview: bodyPreview,
        participants: [],
        participantSet,
        messageCount: 1,
        firstSeen: event.at || "",
        lastSeen: event.at || "",
        source: "telegram-ledger",
      });
      continue;
    }

    existing.messageCount += 1;
    if (event.chatName) existing.chatName = event.chatName;
    if (event.chatType) existing.chatType = event.chatType;
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

function normalizeLedgerEvent(value: unknown): TelegramThreadLedgerEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<TelegramThreadLedgerEvent>;
  if (raw.type !== "inbound" && raw.type !== "outbound") return null;
  const chatId = stringValue(raw.chatId);
  if (typeof raw.at !== "string" || !raw.at || !chatId) return null;
  return {
    type: raw.type,
    at: raw.at,
    chatId,
    chatName: stringValue(raw.chatName),
    chatType: stringValue(raw.chatType),
    messageId: stringValue(raw.messageId),
    replyToMessageId: stringValue(raw.replyToMessageId),
    userId: stringValue(raw.userId),
    userName: stringValue(raw.userName),
    displayName: stringValue(raw.displayName),
    body: stringValue(raw.body),
    directlyAddressed: raw.directlyAddressed === true,
    sourceEventType: stringValue(raw.sourceEventType),
  };
}

function participantsForEvent(event: TelegramThreadLedgerEvent): string[] {
  return [
    event.displayName,
    event.userName,
    event.userId,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
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
