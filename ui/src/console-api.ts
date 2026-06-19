export interface AwarenessBacklog {
  lines: string[];
  total: number;
  offset: number;
}

export interface AgentSettingsSnapshot {
  model?: string | null;
  provider?: string | null;
  thinking_level?: string | null;
}

export interface UploadedWorkspaceFile {
  name: string;
  path: string;
  size: number;
  contentType: string | null;
}

const DEFAULT_FETCH_TIMEOUT_MS = 8000;

function currentAgentId(): string {
  const match = window.location.pathname.match(/\/agents\/([0-9a-f-]{36})(?:\/|$)/i);
  return match?.[1] ?? "current";
}

function scopedApiUrl(endpoint: string): string {
  const suffix = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`/api/agents/${encodeURIComponent(currentAgentId())}${suffix}`, window.location.origin);
  const current = new URLSearchParams(window.location.search);
  for (const key of ["scope", "channel", "session"]) {
    const value = current.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

async function readError(resp: Response, fallback: string): Promise<Error> {
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await resp.json().catch(() => null) as { error?: string; error_description?: string } | null;
    return new Error(body?.error_description || body?.error || fallback);
  }
  const text = await resp.text().catch(() => "");
  return new Error(text || fallback);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { credentials: "same-origin", ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function isEmbedMode(): boolean {
  return true;
}

export async function fetchAgentSettings(): Promise<AgentSettingsSnapshot> {
  return {
    provider: "flight",
    model: "default",
    thinking_level: null,
  };
}

export async function fetchAwarenessBacklog(limit: number, before?: number): Promise<AwarenessBacklog> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set("before", String(before));
  const resp = await fetchWithTimeout(scopedApiUrl(`/awareness?${params}`));
  if (!resp.ok) throw await readError(resp, `Awareness failed: ${resp.status}`);
  const data = await resp.json() as { entries?: unknown[]; total?: number; offset?: number };
  return {
    lines: (data.entries || []).map((entry) => JSON.stringify(entry)),
    total: data.total || 0,
    offset: data.offset || 0,
  };
}

export function awarenessStreamUrl(): string {
  return scopedApiUrl("/awareness/stream");
}

export function postMessageUrl(): string {
  return scopedApiUrl("/messages");
}

export async function uploadWorkspaceFiles(files: File[], path?: string): Promise<UploadedWorkspaceFile[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  if (path) form.set("path", path);

  const resp = await fetchWithTimeout(scopedApiUrl("/files"), {
    method: "POST",
    body: form,
  }, 60000);
  if (!resp.ok) throw await readError(resp, `Upload failed: ${resp.status}`);
  const data = await resp.json() as { files?: UploadedWorkspaceFile[] };
  return data.files || [];
}

export async function stopActiveMessage(_channelId = "web"): Promise<void> {
  return undefined;
}

export function currentScopePayload(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const payload: Record<string, string> = {};
  for (const [queryKey, bodyKey] of [
    ["scope", "scope"],
    ["channel", "channelId"],
    ["session", "sessionId"],
  ] as const) {
    const value = params.get(queryKey)?.trim();
    if (value) payload[bodyKey] = value;
  }
  return payload;
}
