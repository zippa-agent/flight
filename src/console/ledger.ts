import type { Env } from "../env";

const MAX_LEDGER_LINES = 1_000;

export interface ConsoleLedgerUserEntry {
  submissionId: string;
  timestamp: string;
  prompt: string;
}

export function consoleUserContextLine(entry: ConsoleLedgerUserEntry): string {
  return JSON.stringify({
    id: `flight-console-${stableIdPart(entry.submissionId)}-user`,
    type: "message",
    timestamp: entry.timestamp,
    message: {
      role: "user",
      content: [{ type: "text", text: entry.prompt }],
    },
  });
}

export async function appendConsoleUserEntry(
  env: Env,
  instanceId: string,
  entry: ConsoleLedgerUserEntry,
): Promise<void> {
  return appendConsoleLedgerLine(env, instanceId, consoleUserContextLine(entry));
}

export async function appendConsoleLedgerLine(
  env: Env,
  instanceId: string,
  line: string,
): Promise<void> {
  const stub = consoleLedgerStub(env, instanceId);
  if (!stub) return;
  const response = await stub.fetch("https://flight-console-ledger.local/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ line }),
  });
  if (!response.ok) {
    throw new Error(`Console ledger write failed (${response.status}): ${await response.text()}`);
  }
}

export async function fetchConsoleLedgerLines(env: Env, instanceId: string): Promise<string[]> {
  const stub = consoleLedgerStub(env, instanceId);
  if (!stub) return [];
  const response = await stub.fetch("https://flight-console-ledger.local/entries");
  if (!response.ok) {
    throw new Error(`Console ledger read failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json().catch(() => null) as { lines?: unknown } | null;
  return Array.isArray(data?.lines) ? data.lines.filter((line): line is string => typeof line === "string") : [];
}

export async function streamConsoleLedgerLines(env: Env, instanceId: string): Promise<Response | null> {
  const stub = consoleLedgerStub(env, instanceId);
  if (!stub) return null;
  return await stub.fetch("https://flight-console-ledger.local/entries/stream");
}

function consoleLedgerStub(env: Env, instanceId: string): DurableObjectStub | null {
  const namespace = env.FLIGHT_CONSOLE_LEDGER;
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(instanceId));
}

function stableIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "value";
}

export class FlightConsoleLedger {
  private readonly initialized: Promise<void>;
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();

  constructor(private readonly ctx: DurableObjectState, _env: Env) {
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS console_entries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        line TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS console_entries_timestamp_idx ON console_entries (timestamp ASC, id ASC)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized;
    const url = new URL(request.url);

    if (url.pathname === "/entries" && request.method === "GET") {
      const rows = this.ctx.storage.sql
        .exec<{ line: string }>(
          "SELECT line FROM console_entries ORDER BY timestamp ASC, id ASC LIMIT ?",
          MAX_LEDGER_LINES,
        )
        .toArray();
      return Response.json({ lines: rows.map((row) => row.line) });
    }

    if (url.pathname === "/entries/stream" && request.method === "GET") {
      return this.streamEntries();
    }

    if (url.pathname === "/entries" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { line?: unknown } | null;
      if (typeof body?.line !== "string") return new Response("Missing line.", { status: 400 });
      const parsed = parseContextLineEnvelope(body.line);
      if (!parsed) return new Response("Invalid line.", { status: 400 });
      this.ctx.storage.sql.exec(
        `INSERT INTO console_entries (id, timestamp, line, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           timestamp = excluded.timestamp,
           line = excluded.line`,
        parsed.id,
        parsed.timestamp,
        body.line,
        Date.now(),
      );
      this.broadcastLine(body.line);
      return Response.json({ ok: true });
    }

    return new Response("Not found.", { status: 404 });
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

  private broadcastLine(line: string): void {
    const frame = this.encoder.encode(`data: ${line}\n\n`);
    for (const controller of Array.from(this.subscribers)) {
      try {
        controller.enqueue(frame);
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }
}

function parseContextLineEnvelope(line: string): { id: string; timestamp: string } | null {
  try {
    const parsed = JSON.parse(line) as { id?: unknown; timestamp?: unknown; type?: unknown; message?: unknown };
    if (parsed.type !== "message") return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    if (typeof parsed.timestamp !== "string" || !parsed.timestamp) return null;
    if (!parsed.message || typeof parsed.message !== "object") return null;
    return { id: parsed.id, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}
