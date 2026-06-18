import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";
import { agentToolsToken, siteApiUrl } from "./site-api";

const UploadSiteContentInput = v.object({
  site: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(63),
    v.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/u, "Use a lowercase site slug."),
  ),
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  source_path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
  content: v.optional(v.pipe(v.string(), v.maxLength(5 * 1024 * 1024))),
  content_type: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  binding: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(80))),
  environment: v.optional(v.union([v.literal("preview"), v.literal("production")])),
});

type UploadSiteContentInputValue = v.InferOutput<typeof UploadSiteContentInput>;

export function createUploadSiteContentTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "upload_site_content",
    description:
      "Upload a text string or a /workspace file into a deployed TinyFat site's R2 content binding. The object becomes readable at /__tinyfat/content/<key> on the site.",
    parameters: UploadSiteContentInput,
    execute: async (args, signal) => {
      const { ownerId, toolsToken } = await agentToolsToken(input);
      const result = await uploadSiteContent({
        env: input.env,
        ownerId,
        toolsToken,
        request: args,
        signal,
      });
      return JSON.stringify(result, null, 2);
    },
  });
}

export async function uploadSiteContent(input: {
  env: Env;
  ownerId: string;
  toolsToken: string;
  request: UploadSiteContentInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const body = await buildUploadBody(input);
  const response = await (input.fetchImpl || fetch)(siteApiUrl(input.env, input.request.site, "content"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.toolsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Site content upload failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) as unknown : {};
}

async function buildUploadBody(input: {
  env: Env;
  ownerId: string;
  request: UploadSiteContentInputValue;
}): Promise<Record<string, unknown>> {
  const key = normalizeContentKey(input.request.key);
  const base = {
    key,
    binding: input.request.binding || "MEDIA",
    environment: input.request.environment || "preview",
  };

  if (input.request.source_path) {
    const bytes = await readWorkspaceFile(input.env, input.ownerId, input.request.source_path);
    return {
      ...base,
      contentBase64: bytesToBase64(bytes),
      contentType: input.request.content_type || contentTypeForPath(key),
    };
  }

  if (input.request.content !== undefined) {
    return {
      ...base,
      content: input.request.content,
      contentType: input.request.content_type || contentTypeForPath(key),
    };
  }

  throw new Error("upload_site_content requires either source_path or content.");
}

async function readWorkspaceFile(env: Env, ownerId: string, path: string): Promise<Uint8Array> {
  if (!env.FLIGHT_WORKSPACE) throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");
  const relativePath = normalizeWorkspacePath(path);
  const object = await env.FLIGHT_WORKSPACE.get(`${workspaceRootPrefix(ownerId)}${relativePath}`);
  if (!object) throw new Error(`No file exists at /workspace/${relativePath}.`);
  return object.bytes();
}

function normalizeWorkspacePath(path: string): string {
  const raw = path.trim();
  const absolute = raw.startsWith("/") ? raw : `/workspace/${raw}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (!normalized.startsWith("/workspace/")) {
    throw new Error(`Path is outside /workspace: ${path}`);
  }
  return normalized.slice("/workspace/".length).replace(/\/+$/u, "");
}

function normalizeContentKey(value: string): string {
  const key = value.trim().replace(/\\/g, "/").replace(/^\/+/u, "");
  if (!key) throw new Error("key is required.");
  if (/[\u0000-\u001f\u007f]/u.test(key)) throw new Error("key contains control characters.");
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("key must not contain empty, current, or parent path segments.");
  }
  return segments.join("/");
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary);
}
