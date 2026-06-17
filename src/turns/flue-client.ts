import { flue } from "@flue/runtime/routing";
import type { Context } from "hono";
import type { Env } from "../env";

type AppContext = Context<{ Bindings: Env }>;

const flueApp = flue();

export interface AgentAdmission {
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

export async function postDirectPrompt(
  c: AppContext,
  instanceId: string,
  message: string,
): Promise<AgentAdmission> {
  const response = await fetchFlue(c, new Request(flueUrl(`/agents/tinyfat/${encodeURIComponent(instanceId)}`), {
    method: "POST",
    headers: internalFlueHeaders(c.env),
    body: JSON.stringify({ message }),
  }));
  if (!response.ok) {
    throw new Error(`Flight prompt admission failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json().catch(() => null) as Partial<AgentAdmission> | null;
  if (!data?.streamUrl || !data.offset || !data.submissionId) {
    throw new Error("Flight prompt admission returned invalid stream coordinates.");
  }
  return {
    streamUrl: data.streamUrl,
    offset: data.offset,
    submissionId: data.submissionId,
  };
}

export async function readAgentStream(
  c: AppContext,
  admission: AgentAdmission,
  onEvents: (events: any[]) => boolean | Promise<boolean>,
): Promise<void> {
  const url = flueUrl(admission.streamUrl);
  url.searchParams.set("offset", admission.offset);
  url.searchParams.set("live", "sse");
  const response = await fetchFlue(c, new Request(url, { headers: internalFlueHeaders(c.env) }));
  if (!response.ok || !response.body) {
    throw new Error(`Flight stream failed (${response.status}): ${await response.text()}`);
  }
  await readFlueSse(response, onEvents);
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
  return flueApp.fetch(request, c.env, safeExecutionContext(c));
}

function safeExecutionContext(c: AppContext): ExecutionContext | undefined {
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
