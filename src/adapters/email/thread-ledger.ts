import type { Env } from "../../env";
import { workspaceRootPrefix } from "../../sandboxes/r2-workspace";
import type { EmailReplyQuote } from "../types";
import { composeEmailReplyBody } from "./reply-composer";
import { normalizeMessageIdForHeader, parseReferencesHeader } from "./thread-headers";

export interface EmailThreadLedgerEvent {
  type: "inbound" | "outbound";
  at: string;
  channelId: string;
  from?: string;
  to?: string[];
  subject?: string;
  body?: string;
  messageId?: string;
  providerMessageId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface EmailThreadLedgerRecord extends EmailThreadLedgerEvent {
  threadKey: string;
  threadId: string;
}

export interface EmailThreadListing {
  adapter: "email";
  threadId: string;
  sendTarget: string;
  subject: string;
  rootPreview: string;
  lastPreview: string;
  participants: string[];
  messageCount: number;
  lastSeen: string;
  source: "email-ledger";
}

const LEDGER_PREFIX = ".flight/email-thread-events";
const EMAIL_THREAD_TARGET_RE = /^email-thread:([a-f0-9]{16})$/iu;

export interface EmailThreadTarget {
  threadId: string;
  inputTarget: string;
}

export function parseEmailThreadTarget(target: string | undefined | null): EmailThreadTarget | null {
  const match = target?.trim().match(EMAIL_THREAD_TARGET_RE);
  if (!match) return null;
  return {
    threadId: match[1].toLowerCase(),
    inputTarget: `email-thread:${match[1].toLowerCase()}`,
  };
}

export function emailThreadKeyForEvent(
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject" | "messageId" | "inReplyTo" | "references">,
): string {
  const references = parseReferencesHeader(event.references);
  const rootReference = references[0];
  if (rootReference) return `message:${messageIdKey(rootReference)}`;

  const inReplyTo = normalizeMessageIdForHeader(event.inReplyTo);
  if (inReplyTo) return `message:${messageIdKey(inReplyTo)}`;

  const messageId = normalizeMessageIdForHeader(event.messageId);
  if (messageId) return `message:${messageIdKey(messageId)}`;

  return `fallback:${event.channelId}:${normalizeSubject(event.subject)}`;
}

export function emailThreadIdForKey(threadKey: string): string {
  return fnv1a64(threadKey);
}

export function emailThreadIdForEvent(
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject" | "messageId" | "inReplyTo" | "references">,
): string {
  return emailThreadIdForKey(emailThreadKeyForEvent(event));
}

export async function appendEmailThreadEvent(
  env: Env,
  agentId: string,
  event: EmailThreadLedgerEvent,
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

export async function readEmailThreadLedger(env: Env, agentId: string): Promise<EmailThreadLedgerRecord[]> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return [];

  const prefix = `${workspaceRootPrefix(agentId)}${LEDGER_PREFIX}/`;
  const records: EmailThreadLedgerRecord[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const object of listed.objects) {
      const body = await bucket.get(object.key);
      if (!body) continue;
      const parsed = await body.json<unknown>().catch(() => null);
      const event = normalizeLedgerEvent(parsed);
      if (!event) continue;
      const threadKey = emailThreadKeyForEvent(event);
      records.push({
        ...event,
        threadKey,
        threadId: emailThreadIdForKey(threadKey),
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export async function readEmailThreadForEvent(
  env: Env,
  agentId: string,
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject" | "messageId" | "inReplyTo" | "references">,
): Promise<EmailThreadLedgerRecord[]> {
  const threadId = emailThreadIdForEvent(event);
  return readEmailThreadById(env, agentId, threadId);
}

export async function readRelatedEmailThreadForEvent(
  env: Env,
  agentId: string,
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject" | "messageId" | "inReplyTo" | "references">,
  limit = 80,
): Promise<EmailThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  const exactThreadId = emailThreadIdForEvent(event);
  const subjectThreadId = emailSubjectThreadIdForEvent(event);

  return (await readEmailThreadLedger(env, agentId))
    .filter((record) => (
      record.threadId === exactThreadId ||
      (subjectThreadId ? emailSubjectThreadIdForEvent(record) === subjectThreadId : false)
    ))
    .slice(-boundedLimit);
}

export async function readEmailThreadById(
  env: Env,
  agentId: string,
  threadId: string,
  limit = 80,
): Promise<EmailThreadLedgerRecord[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 80, 200));
  return (await readEmailThreadLedger(env, agentId))
    .filter((record) => record.threadId === threadId || emailSubjectThreadIdForEvent(record) === threadId)
    .slice(-boundedLimit);
}

export async function collectEmailThreadListings(
  env: Env,
  agentId: string,
  limit = 20,
): Promise<EmailThreadListing[]> {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 20, 50));
  const records = await readEmailThreadLedger(env, agentId);
  const threadIdsBySubject = new Map<string, Set<string>>();

  for (const record of records) {
    const subjectKey = emailSubjectThreadKeyForEvent(record);
    if (!subjectKey) continue;
    const ids = threadIdsBySubject.get(subjectKey) || new Set<string>();
    ids.add(record.threadId);
    threadIdsBySubject.set(subjectKey, ids);
  }

  const byThread = new Map<string, EmailThreadListing & { participantSet: Set<string>; firstSeen: string }>();
  for (const event of records) {
    const subjectKey = emailSubjectThreadKeyForEvent(event);
    const useSubjectThread = subjectKey ? (threadIdsBySubject.get(subjectKey)?.size || 0) > 1 : false;
    const threadId = useSubjectThread && subjectKey ? emailThreadIdForKey(subjectKey) : event.threadId;
    const existing = byThread.get(threadId);
    const bodyPreview = preview(event.body);
    const participantSet = existing?.participantSet || new Set<string>();
    for (const participant of participantsForEvent(event)) participantSet.add(participant);

    if (!existing) {
      byThread.set(threadId, {
        adapter: "email",
        threadId,
        sendTarget: `email-thread:${threadId}`,
        subject: preview(event.subject, 80) || "(no subject)",
        rootPreview: bodyPreview,
        lastPreview: bodyPreview,
        participants: [],
        participantSet,
        messageCount: 1,
        firstSeen: event.at || "",
        lastSeen: event.at || "",
        source: "email-ledger",
      });
      continue;
    }

    existing.messageCount += 1;
    if (bodyPreview && (!existing.rootPreview || (event.at && event.at < existing.firstSeen))) {
      existing.rootPreview = bodyPreview;
      existing.firstSeen = event.at || existing.firstSeen;
    }
    if (!existing.lastSeen || (event.at && event.at > existing.lastSeen)) {
      existing.lastSeen = event.at || existing.lastSeen;
      existing.lastPreview = bodyPreview || existing.lastPreview;
      existing.subject = preview(event.subject, 80) || existing.subject;
    }
  }

  return Array.from(byThread.values())
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, boundedLimit)
    .map(({ participantSet, firstSeen: _firstSeen, ...thread }) => ({
      ...thread,
      rootPreview: thread.rootPreview || thread.lastPreview || "(no body captured)",
      lastPreview: thread.lastPreview || thread.rootPreview || "(no body captured)",
      participants: Array.from(participantSet).slice(0, 6),
    }));
}

export async function latestInboundEmailThreadEvent(
  env: Env,
  agentId: string,
  threadId: string,
): Promise<EmailThreadLedgerRecord | undefined> {
  return (await readEmailThreadById(env, agentId, threadId))
    .filter((record) => record.type === "inbound" && !!record.from)
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    [0];
}

export function buildThreadedReplyQuote(input: {
  records: EmailThreadLedgerRecord[];
  currentBody: string;
  currentFrom: string;
  currentSentAt: string;
}): EmailReplyQuote | undefined {
  const currentBody = input.currentBody.trim();
  if (!currentBody) return undefined;

  const turns = input.records
    .filter((record) => !!record.body?.trim())
    .map((record) => ({
      body: record.body?.trim() || "",
      from: record.from || record.to?.[0] || "someone",
      sentAt: record.at,
    }));

  turns.push({
    body: currentBody,
    from: input.currentFrom,
    sentAt: input.currentSentAt,
  });

  let threadBody = turns[0]?.body || currentBody;
  for (let i = 1; i < turns.length; i += 1) {
    const previousTurn = turns[i - 1];
    threadBody = composeEmailReplyBody(turns[i].body, {
      body: threadBody,
      from: previousTurn.from,
      sentAt: previousTurn.sentAt,
    });
  }

  return {
    body: threadBody,
    from: input.currentFrom,
    sentAt: input.currentSentAt,
  };
}

function normalizeLedgerEvent(value: unknown): EmailThreadLedgerEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<EmailThreadLedgerEvent>;
  if (raw.type !== "inbound" && raw.type !== "outbound") return null;
  if (typeof raw.at !== "string" || !raw.at) return null;
  if (typeof raw.channelId !== "string" || !raw.channelId) return null;
  return {
    type: raw.type,
    at: raw.at,
    channelId: raw.channelId,
    from: stringValue(raw.from),
    to: Array.isArray(raw.to) ? raw.to.map(stringValue).filter((item): item is string => !!item) : undefined,
    subject: stringValue(raw.subject),
    body: stringValue(raw.body),
    messageId: stringValue(raw.messageId),
    providerMessageId: stringValue(raw.providerMessageId),
    inReplyTo: stringValue(raw.inReplyTo),
    references: stringValue(raw.references),
  };
}

function normalizeSubject(subject?: string): string {
  return (subject || "")
    .trim()
    .replace(/^(?:\s*(?:re|fwd):)+\s*/iu, "")
    .toLowerCase();
}

function emailSubjectThreadKeyForEvent(
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject">,
): string | null {
  const subject = normalizeSubject(event.subject);
  if (!event.channelId || !subject) return null;
  return `fallback:${event.channelId}:${subject}`;
}

function emailSubjectThreadIdForEvent(
  event: Pick<EmailThreadLedgerEvent, "channelId" | "subject">,
): string | null {
  const key = emailSubjectThreadKeyForEvent(event);
  return key ? emailThreadIdForKey(key) : null;
}

function messageIdKey(messageId: string): string {
  const normalized = normalizeMessageIdForHeader(messageId) || messageId.trim();
  const inner = normalized.startsWith("<") && normalized.endsWith(">")
    ? normalized.slice(1, -1)
    : normalized;
  const at = inner.lastIndexOf("@");
  if (at === -1) return inner;
  return `${inner.slice(0, at)}@${inner.slice(at + 1).toLowerCase()}`;
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
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function participantsForEvent(event: EmailThreadLedgerEvent): string[] {
  return [
    event.from,
    ...(event.to || []),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
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
