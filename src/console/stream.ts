import type { Context } from "hono";
import { flue } from "@flue/runtime/routing";
import type { Env } from "../env";

type AppContext = Context<{ Bindings: Env }>;

const flueApp = flue();

export interface ConsoleMessageInput {
  agentId: string;
  instanceId: string;
  message: string;
}

interface AgentAdmission {
  streamUrl: string;
  offset: string;
  submissionId: string;
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
  return {
    streamUrl: data.streamUrl,
    offset: data.offset,
    submissionId: data.submissionId,
  };
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
          await readFlueSse(response, (events) => {
            for (const event of events) {
              if (event?.submissionId && event.submissionId !== admission.submissionId) continue;
              for (const consoleEvent of flueEventToConsoleEvents(event)) {
                send(consoleEvent);
              }
              if (isTerminalEvent(event)) {
                completed = true;
                if (!sentComplete) {
                  sentComplete = true;
                  send({ type: "run_complete" });
                }
              }
            }
            return completed;
          });
          if (!sentComplete) send({ type: "run_complete" });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
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
  const lines = events.flatMap((event) => {
    const line = flueEventToContextLine(event);
    return line ? [line] : [];
  });
  const end = before === undefined ? lines.length : Math.max(0, Math.min(before, lines.length));
  const start = Math.max(0, end - limit);
  return {
    lines: lines.slice(start, end),
    total: lines.length,
    offset: start,
  };
}

export function streamConsoleHistory(c: AppContext, instanceId: string): Response {
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
  onEvents: (events: any[]) => boolean,
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
      if (onEvents(Array.isArray(events) ? events : [])) {
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

function flueEventToContextLine(event: any): string | null {
  if (!event || event.type !== "message_end" || !event.message) return null;
  const role = event.message.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = role === "assistant"
    ? normalizeContentBlocks(event.message.content)
    : [{ type: "text", text: textFromContent(event.message.content) }];
  return JSON.stringify({
    id: `flight-${role}-${event.eventIndex ?? Date.now()}`,
    type: "message",
    timestamp: event.timestamp || new Date().toISOString(),
    message: { role, content },
  });
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
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): Array<Record<string, unknown>> => {
    if (!block || typeof block !== "object") return [];
    const raw = block as Record<string, unknown>;
    if (raw.type === "text") return [{ type: "text", text: String(raw.text || "") }];
    if (raw.type === "thinking") return [{ type: "thinking", thinking: String(raw.thinking || "") }];
    if (raw.type === "toolCall") {
      return [{
        type: "toolCall",
        id: String(raw.id || ""),
        name: String(raw.name || "tool"),
        arguments: raw.arguments && typeof raw.arguments === "object" && !Array.isArray(raw.arguments)
          ? raw.arguments as Record<string, unknown>
          : {},
      }];
    }
    return [];
  });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (!block || typeof block !== "object") return "";
    const raw = block as Record<string, unknown>;
    return raw.type === "text" && typeof raw.text === "string" ? raw.text : "";
  }).filter(Boolean).join("\n\n");
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
