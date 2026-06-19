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
const MAX_DIRECT_FETCH_BYTES = 512 * 1024;
const MAX_DIRECT_TEXT_CHARS = 120_000;
const TINYFAT_PUBLIC_HOSTS = ["tinyfat.com", "tinyfat.dev", "tinyfat.site"];

export function createBrowserContentTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_content",
    description:
      "Load a public http(s) URL through TinyFat's Cloudflare Browser Rendering API and return the rendered title, visible text, and links. For TinyFat-hosted plain text/content-store URLs, it can fall back to a bounded direct text fetch. Use it for public website inspection; it cannot access private networks or logged-in browser sessions.",
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
  const fetchImpl = input.fetchImpl || globalThis.fetch.bind(globalThis);

  try {
    return await fetchRenderedBrowserContent({
      base,
      agentId,
      token: input.env.CRAWDAD_API_TOKEN,
      request: input.request,
      signal: input.signal,
      fetchImpl,
    });
  } catch (renderError) {
    try {
      const fallback = await fetchTinyFatTextFallback({
        request: input.request,
        signal: input.signal,
        fetchImpl,
        renderError,
      });
      if (fallback) return fallback;
    } catch (fallbackError) {
      throw new Error(`${errorMessage(renderError)}; TinyFat direct text fallback failed: ${errorMessage(fallbackError)}`);
    }
    throw renderError;
  }
}

async function fetchRenderedBrowserContent(input: {
  base: string;
  agentId: string;
  token: string;
  request: BrowserContentInputValue;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<unknown> {
  const response = await input.fetchImpl(
    `${input.base}/api/v2/agents/${encodeURIComponent(input.agentId)}/browser/content`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
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

async function fetchTinyFatTextFallback(input: {
  request: BrowserContentInputValue;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  renderError: unknown;
}): Promise<Record<string, unknown> | null> {
  const parsed = new URL(input.request.url);
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!isTinyFatPublicHost(parsed.hostname)) return null;

  const response = await input.fetchImpl(parsed.toString(), {
    method: "GET",
    headers: {
      Accept: "text/plain,text/html,application/json,application/xml,application/javascript,application/x-ndjson,*/*;q=0.1",
    },
    signal: input.signal,
  });

  const contentType = response.headers.get("content-type") || "";
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DIRECT_FETCH_BYTES) {
    throw new Error(`response is too large for direct text fallback (${declaredLength} bytes)`);
  }

  if (!response.ok) {
    throw new Error(`direct fetch failed with ${response.status}: ${clip(await response.text(), 1_000)}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DIRECT_FETCH_BYTES) {
    throw new Error(`response is too large for direct text fallback (${bytes.byteLength} bytes)`);
  }

  const decoded = decodeTextLike(bytes, contentType);
  if (!decoded.ok) {
    throw new Error(`direct fallback only supports text-like responses; got ${contentType || "unknown content type"}`);
  }

  const textTruncated = decoded.text.length > MAX_DIRECT_TEXT_CHARS;
  return {
    ok: true,
    action: "content",
    mode: "direct_text_fallback",
    url: response.url || parsed.toString(),
    status: response.status,
    title: "",
    text: textTruncated ? decoded.text.slice(0, MAX_DIRECT_TEXT_CHARS) : decoded.text,
    links: [],
    contentType: contentType || undefined,
    fallbackReason: errorMessage(input.renderError),
    truncated: { text: textTruncated },
  };
}

function isTinyFatPublicHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/g, "");
  return TINYFAT_PUBLIC_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function decodeTextLike(bytes: Uint8Array, contentType: string): { ok: boolean; text: string } {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/u, "");
  if (bytes.byteLength === 0 || isTextContentType(contentType)) {
    return { ok: true, text };
  }
  if (bytes.includes(0)) return { ok: false, text: "" };

  const sample = text.slice(0, 4096);
  if (!sample) return { ok: true, text };
  let suspicious = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (char === "\uFFFD" || (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13)) {
      suspicious += 1;
    }
  }
  return { ok: suspicious / sample.length <= 0.02, text };
}

function isTextContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() || "";
  return mediaType.startsWith("text/")
    || mediaType === "application/json"
    || mediaType === "application/ld+json"
    || mediaType === "application/xml"
    || mediaType === "application/xhtml+xml"
    || mediaType === "application/javascript"
    || mediaType === "application/x-javascript"
    || mediaType === "application/ecmascript"
    || mediaType === "application/x-ndjson"
    || mediaType.endsWith("+json")
    || mediaType.endsWith("+xml");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return clip(error.message, 1_000);
  return clip(String(error), 1_000);
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
