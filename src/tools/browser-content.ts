import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { parentAgentIdFromInstanceId } from "../awareness/id";

const BrowserContentInput = v.object({
  url: v.pipe(v.string(), v.url()),
  include_html: v.optional(v.boolean()),
  wait_until: v.optional(v.union([
    v.literal("load"),
    v.literal("domcontentloaded"),
    v.literal("networkidle0"),
    v.literal("networkidle2"),
  ])),
  timeout_ms: v.optional(v.pipe(v.number(), v.minValue(1000), v.maxValue(30000))),
  width: v.optional(v.pipe(v.number(), v.minValue(320), v.maxValue(2400))),
  height: v.optional(v.pipe(v.number(), v.minValue(240), v.maxValue(2400))),
});

type BrowserContentInputValue = v.InferOutput<typeof BrowserContentInput>;

const MAX_TOOL_RESULT_CHARS = 80_000;

export function createBrowserContentTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_content",
    description:
      "Load a public http(s) URL through TinyFat's Cloudflare Browser Rendering API and return the rendered title, visible text, and links. Use it for public website inspection; it cannot access private networks or logged-in browser sessions.",
    parameters: BrowserContentInput,
    execute: async (args, signal) => {
      const result = await fetchBrowserContent({
        env: input.env,
        instanceId: input.instanceId,
        request: args,
        signal,
      });
      return clip(JSON.stringify(result, null, 2), MAX_TOOL_RESULT_CHARS);
    },
  });
}

export async function fetchBrowserContent(input: {
  env: Env;
  instanceId: string;
  request: BrowserContentInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const agentId = parentAgentIdFromInstanceId(input.instanceId);
  if (!agentId) throw new Error("Cannot resolve parent TinyFat agent id for this Flight scope.");
  if (!input.env.CRAWDAD_API_BASE || !input.env.CRAWDAD_API_TOKEN) {
    throw new Error("browser_content is not configured.");
  }

  const base = input.env.CRAWDAD_API_BASE.replace(/\/+$/g, "");
  const response = await (input.fetchImpl || fetch)(
    `${base}/api/v2/agents/${encodeURIComponent(agentId)}/browser/content`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.env.CRAWDAD_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: input.request.url,
        includeHtml: input.request.include_html,
        waitUntil: input.request.wait_until,
        timeoutMs: input.request.timeout_ms,
        width: input.request.width,
        height: input.request.height,
      }),
      signal: input.signal,
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Browser content failed with ${response.status}`);
  }
  return text ? JSON.parse(text) as unknown : {};
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
