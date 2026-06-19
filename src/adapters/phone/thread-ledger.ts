import type { Env } from "../../env";
import { workspaceRootPrefix } from "../../sandboxes/r2-workspace";

export type PhoneTransport = "imessage" | "sms" | "mms" | "rcs" | "whatsapp" | "unknown";

export interface PhoneAttachmentLedgerRecord {
  filename?: string;
  content_type?: string;
  url?: string;
  workspace_path?: string;
  size?: number;
}

export interface PhoneThreadLedgerEvent {
  type: "inbound" | "outbound";
  at: string;
  provider: string;
  transport?: PhoneTransport;
  messageId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  sender?: string;
  recipients?: string[];
  body?: string;
  attachments?: PhoneAttachmentLedgerRecord[];
}

export interface PhoneThreadLedgerRecord extends PhoneThreadLedgerEvent {
  threadKey: string;
  threadId: string;
  sendTarget: string;
  displayName: string;
}

export interface PhoneThreadListing {
  adapter: "phone";
  threadId: string;
  sendTarget: string;
  transport: PhoneTransport;
  displayName: string;
  rootPreview: string;
  lastPreview: string;
  participants: string[];
  messageCount: number;
  lastSeen: string;
  source: "phone-ledger";
}

export interface PhoneThreadTarget {
  threadId: string;
  inputTarget: string;
}

const LEDGER_PREFIX = ".flight/phone-thread-events";
const PHONE_THREAD_TARGET_RE = /^phone-[a-f0-9]{8,64}$/iu;

export function parsePhoneThreadTarget(target: string | undefined | null): PhoneThreadTarget | null {
  const trimmed = target?.trim().toLowerCase();
  if (!trimmed || !PHONE_THREAD_TARGET_RE.test(trimmed)) return null;
  return {
    threadId: trimmed.slice("phone-".length),
    inputTarget: trimmed,
  };
}

export function phoneThreadKeyForEvent(
  event: Pick<PhoneThreadLedgerEvent, "provider" | "sender" | "to" | "conversationId" | "from">,
): string {
  const provider = normalizeKeyPart(event.provider || "phone");
  const sender = normalizeKeyPart(event.sender || event.to || "phone");
  const conversationId = normalizeKeyPart(event.conversationId || `${sender}:${event.from || "unknown"}`);
  return `${provider}:${sender}:${conversationId}`;
}

export function phoneThreadIdForKey(threadKey: string): string {
  return fnv1a64(threadKey);
}

export function phoneThreadTargetForEvent(
  event: Pick<PhoneThreadLedgerEvent, "provider" | "sender" | "to" | "conversationId" | "from">,
): string {
  return `phone-${phoneThreadIdForKey(phoneThreadKeyForEvent(event))}`;
}

export async function appendPhoneThreadEvent(
  env: Env,
  agentId: string,
  event: PhoneThreadLedgerEvent,
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

export async function readPhoneThreadLedger(env: Env, agentId: string): Promise<PhoneThreadLedgerRecord[]> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return [];

  const prefix = `${workspaceRootPrefix(agentId)}${LEDGER_PREFIX}/`;
  const records: PhoneThreadLedgerRecord[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) {
      const body = await bucket.get(object.key);
      if (!body) continue;
      const parsed = await body.json<unknown>().catch(() => null);
      const event = normalizeLedgerEvent(parsed);
      if (!event) continue;
      const threadKey = phoneThreadKeyForEvent(event);
      const threadId = phoneThreadIdForKey(threadKey);
      records.push({
        ...event,
        threadKey,
        threadId,
        sendTarget: `phone-${threadId}`,
        displayName: displayNameForEvent(event),
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function readPhoneThreadByTarget(
  env: Env,
  agentId: string,
  target: PhoneThreadTarget,
  limit = 80,
): Promise<PhoneThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  return (await readPhoneThreadLedger(env, agentId))
    .filter((record) => record.sendTarget === target.inputTarget || record.threadId === target.threadId)
    .slice(-boundedLimit);
}

export async function collectPhoneThreadListings(
  env: Env,
  agentId: string,
  limit = 20,
): Promise<PhoneThreadListing[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 20, 50));
  const byThread = new Map<string, PhoneThreadListing & { participantSet: Set<string>; firstSeen: string }>();

  for (const event of await readPhoneThreadLedger(env, agentId)) {
    const existing = byThread.get(event.threadId);
    const bodyPreview = preview(event.body);
    const participantSet = existing?.participantSet || new Set<string>();
    for (const participant of participantsForEvent(event)) participantSet.add(participant);

    if (!existing) {
      byThread.set(event.threadId, {
        adapter: "phone",
        threadId: event.threadId,
        sendTarget: event.sendTarget,
        transport: event.transport || "unknown",
        displayName: event.displayName,
        rootPreview: bodyPreview,
        lastPreview: bodyPreview,
        participants: [],
        participantSet,
        messageCount: 1,
        firstSeen: event.at || "",
        lastSeen: event.at || "",
        source: "phone-ledger",
      });
      continue;
    }

    existing.messageCount += 1;
    if (event.transport) existing.transport = event.transport;
    if (event.displayName) existing.displayName = event.displayName;
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
      participants: Array.from(participantSet).slice(0, 8),
    }));
}

function normalizeLedgerEvent(value: unknown): PhoneThreadLedgerEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PhoneThreadLedgerEvent>;
  if (raw.type !== "inbound" && raw.type !== "outbound") return null;
  if (typeof raw.at !== "string" || !raw.at) return null;
  const provider = stringValue(raw.provider) || "phone";
  return {
    type: raw.type,
    at: raw.at,
    provider,
    transport: normalizeTransport(raw.transport),
    messageId: stringValue(raw.messageId),
    conversationId: stringValue(raw.conversationId),
    from: stringValue(raw.from),
    to: stringValue(raw.to),
    sender: stringValue(raw.sender),
    recipients: Array.isArray(raw.recipients)
      ? raw.recipients.map(stringValue).filter((item): item is string => !!item)
      : undefined,
    body: stringValue(raw.body),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(normalizeAttachment).filter((item): item is PhoneAttachmentLedgerRecord => !!item) : undefined,
  };
}

function normalizeAttachment(value: unknown): PhoneAttachmentLedgerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PhoneAttachmentLedgerRecord>;
  const url = stringValue(raw.url);
  const filename = stringValue(raw.filename);
  const contentType = stringValue(raw.content_type);
  const workspacePath = stringValue(raw.workspace_path);
  const size = typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : undefined;
  if (!url && !filename && !contentType && !workspacePath) return null;
  return {
    filename,
    content_type: contentType,
    url,
    workspace_path: workspacePath,
    size,
  };
}

function displayNameForEvent(event: PhoneThreadLedgerEvent): string {
  const inbound = event.from?.trim();
  const recipients = event.recipients?.filter((recipient) => recipient !== event.sender && recipient !== event.to);
  if (recipients?.length) return [inbound, ...recipients].filter(Boolean).join(", ");
  return inbound || event.conversationId || event.sender || event.to || "phone conversation";
}

function participantsForEvent(event: PhoneThreadLedgerEvent): string[] {
  return [
    event.from,
    event.to,
    event.sender,
    ...(event.recipients || []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeTransport(value: unknown): PhoneTransport | undefined {
  if (value === "imessage" || value === "sms" || value === "mms" || value === "rcs" || value === "whatsapp" || value === "unknown") {
    return value;
  }
  return undefined;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase() || "unknown";
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
