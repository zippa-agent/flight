import type { Context } from "hono";
import { flue } from "@flue/runtime/routing";
import type { Env } from "../env";
import { appendConsoleLedgerLine, fetchConsoleLedgerLines, streamConsoleLedgerLines } from "./ledger";

type AppContext = Context<{ Bindings: Env }>;

const flueApp = flue();
const ACTIVE_CONSOLE_SUBMISSION_TTL_MS = 30_000;
const activeConsoleSubmissions = new Map<string, number>();

export interface ConsoleMessageInput {
  agentId: string;
  instanceId: string;
  message: string;
}

interface AgentAdmission {
  streamUrl: string;
  offset: string;
  submissionId: string;
  instanceId: string;
}

interface SseFrame {
  event: string;
  data: string;
}

export function sseHeaders(): Headers {
  return new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

export async function postAgentMessage(c: AppContext, input: ConsoleMessageInput): Promise<AgentAdmission> {
  const url = flueUrl(`/agents/tinyfat/${encodeURIComponent(input.instanceId)}`);
  const response = await fetchFlue(c, new Request(url, {
    method: "POST",
    headers: internalFlueHeaders(c.env),
    body: JSON.stringify({ message: input.message }),
  }));
  if (!response.ok) {
    throw new Error(`Flight prompt admission failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json().catch(() => null) as Partial<AgentAdmission> | null;
  if (!data?.streamUrl || !data.offset || !data.submissionId) {
    throw new Error("Flight prompt admission returned an invalid response.");
  }
  const admission = {
    streamUrl: data.streamUrl,
    offset: data.offset,
    submissionId: data.submissionId,
    instanceId: input.instanceId,
  };
  markActiveConsoleSubmission(admission.submissionId);
  return admission;
}

export async function promptAgentForResult(c: AppContext, input: ConsoleMessageInput): Promise<string> {
  const url = flueUrl(`/agents/tinyfat/${encodeURIComponent(input.instanceId)}`);
  url.searchParams.set("wait", "result");
  const response = await fetchFlue(c, new Request(url, {
    method: "POST",
    headers: internalFlueHeaders(c.env),
    body: JSON.stringify({ message: input.message }),
  }));
  if (!response.ok) {
    throw new Error(`Flight prompt failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json().catch(() => null) as {
    result?: { text?: unknown };
  } | null;
  const text = data?.result?.text;
  return typeof text === "string" ? text.trim() : "";
}

export function streamConsoleMessage(c: AppContext, admission: AgentAdmission): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      void (async () => {
        const fallbackRecorder = createAssistantFallbackRecorder(admission.submissionId);
        const assistantLedgerLines: string[] = [];
        const flushAssistantLedgerLines = async () => {
          const fallbackLine = fallbackRecorder.toContextLine();
          if (fallbackLine) assistantLedgerLines.push(fallbackLine);
          const lines = assistantLedgerLines.splice(0);
          await Promise.allSettled(lines.map((line) => (
            appendConsoleLedgerLine(c.env, admission.instanceId, line).catch((error) => {
              console.warn("Flight console assistant ledger write failed:", error);
            })
          )));
        };
        try {
          send({ type: "status", status: "connecting" });
          const url = flueUrl(admission.streamUrl);
          url.searchParams.set("offset", admission.offset);
          url.searchParams.set("live", "sse");
          const response = await fetchFlue(c, new Request(url, { headers: internalFlueHeaders(c.env) }));
          if (!response.ok || !response.body) {
            throw new Error(`Flight stream failed (${response.status}): ${await response.text()}`);
          }
          send({ type: "status", status: "streaming" });
          let completed = false;
          let sentComplete = false;
          await readFlueSse(response, async (events) => {
            for (const event of events) {
              if (event?.submissionId && event.submissionId !== admission.submissionId) continue;
              fallbackRecorder.capture(event);
              const contextLine = flueEventToContextLine(event);
              if (contextLine && contextLineRole(contextLine) === "assistant") {
                fallbackRecorder.markAuthoritative();
                assistantLedgerLines.push(contextLine);
              }
              for (const consoleEvent of flueEventToConsoleEvents(event)) {
                send(consoleEvent);
              }
              if (isTerminalEvent(event)) {
                completed = true;
                if (!sentComplete) {
                  sentComplete = true;
                  await flushAssistantLedgerLines();
                  send({ type: "run_complete" });
                }
              }
            }
            return completed;
          });
          if (!sentComplete) {
            await flushAssistantLedgerLines();
            send({ type: "run_complete" });
          }
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          keepActiveConsoleSubmission(admission.submissionId);
          await flushAssistantLedgerLines();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
  });

  return new Response(body, { headers: sseHeaders() });
}

export async function fetchConsoleHistory(c: AppContext, instanceId: string, limit: number, before?: number): Promise<{
  lines: string[];
  total: number;
  offset: number;
}> {
  const url = flueUrl(`/agents/tinyfat/${encodeURIComponent(instanceId)}`);
  url.searchParams.set("offset", "-1");
  url.searchParams.set("tail", "500");
  const response = await fetchFlue(c, new Request(url, { headers: internalFlueHeaders(c.env) }));
  if (response.status === 404) return { lines: [], total: 0, offset: 0 };
  if (!response.ok) {
    console.warn(`Flight history unavailable (${response.status}): ${await response.text()}`);
    return { lines: [], total: 0, offset: 0 };
  }
  const events = await response.json().catch(() => []) as unknown[];
  const flueLines = events.flatMap((event) => {
    const line = flueEventToContextLine(event);
    return line && contextLineRole(line) !== "user" ? [line] : [];
  });
  const ledgerLines = await fetchConsoleLedgerLines(c.env, instanceId).catch((error) => {
    console.warn("Flight console ledger read failed:", error);
    return [];
  });
  const lines = mergeConsoleHistoryLines([...ledgerLines, ...flueLines]);
  const end = before === undefined ? lines.length : Math.max(0, Math.min(before, lines.length));
  const start = Math.max(0, end - limit);
  return {
    lines: lines.slice(start, end),
    total: lines.length,
    offset: start,
  };
}

export function mergeConsoleHistoryLines(lines: string[]): string[] {
  const byId = new Map<string, { line: string; timestamp: string }>();
  for (const line of lines) {
    const parsed = contextLineEnvelope(line);
    if (!parsed) continue;
    byId.set(parsed.id, { line, timestamp: parsed.timestamp });
  }
  return Array.from(byId.values())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.line.localeCompare(b.line))
    .map((entry) => entry.line);
}

interface AssistantFallbackRecorder {
  capture(event: any): void;
  markAuthoritative(): void;
  toContextLine(): string | null;
}

export function createAssistantFallbackRecorder(submissionId: string): AssistantFallbackRecorder {
  let timestamp = new Date().toISOString();
  let thinking = "";
  let text = "";
  let hasAuthoritativeSnapshot = false;
  let emittedFallback = false;

  return {
    capture(event: any) {
      if (!event || typeof event !== "object") return;
      if (typeof event.timestamp === "string" && event.timestamp) timestamp = event.timestamp;
      if (event.type === "thinking_delta" && typeof event.delta === "string") {
        thinking += event.delta;
      }
      if (event.type === "thinking_end" && typeof event.content === "string") {
        thinking = event.content;
      }
      if (event.type === "text_delta" && typeof event.text === "string") {
        text += event.text;
      }
    },
    markAuthoritative() {
      hasAuthoritativeSnapshot = true;
    },
    toContextLine() {
      if (hasAuthoritativeSnapshot || emittedFallback) return null;
      const content: Array<Record<string, unknown>> = [];
      if (thinking.trim()) content.push({ type: "thinking", thinking });
      if (text.trim()) content.push({ type: "text", text });
      if (content.length === 0) return null;
      emittedFallback = true;
      return JSON.stringify({
        id: `flight-console-${stableIdPart(submissionId)}-assistant`,
        type: "message",
        timestamp,
        message: { role: "assistant", content },
      });
    },
  };
}

function contextLineRole(line: string): string | null {
  return contextLineEnvelope(line)?.role || null;
}

function contextLineEnvelope(line: string): { id: string; timestamp: string; role?: string } | null {
  try {
    const parsed = JSON.parse(line) as {
      id?: unknown;
      timestamp?: unknown;
      type?: unknown;
      message?: { role?: unknown };
    };
    if (parsed.type !== "message") return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    if (typeof parsed.timestamp !== "string" || !parsed.timestamp) return null;
    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      role: typeof parsed.message?.role === "string" ? parsed.message.role : undefined,
    };
  } catch {
    return null;
  }
}

export async function streamConsoleHistory(c: AppContext, instanceId: string): Promise<Response> {
  const ledgerStream = await streamConsoleLedgerLines(c.env, instanceId);
  if (ledgerStream) return ledgerStream;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const sendLine = (line: string) => controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      void (async () => {
        try {
          const url = flueUrl(`/agents/tinyfat/${encodeURIComponent(instanceId)}`);
          url.searchParams.set("offset", "now");
          url.searchParams.set("live", "sse");
          const response = await fetchFlue(c, new Request(url, { headers: internalFlueHeaders(c.env) }));
          if (response.status === 404) {
            controller.enqueue(encoder.encode(": stream-not-created\n\n"));
            controller.close();
            return;
          }
          if (!response.ok || !response.body) {
            throw new Error(`Flight event stream failed (${response.status}): ${await response.text()}`);
          }
          await readFlueSse(response, (events) => {
            for (const event of events) {
              if (isActiveConsoleSubmissionEvent(event)) continue;
              const line = flueEventToContextLine(event);
              if (line) sendLine(line);
            }
            return false;
          });
        } catch {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
  });
  return new Response(body, { headers: sseHeaders() });
}

function internalFlueHeaders(env: Env): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.FLIGHT_API_TOKEN) headers.set("Authorization", `Bearer ${env.FLIGHT_API_TOKEN}`);
  return headers;
}

function flueUrl(pathname: string): URL {
  return new URL(pathname, "https://flight.internal");
}

async function fetchFlue(c: AppContext, request: Request): Promise<Response> {
  return await flueApp.fetch(request, c.env, safeExecutionContext(c));
}

function safeExecutionContext(c: AppContext) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

async function readFlueSse(
  response: Response,
  onEvents: (events: any[]) => boolean | Promise<boolean>,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const rawFrame of frames) {
      const frame = parseSseFrame(rawFrame);
      if (!frame || frame.event !== "data") continue;
      const events = JSON.parse(frame.data) as any[];
      if (await onEvents(Array.isArray(events) ? events : [])) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
  }
}

function parseSseFrame(rawFrame: string): SseFrame | null {
  const lines = rawFrame.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

export function flueEventToConsoleEvents(event: any): unknown[] {
  if (!event || typeof event !== "object") return [];
  switch (event.type) {
    case "text_delta":
      return typeof event.text === "string"
        ? [{ type: "text_delta", delta: event.text, contentIndex: 0, phase: "final_answer" }]
        : [];
    case "thinking_delta":
      return typeof event.delta === "string"
        ? [{ type: "thinking_delta", delta: event.delta, contentIndex: 0 }]
        : [];
    case "thinking_end":
      return typeof event.content === "string"
        ? [{ type: "thinking_patch", thinking: event.content, contentIndex: 0 }]
        : [];
    case "tool_start":
      return [{
        type: "toolCall",
        id: String(event.toolCallId || crypto.randomUUID()),
        name: String(event.toolName || "tool"),
        arguments: normalizeToolArguments(event.toolName, event.args),
      }];
    case "tool":
      return [{
        type: "toolResult",
        toolCallId: String(event.toolCallId || ""),
        result: stringifyToolResult(event.result),
        isError: Boolean(event.isError),
      }];
    case "message_end":
      if (event.message?.role !== "assistant") return [];
      return [{
        type: "assistant_snapshot",
        entry: {
          id: `flight-assistant-${event.eventIndex ?? Date.now()}`,
          type: "message",
          timestamp: event.timestamp || new Date().toISOString(),
          role: "assistant",
          content: normalizeContentBlocks(event.message.content),
          isStreaming: true,
          streamProtocol: "snapshot",
        },
      }];
    case "operation":
      return event.isError ? [{ type: "error", message: errorMessage(event.error) }] : [];
    case "submission_settled":
      return event.outcome === "failed" ? [{ type: "error", message: errorMessage(event.error) }] : [];
    default:
      return [];
  }
}

function isTerminalEvent(event: any): boolean {
  return event?.type === "idle" || event?.type === "agent_end" || event?.type === "submission_settled";
}

export function flueEventToContextLine(event: any): string | null {
  if (!event || event.type !== "message_end" || !event.message) return null;
  const role = event.message.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = normalizeMessageContentForContext(event.message.content);
  if (content.length === 0) return null;
  return JSON.stringify({
    id: flightEventContextId(event, role),
    type: "message",
    timestamp: event.timestamp || new Date().toISOString(),
    message: { role, content },
  });
}

function markActiveConsoleSubmission(submissionId: string): void {
  pruneActiveConsoleSubmissions();
  activeConsoleSubmissions.set(submissionId, Date.now() + ACTIVE_CONSOLE_SUBMISSION_TTL_MS);
}

function keepActiveConsoleSubmission(submissionId: string): void {
  activeConsoleSubmissions.set(submissionId, Date.now() + ACTIVE_CONSOLE_SUBMISSION_TTL_MS);
}

function isActiveConsoleSubmissionEvent(event: any): boolean {
  pruneActiveConsoleSubmissions();
  return typeof event?.submissionId === "string" && activeConsoleSubmissions.has(event.submissionId);
}

function pruneActiveConsoleSubmissions(): void {
  const now = Date.now();
  for (const [submissionId, expiresAt] of activeConsoleSubmissions) {
    if (expiresAt <= now) activeConsoleSubmissions.delete(submissionId);
  }
}

function flightEventContextId(event: any, role: string): string {
  const instance = typeof event.instanceId === "string" && event.instanceId ? stableIdPart(event.instanceId) : "instance";
  const index = typeof event.eventIndex === "number" || typeof event.eventIndex === "string"
    ? String(event.eventIndex)
    : typeof event.timestamp === "string" && event.timestamp
      ? stableIdPart(event.timestamp)
      : crypto.randomUUID();
  return `flight-${instance}-${role}-${index}`;
}

function stableIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "value";
}

function normalizeMessageContentForContext(content: unknown): Array<Record<string, unknown>> {
  const blocks = normalizeContentBlocks(content);
  if (blocks.length > 0) return blocks;
  const text = textFromContent(content);
  return text ? [{ type: "text", text }] : [];
}

function normalizeToolArguments(name: unknown, args: unknown): Record<string, unknown> {
  const normalized = args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {};
  if (typeof normalized.label !== "string" || !normalized.label.trim()) {
    const toolName = typeof name === "string" && name ? name : "tool";
    normalized.label = humanizeToolName(toolName);
  }
  return normalized;
}

function humanizeToolName(name: string): string {
  return name.replace(/^functions\./, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return normalizeContentBlock(content as Record<string, unknown>);
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): Array<Record<string, unknown>> => {
    if (!block || typeof block !== "object") return [];
    return normalizeContentBlock(block as Record<string, unknown>);
  });
}

function normalizeContentBlock(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (raw.type === "text" || raw.type === "input_text" || raw.type === "output_text") {
    return [{ type: "text", text: String(raw.text ?? raw.content ?? "") }];
  }
  if (raw.type === "thinking") return [{ type: "thinking", thinking: String(raw.thinking || "") }];
  if (raw.type === "toolCall" || raw.type === "tool_call" || raw.type === "tool_use") {
    const rawArgs = raw.arguments ?? raw.args ?? raw.input;
    return [{
      type: "toolCall",
      id: String(raw.id ?? raw.toolCallId ?? raw.tool_call_id ?? raw.toolUseId ?? raw.tool_use_id ?? ""),
      name: String(raw.name ?? raw.toolName ?? raw.tool_name ?? "tool"),
      arguments: rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? rawArgs as Record<string, unknown>
        : {},
    }];
  }
  if (typeof raw.text === "string") return [{ type: "text", text: raw.text }];
  if (typeof raw.content === "string") return [{ type: "text", text: raw.content }];
  if (Array.isArray(raw.content)) return normalizeContentBlocks(raw.content);
  return [];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return textFromContentObject(content as Record<string, unknown>);
  }
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (!block || typeof block !== "object") return "";
    return textFromContentObject(block as Record<string, unknown>);
  }).filter(Boolean).join("\n\n");
}

function textFromContentObject(raw: Record<string, unknown>): string {
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.content === "string") return raw.content;
  if (Array.isArray(raw.content)) return textFromContent(raw.content);
  if (typeof raw.value === "string") return raw.value;
  return "";
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content.map((block) => {
        if (!block || typeof block !== "object") return "";
        const raw = block as Record<string, unknown>;
        return raw.type === "text" && typeof raw.text === "string" ? raw.text : "";
      }).filter(Boolean).join("\n\n");
      if (text) return text;
    }
  }
  return result === undefined ? "" : JSON.stringify(result);
}

function errorMessage(error: unknown): string {
  if (!error) return "Flight turn failed.";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return JSON.stringify(error);
}
