import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { parentAgentIdFromInstanceId } from "../awareness/id";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";

const BrowserWaitUntil = v.union([
  v.literal("load"),
  v.literal("domcontentloaded"),
  v.literal("networkidle0"),
  v.literal("networkidle2"),
]);

const BrowserImageType = v.union([
  v.literal("png"),
  v.literal("jpeg"),
  v.literal("webp"),
]);

const BrowserCommonOptions = {
  wait_until: v.optional(BrowserWaitUntil),
  timeout_ms: v.optional(v.pipe(v.number(), v.minValue(1000), v.maxValue(30000))),
  width: v.optional(v.pipe(v.number(), v.minValue(320), v.maxValue(2400))),
  height: v.optional(v.pipe(v.number(), v.minValue(240), v.maxValue(2400))),
};

const BrowserScreenshotInput = v.object({
  url: v.pipe(v.string(), v.url()),
  ...BrowserCommonOptions,
  full_page: v.optional(v.boolean()),
  type: v.optional(BrowserImageType),
  quality: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
  save_path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
});

const BrowserPdfInput = v.object({
  url: v.pipe(v.string(), v.url()),
  ...BrowserCommonOptions,
  save_path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
});

const BrowserEvaluateInput = v.object({
  url: v.pipe(v.string(), v.url()),
  expression: v.pipe(v.string(), v.minLength(1), v.maxLength(20_000)),
  ...BrowserCommonOptions,
});

const BrowserSessionInput = v.object({
  action: v.union([
    v.literal("start"),
    v.literal("status"),
    v.literal("nav"),
    v.literal("content"),
    v.literal("evaluate"),
    v.literal("screenshot"),
    v.literal("pdf"),
    v.literal("close"),
  ]),
  url: v.optional(v.pipe(v.string(), v.url())),
  expression: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(20_000))),
  include_html: v.optional(v.boolean()),
  ...BrowserCommonOptions,
  keep_alive_ms: v.optional(v.pipe(v.number(), v.minValue(10_000), v.maxValue(600_000))),
  full_page: v.optional(v.boolean()),
  type: v.optional(BrowserImageType),
  quality: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100))),
  save_path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
});

type BrowserScreenshotInputValue = v.InferOutput<typeof BrowserScreenshotInput>;
type BrowserPdfInputValue = v.InferOutput<typeof BrowserPdfInput>;
type BrowserEvaluateInputValue = v.InferOutput<typeof BrowserEvaluateInput>;
type BrowserSessionInputValue = v.InferOutput<typeof BrowserSessionInput>;

type BrowserAction =
  | "screenshot"
  | "evaluate"
  | "pdf";

type BrowserSessionAction = BrowserSessionInputValue["action"];

const MAX_TOOL_RESULT_CHARS = 120_000;

export function createBrowserScreenshotTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_screenshot",
    description:
      "Capture a screenshot of a public http(s) URL with TinyFat's Cloudflare Browser Rendering API. The image is saved into /workspace/browser-artifacts and the tool returns metadata plus the workspace path. It cannot access private networks, localhost, or logged-in browser sessions.",
    parameters: BrowserScreenshotInput,
    execute: async (args, signal) => {
      const result = await runBrowserScreenshot({
        env: input.env,
        instanceId: input.instanceId,
        request: args,
        signal,
      });
      return jsonResult(result);
    },
  });
}

export function createBrowserPdfTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_pdf",
    description:
      "Render a public http(s) URL to PDF with TinyFat's Cloudflare Browser Rendering API. The PDF is saved into /workspace/browser-artifacts and the tool returns metadata plus the workspace path.",
    parameters: BrowserPdfInput,
    execute: async (args, signal) => {
      const result = await runBrowserPdf({
        env: input.env,
        instanceId: input.instanceId,
        request: args,
        signal,
      });
      return jsonResult(result);
    },
  });
}

export function createBrowserEvaluateTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_evaluate",
    description:
      "Load a public http(s) URL and evaluate a JSON-serializable JavaScript expression in the page context. Use it for structured DOM inspection, computed state, metadata, and link/form extraction when browser_content is too coarse.",
    parameters: BrowserEvaluateInput,
    execute: async (args, signal) => {
      const result = await runBrowserEvaluate({
        env: input.env,
        instanceId: input.instanceId,
        request: args,
        signal,
      });
      return jsonResult(result);
    },
  });
}

export function createBrowserSessionTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "browser_session",
    description:
      "Operate a short-lived persistent Cloudflare Browser Rendering session for a public site. Actions: start, status, nav, content, evaluate, screenshot, pdf, close. Screenshots and PDFs are saved to /workspace/browser-artifacts. It cannot access private networks, localhost, or logged-in browser sessions.",
    parameters: BrowserSessionInput,
    execute: async (args, signal) => {
      const result = await runBrowserSession({
        env: input.env,
        instanceId: input.instanceId,
        request: args,
        signal,
      });
      return jsonResult(result);
    },
  });
}

export async function runBrowserScreenshot(input: {
  env: Env;
  instanceId: string;
  request: BrowserScreenshotInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const result = await requestBrowser({
    env: input.env,
    instanceId: input.instanceId,
    action: "screenshot",
    request: input.request,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  });
  return storeBinaryArtifact({
    env: input.env,
    instanceId: input.instanceId,
    result,
    requestedPath: input.request.save_path,
    defaultStem: artifactStem("screenshot", input.request.url),
  });
}

export async function runBrowserPdf(input: {
  env: Env;
  instanceId: string;
  request: BrowserPdfInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const result = await requestBrowser({
    env: input.env,
    instanceId: input.instanceId,
    action: "pdf",
    request: input.request,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  });
  return storeBinaryArtifact({
    env: input.env,
    instanceId: input.instanceId,
    result,
    requestedPath: input.request.save_path,
    defaultStem: artifactStem("pdf", input.request.url),
  });
}

export async function runBrowserEvaluate(input: {
  env: Env;
  instanceId: string;
  request: BrowserEvaluateInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return requestBrowser({
    env: input.env,
    instanceId: input.instanceId,
    action: "evaluate",
    request: input.request,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  });
}

export async function runBrowserSession(input: {
  env: Env;
  instanceId: string;
  request: BrowserSessionInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const result = await requestBrowser({
    env: input.env,
    instanceId: input.instanceId,
    action: input.request.action,
    session: true,
    request: input.request,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  });

  if (input.request.action !== "screenshot" && input.request.action !== "pdf") {
    return result;
  }

  return storeBinaryArtifact({
    env: input.env,
    instanceId: input.instanceId,
    result,
    requestedPath: input.request.save_path,
    defaultStem: artifactStem(input.request.action, input.request.url || resultUrl(result)),
  });
}

async function requestBrowser(input: {
  env: Env;
  instanceId: string;
  action: BrowserAction | BrowserSessionAction;
  session?: boolean;
  request: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const agentId = parentAgentIdFromInstanceId(input.instanceId);
  if (!agentId) throw new Error("Cannot resolve parent TinyFat agent id for this Flight scope.");
  if (!input.env.CRAWDAD_API_BASE || !input.env.CRAWDAD_API_TOKEN) {
    throw new Error("Browser tools are not configured.");
  }

  const base = input.env.CRAWDAD_API_BASE.replace(/\/+$/g, "");
  const actionPath = input.session
    ? `/api/v2/agents/${encodeURIComponent(agentId)}/browser/session/${input.action}`
    : `/api/v2/agents/${encodeURIComponent(agentId)}/browser/${input.action}`;
  const fetchImpl = input.fetchImpl || globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(`${base}${actionPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.env.CRAWDAD_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toCrawdadBrowserBody(input.request)),
    signal: input.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Browser ${input.session ? "session " : ""}${input.action} failed with ${response.status}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function toCrawdadBrowserBody(request: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copy(request, body, "url", "url");
  copy(request, body, "expression", "expression");
  copy(request, body, "include_html", "includeHtml");
  copy(request, body, "wait_until", "waitUntil");
  copy(request, body, "timeout_ms", "timeoutMs");
  copy(request, body, "width", "width");
  copy(request, body, "height", "height");
  copy(request, body, "keep_alive_ms", "keepAliveMs");
  copy(request, body, "full_page", "fullPage");
  copy(request, body, "type", "type");
  copy(request, body, "quality", "quality");
  return body;
}

function copy(source: Record<string, unknown>, target: Record<string, unknown>, from: string, to: string): void {
  if (source[from] !== undefined) target[to] = source[from];
}

async function storeBinaryArtifact(input: {
  env: Env;
  instanceId: string;
  result: Record<string, unknown>;
  requestedPath?: string;
  defaultStem: string;
}): Promise<Record<string, unknown>> {
  const dataBase64 = typeof input.result.dataBase64 === "string" ? input.result.dataBase64 : "";
  if (!dataBase64) return input.result;
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) throw new Error("Browser binary artifact storage requires FLIGHT_WORKSPACE.");

  const mimeType = typeof input.result.mimeType === "string" ? input.result.mimeType : "application/octet-stream";
  const extension = extensionForMimeType(mimeType);
  const path = normalizeWorkspaceArtifactPath(input.requestedPath, `${input.defaultStem}.${extension}`);
  const ownerId = parentAgentIdFromInstanceId(input.instanceId);
  if (!ownerId) throw new Error("Cannot resolve parent TinyFat agent id for this Flight scope.");
  const key = `${workspaceRootPrefix(ownerId)}${path.relativePath}`;
  const bytes = base64ToBytes(dataBase64);

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
  });

  const {
    dataBase64: _dataBase64,
    ...rest
  } = input.result;
  return {
    ...rest,
    artifact: {
      path: path.displayPath,
      mimeType,
      bytes: bytes.byteLength,
    },
  };
}

function normalizeWorkspaceArtifactPath(requestedPath: string | undefined, defaultName: string): {
  displayPath: string;
  relativePath: string;
} {
  const raw = (requestedPath || `/workspace/browser-artifacts/${defaultName}`).trim();
  if (!raw.startsWith("/workspace/")) {
    throw new Error("Browser artifact save_path must start with /workspace/.");
  }
  const relativePath = raw.replace(/^\/workspace\/+/u, "").replace(/\/+/gu, "/");
  if (!relativePath || relativePath.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("Browser artifact save_path must be a normal /workspace file path.");
  }
  return { displayPath: `/workspace/${relativePath}`, relativePath };
}

function artifactStem(kind: string, url: string | undefined): string {
  const now = new Date().toISOString().replace(/[:.]/gu, "-");
  let host = "page";
  if (url) {
    try {
      host = new URL(url).hostname;
    } catch {
      host = "page";
    }
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "page";
  return `${now}-${kind}-${slug}`;
}

function resultUrl(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const url = (result as { url?: unknown }).url;
  if (typeof url === "string") return url;
  const session = (result as { session?: unknown }).session;
  if (!session || typeof session !== "object" || Array.isArray(session)) return undefined;
  const activeUrl = (session as { activeUrl?: unknown }).activeUrl;
  return typeof activeUrl === "string" ? activeUrl : undefined;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return "png";
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function jsonResult(value: unknown): string {
  return clip(JSON.stringify(value, null, 2), MAX_TOOL_RESULT_CHARS);
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}
