import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";

export interface WorkspaceFileRecord {
  path: string;
  key: string;
  size: number;
  contentType?: string;
}

const DEFAULT_UPLOAD_PREFIX = "uploads";
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function writeWorkspaceFile(input: {
  env: Env;
  ownerId: string;
  path: string;
  content: string | Uint8Array | ArrayBuffer;
  contentType?: string;
}): Promise<WorkspaceFileRecord> {
  if (!input.env.FLIGHT_WORKSPACE) {
    throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");
  }

  const relativePath = normalizeWorkspaceRelativePath(input.path);
  const bytes = bytesForContent(input.content);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Workspace uploads are limited to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per file.`);
  }

  const key = `${workspaceRootPrefix(input.ownerId)}${relativePath}`;
  await input.env.FLIGHT_WORKSPACE.put(key, bytes, input.contentType
    ? { httpMetadata: { contentType: input.contentType } }
    : undefined);

  return {
    path: `/workspace/${relativePath}`,
    key,
    size: bytes.byteLength,
    contentType: input.contentType,
  };
}

export function defaultUploadDirectory(now = new Date()): string {
  return `/workspace/${DEFAULT_UPLOAD_PREFIX}/${now.toISOString().slice(0, 10)}`;
}

export function normalizeWorkspaceDirectory(path: string | null | undefined, now = new Date()): string {
  const raw = path?.trim() || defaultUploadDirectory(now);
  const relativePath = normalizeWorkspaceRelativePath(raw);
  return `/workspace/${relativePath}`;
}

export function workspacePathInDirectory(directory: string, filename: string): string {
  const cleanDirectory = normalizeWorkspaceDirectory(directory).replace(/\/+$/u, "");
  return `${cleanDirectory}/${safeFilename(filename)}`;
}

export function safeFilename(filename: string, fallback = "file"): string {
  const lastSegment = filename.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() || fallback;
  const cleaned = lastSegment
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}

export function uniqueWorkspacePath(path: string, used: Set<string>): string {
  const normalized = `/workspace/${normalizeWorkspaceRelativePath(path)}`;
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }

  const slash = normalized.lastIndexOf("/");
  const directory = normalized.slice(0, slash);
  const filename = normalized.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${directory}/${stem}-${index}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate unique workspace path for ${normalized}.`);
}

export function normalizeWorkspaceRelativePath(path: string): string {
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
  const relativePath = normalized.slice("/workspace/".length).replace(/\/+$/u, "");
  if (!relativePath) throw new Error("Workspace file path must include a filename.");
  if (relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid workspace path: ${path}`);
  }
  return relativePath;
}

function bytesForContent(content: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}
