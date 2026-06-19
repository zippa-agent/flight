import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";

export type ContactIdentityKind = "phone" | "email" | "slack" | "other";
export type ContactKind = "person" | "company" | "agent" | "unknown";
export type ContactConfidence = "confirmed" | "inferred";
export type ContactSource = "agent" | "admin" | "crm" | "system";

export interface ContactBookIdentity {
  displayName: string;
  kind?: ContactKind;
  confidence?: ContactConfidence;
  notes?: string;
  source?: ContactSource;
  updatedAt?: string;
}

export interface ContactBook {
  version: 1;
  identities: Record<string, ContactBookIdentity>;
  updatedAt?: string;
}

export interface RememberContactIdentityInput {
  env: Pick<Env, "FLIGHT_WORKSPACE">;
  agentId: string;
  identityKind: ContactIdentityKind;
  identity: string;
  displayName: string;
  kind?: ContactKind;
  confidence?: ContactConfidence;
  notes?: string;
  source?: ContactSource;
}

export interface RememberContactIdentityResult {
  identityKey: string;
  entry: ContactBookIdentity;
  book: ContactBook;
}

const CONTACT_BOOK_KEY = ".flight/contacts.json";
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{2,}$/iu;

export async function readContactBook(
  env: Pick<Env, "FLIGHT_WORKSPACE">,
  agentId: string,
): Promise<ContactBook> {
  const bucket = env.FLIGHT_WORKSPACE;
  if (!bucket) return emptyContactBook();
  const object = await bucket.get(contactBookKey(agentId));
  if (!object) return emptyContactBook();
  const parsed = await object.json<unknown>().catch(() => null);
  return normalizeContactBook(parsed);
}

export async function rememberContactIdentity(
  input: RememberContactIdentityInput,
): Promise<RememberContactIdentityResult> {
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) throw new Error("Flight workspace storage is not configured.");

  const identityKey = normalizeContactIdentity(input.identityKind, input.identity);
  if (!identityKey) throw new Error(`Could not normalize ${input.identityKind} identity "${input.identity}".`);

  const displayName = input.displayName.replace(/\s+/gu, " ").trim();
  if (!displayName) throw new Error("display_name is required.");

  const now = new Date().toISOString();
  const book = await readContactBook(input.env, input.agentId);
  const existing = book.identities[identityKey];
  const notes = input.notes?.replace(/\s+/gu, " ").trim();
  const entry = pruneUndefined({
    displayName,
    kind: input.kind || existing?.kind,
    confidence: input.confidence || existing?.confidence || "confirmed",
    notes: notes || existing?.notes,
    source: input.source || existing?.source || "agent",
    updatedAt: now,
  });

  const nextBook: ContactBook = {
    version: 1,
    identities: {
      ...book.identities,
      [identityKey]: entry,
    },
    updatedAt: now,
  };

  await bucket.put(contactBookKey(input.agentId), JSON.stringify(nextBook, null, 2));
  return { identityKey, entry, book: nextBook };
}

export function normalizeContactIdentity(kind: ContactIdentityKind, value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (kind === "phone") {
    const phone = normalizePhone(raw);
    return phone ? `phone:${phone}` : null;
  }

  if (kind === "email") {
    const email = extractEmail(raw);
    return email ? `email:${email}` : null;
  }

  if (kind === "slack") {
    const slack = normalizeSlack(raw, true);
    return slack ? `slack:${slack}` : null;
  }

  const other = normalizeOther(raw);
  return other ? `other:${other}` : null;
}

export function formatResolvedIdentity(book: ContactBook, value: string | undefined | null): string {
  const raw = value?.trim();
  if (!raw) return "";
  const match = findContactIdentity(book, raw);
  if (!match) return raw;
  const suffix = displaySuffixForIdentityKey(match.identityKey) || raw;
  if (sameDisplay(match.entry.displayName, suffix)) return match.entry.displayName;
  return `${match.entry.displayName} (${suffix})`;
}

export function formatContactList(book: ContactBook, values: Array<string | undefined | null>): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const raw = value?.trim();
    if (!raw) continue;
    const identityKey = identityKeyForRawValue(raw) || `raw:${raw.toLowerCase()}`;
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);
    labels.push(formatResolvedIdentity(book, raw));
  }
  return labels;
}

export function contactBookPath(): string {
  return CONTACT_BOOK_KEY;
}

function contactBookKey(agentId: string): string {
  return `${workspaceRootPrefix(agentId)}${CONTACT_BOOK_KEY}`;
}

function normalizeContactBook(value: unknown): ContactBook {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyContactBook();
  const raw = value as Partial<ContactBook>;
  const identities: Record<string, ContactBookIdentity> = {};
  if (raw.identities && typeof raw.identities === "object" && !Array.isArray(raw.identities)) {
    for (const [identityKey, identity] of Object.entries(raw.identities)) {
      const normalizedKey = normalizeStoredIdentityKey(identityKey);
      const normalizedIdentity = normalizeContactBookIdentity(identity);
      if (normalizedKey && normalizedIdentity) identities[normalizedKey] = normalizedIdentity;
    }
  }
  return pruneUndefined({
    version: 1 as const,
    identities,
    updatedAt: stringValue(raw.updatedAt),
  });
}

function normalizeContactBookIdentity(value: unknown): ContactBookIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<ContactBookIdentity>;
  const displayName = stringValue(raw.displayName);
  if (!displayName) return null;
  return pruneUndefined({
    displayName,
    kind: normalizeContactKind(raw.kind),
    confidence: normalizeContactConfidence(raw.confidence),
    notes: stringValue(raw.notes),
    source: normalizeContactSource(raw.source),
    updatedAt: stringValue(raw.updatedAt),
  });
}

function emptyContactBook(): ContactBook {
  return { version: 1, identities: {} };
}

function findContactIdentity(book: ContactBook, value: string): { identityKey: string; entry: ContactBookIdentity } | null {
  for (const identityKey of candidateIdentityKeys(value)) {
    const entry = book.identities[identityKey];
    if (entry) return { identityKey, entry };
  }
  return null;
}

function candidateIdentityKeys(value: string): string[] {
  const raw = value.trim();
  const primary = identityKeyForRawValue(raw);
  const hasAddressIdentity = !!extractEmail(raw) || !!normalizePhone(raw);
  const slackName = hasAddressIdentity ? null : normalizeSlack(raw, true);
  const other = hasAddressIdentity ? null : normalizeOther(raw);
  const candidates = [
    normalizeStoredIdentityKey(raw),
    primary,
    other ? `other:${other}` : null,
    slackName ? `slack:${slackName}` : null,
  ].filter((candidate): candidate is string => !!candidate);
  return [...new Set(candidates)];
}

function identityKeyForRawValue(value: string): string | null {
  const email = extractEmail(value);
  if (email) return `email:${email}`;
  const phone = normalizePhone(value);
  if (phone) return `phone:${phone}`;
  const slack = normalizeSlack(value, false);
  if (slack) return `slack:${slack}`;
  const other = normalizeOther(value);
  return other ? `other:${other}` : null;
}

function normalizeStoredIdentityKey(value: string): string | null {
  const [prefix, ...rest] = value.trim().split(":");
  const body = rest.join(":");
  if (!body) return null;
  if (prefix === "phone") return normalizeContactIdentity("phone", body);
  if (prefix === "email") return normalizeContactIdentity("email", body);
  if (prefix === "slack") return normalizeContactIdentity("slack", body);
  if (prefix === "other") return normalizeContactIdentity("other", body);
  return null;
}

function displaySuffixForIdentityKey(identityKey: string): string {
  const [prefix, ...rest] = identityKey.split(":");
  const body = rest.join(":");
  if (!body) return "";
  if (prefix === "email" || prefix === "phone" || prefix === "slack") return body;
  return "";
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length < 7) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function extractEmail(value: string): string | null {
  const match = value.trim().match(EMAIL_RE);
  return match?.[0].toLowerCase() || null;
}

function normalizeSlack(value: string, allowName: boolean): string | null {
  const explicit = /^slack:/iu.test(value.trim());
  const raw = value.trim().replace(/^slack:/iu, "");
  if (!raw) return null;
  if (SLACK_USER_ID_RE.test(raw)) return raw.toUpperCase();
  return explicit || allowName ? normalizeOther(raw) : null;
}

function normalizeOther(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim().toLowerCase();
  return normalized || null;
}

function sameDisplay(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/gu, " ").trim() : undefined;
}

function normalizeContactKind(value: unknown): ContactKind | undefined {
  return value === "person" || value === "company" || value === "agent" || value === "unknown" ? value : undefined;
}

function normalizeContactConfidence(value: unknown): ContactConfidence | undefined {
  return value === "confirmed" || value === "inferred" ? value : undefined;
}

function normalizeContactSource(value: unknown): ContactSource | undefined {
  return value === "agent" || value === "admin" || value === "crm" || value === "system" ? value : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}
