import type { Env } from "../env";

const MAX_AWARENESS_LINES = 2_000;

export type AwarenessRole = "user" | "assistant" | "tool" | "system";

export type AwarenessContent =
  | { type: "text"; text: string; phase?: "commentary" | "final_answer" }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>; label?: string }
  | { type: "toolResult"; toolCallId: string; result: string; isError?: boolean };

export interface AwarenessEntry {
  id: string;
  type: "message" | "tool_call" | "tool_result" | "delivery" | "diagnostic";
  timestamp: string;
  role?: AwarenessRole;
  adapter: string;
  channel?: string;
  userName?: string;
  deliveryId?: string;
  submissionId?: string;
  content?: AwarenessContent[];
  data?: Record<string, unknown>;
}

export interface AwarenessPage {
  entries: AwarenessEntry[];
  total: number;
  offset: number;
}

export function userAwarenessEntry(input: {
  id: string;
  timestamp: string;
  adapter: string;
  channel: string;
  userName: string;
  text: string;
  deliveryId?: string;
}): AwarenessEntry {
  return {
    id: input.id,
    type: "message",
    timestamp: input.timestamp,
    role: "user",
    adapter: input.adapter,
    channel: input.channel,
    userName: input.userName,
    deliveryId: input.deliveryId,
    content: [{ type: "text", text: input.text }],
  };
}

export function assistantAwarenessEntry(input: {
  id: string;
  timestamp: string;
  adapter: string;
  channel?: string;
  text: string;
  submissionId?: string;
  content?: AwarenessContent[];
}): AwarenessEntry {
  return {
    id: input.id,
    type: "message",
    timestamp: input.timestamp,
    role: "assistant",
    adapter: input.adapter,
    channel: input.channel,
    submissionId: input.submissionId,
    content: input.content?.length ? input.content : [{ type: "text", text: input.text }],
  };
}

export async function appendAwarenessEntry(
  env: Env,
  instanceId: string,
  entry: AwarenessEntry,
): Promise<void> {
  const stub = awarenessStub(env, instanceId);
  if (!stub) return;
  const response = await stub.fetch("https://flight-awareness.local/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  if (!response.ok) {
    throw new Error(`Awareness write failed (${response.status}): ${await response.text()}`);
  }
}

export async function fetchAwarenessEntries(
  env: Env,
  instanceId: string,
  options: { limit?: number; before?: number } = {},
): Promise<AwarenessPage> {
  const stub = awarenessStub(env, instanceId);
  if (!stub) return { entries: [], total: 0, offset: 0 };
  const url = new URL("https://flight-awareness.local/entries");
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.before !== undefined) url.searchParams.set("before", String(options.before));
  const response = await stub.fetch(url);
  if (!response.ok) {
    throw new Error(`Awareness read failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<AwarenessPage>;
}

export async function streamAwarenessEntries(env: Env, instanceId: string): Promise<Response | null> {
  const stub = awarenessStub(env, instanceId);
  return stub ? stub.fetch("https://flight-awareness.local/entries/stream") : null;
}

function awarenessStub(env: Env, instanceId: string): DurableObjectStub | null {
  const namespace = env.FLIGHT_AWARENESS;
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(instanceId));
}

export class FlightAwareness {
  private readonly initialized: Promise<void>;
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();

  constructor(private readonly ctx: DurableObjectState, _env: Env) {
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS awareness_entries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS awareness_entries_order_idx ON awareness_entries (timestamp ASC, id ASC)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized;
    const url = new URL(request.url);

    if (url.pathname === "/entries" && request.method === "GET") {
      return this.readEntries(url);
    }

    if (url.pathname === "/entries/stream" && request.method === "GET") {
      return this.streamEntries();
    }

    if (url.pathname === "/entries" && request.method === "POST") {
      return this.appendEntry(request);
    }

    return new Response("Not found.", { status: 404 });
  }

  private readEntries(url: URL): Response {
    const limit = parsePositiveInt(url.searchParams.get("limit"), 80, 300);
    const total = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM awareness_entries",
    ).one().count;
    const before = parsePositiveInt(url.searchParams.get("before"), total, MAX_AWARENESS_LINES);
    const end = Math.max(0, Math.min(before, total));
    const offset = Math.max(0, end - limit);
    const rows = this.ctx.storage.sql
      .exec<{ entry_json: string }>(
        `SELECT entry_json FROM awareness_entries
         ORDER BY timestamp ASC, id ASC
         LIMIT ? OFFSET ?`,
        limit,
        offset,
      )
      .toArray();
    const entries = rows.map((row) => parseEntry(row.entry_json)).filter((entry): entry is AwarenessEntry => !!entry);
    return Response.json({ entries, total, offset });
  }

  private async appendEntry(request: Request): Promise<Response> {
    const body = await request.json().catch(() => null) as { entry?: unknown } | null;
    const entry = normalizeAwarenessEntry(body?.entry);
    if (!entry) return new Response("Invalid awareness entry.", { status: 400 });
    const entryJson = JSON.stringify(entry);
    this.ctx.storage.sql.exec(
      `INSERT INTO awareness_entries (id, timestamp, entry_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         timestamp = excluded.timestamp,
         entry_json = excluded.entry_json`,
      entry.id,
      entry.timestamp,
      entryJson,
      Date.now(),
    );
    this.prune();
    this.broadcast(entry);
    return Response.json({ ok: true });
  }

  private streamEntries(): Response {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        streamController = controller;
        this.subscribers.add(controller);
        controller.enqueue(this.encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        if (streamController) this.subscribers.delete(streamController);
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private broadcast(entry: AwarenessEntry): void {
    const frame = this.encoder.encode(`data: ${JSON.stringify(entry)}\n\n`);
    for (const controller of Array.from(this.subscribers)) {
      try {
        controller.enqueue(frame);
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }

  private prune(): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM awareness_entries
       WHERE id IN (
         SELECT id FROM awareness_entries
         ORDER BY timestamp DESC, id DESC
         LIMIT -1 OFFSET ?
       )`,
      MAX_AWARENESS_LINES,
    );
  }
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

function parseEntry(value: string): AwarenessEntry | null {
  try {
    return normalizeAwarenessEntry(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeAwarenessEntry(value: unknown): AwarenessEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<AwarenessEntry>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.timestamp !== "string" || !raw.timestamp) return null;
  if (raw.type !== "message" && raw.type !== "tool_call" && raw.type !== "tool_result" && raw.type !== "delivery" && raw.type !== "diagnostic") {
    return null;
  }
  if (typeof raw.adapter !== "string" || !raw.adapter) return null;
  return raw as AwarenessEntry;
}
