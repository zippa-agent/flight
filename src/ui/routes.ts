import type { Context } from "hono";
import type { Env } from "../env";
import { instanceIdForScope } from "../awareness/id";
import { fetchAwarenessEntries, streamAwarenessEntries } from "../awareness/store";
import { normalizeWebEvent, webScopeFromQuery } from "../adapters/web";
import { requireFlightAgent } from "../platform/supabase";
import { jsonError } from "../shared/http";
import { submitDirectWebTurn } from "../turns/submit";
import {
  normalizeWorkspaceDirectory,
  uniqueWorkspacePath,
  workspacePathInDirectory,
  writeWorkspaceFile,
} from "../workspace/files";
import { APP_CSS, APP_JS } from "./assets";

type AppContext = Context<{ Bindings: Env }>;

export async function handleUiShell(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return c.html(shellHtml(auth.agent.name));
}

export async function handleUiAsset(c: AppContext): Promise<Response> {
  const asset = c.req.param("asset");
  if (asset === "app.css") {
    return new Response(APP_CSS, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }
  if (asset === "app.js") {
    return new Response(APP_JS, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }
  return new Response("Not found.", { status: 404 });
}

export async function handleUiSession(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  const scope = webScopeFromQuery(agentId, new URL(c.req.url));
  return c.json({
    ok: true,
    runtime: "flight",
    agent: {
      id: auth.agent.id,
      name: auth.agent.name,
      runtime: auth.agent.runtime,
    },
    user: {
      id: auth.user.id,
      email: auth.user.email || null,
    },
    scope,
    instanceId: instanceIdForScope(agentId, scope),
    capabilities: {
      awareness: true,
      messages: true,
      directWebChat: true,
      emailSendMessageTool: true,
      fullBash: Boolean(c.env.CRAWDAD_API_BASE && c.env.CRAWDAD_API_TOKEN),
    },
  });
}

export async function handleUiAwareness(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  const url = new URL(c.req.url);
  const scope = webScopeFromQuery(agentId, url);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 80, 300);
  const before = parseOptionalPositiveInt(url.searchParams.get("before"));
  const page = await fetchAwarenessEntries(c.env, instanceIdForScope(agentId, scope), { limit, before });
  return c.json(page);
}

export async function handleUiAwarenessStream(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  const scope = webScopeFromQuery(agentId, new URL(c.req.url));
  return await streamAwarenessEntries(c.env, instanceIdForScope(agentId, scope))
    || new Response("Awareness store is not configured.", { status: 503 });
}

export async function handleUiMessage(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  try {
    const event = normalizeWebEvent({
      agentId,
      body,
      user: auth.user,
    });
    return await submitDirectWebTurn(c, event);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function handleUiFileUpload(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return jsonError("Expected multipart form data.", 400);
  }

  const rawPath = stringFormValue(form.get("path"));
  const directory = normalizeWorkspaceDirectory(rawPath);
  const fileEntries = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (fileEntries.length === 0) return jsonError("Upload requires at least one file.", 400);
  if (fileEntries.length > 8) return jsonError("Upload is limited to 8 files at a time.", 400);

  try {
    const used = new Set<string>();
    const files = [];
    for (const file of fileEntries) {
      const path = uniqueWorkspacePath(workspacePathInDirectory(directory, file.name || "upload"), used);
      const record = await writeWorkspaceFile({
        env: c.env,
        ownerId: agentId,
        path,
        content: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type || undefined,
      });
      files.push({
        path: record.path,
        size: record.size,
        contentType: record.contentType || null,
        name: file.name || record.path.split("/").pop() || "upload",
      });
    }

    return c.json({
      ok: true,
      runtime: "flight",
      files,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

function shellHtml(agentName: string): string {
  const safeTitle = escapeHtml(agentName || "Flight");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="./assets/app.css" />
    <script>
      (function() {
        const saved = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) document.documentElement.classList.add('dark');
      })();
    </script>
  </head>
  <body>
    <main id="root" data-agent-name="${safeTitle}"></main>
    <script type="module" src="./assets/app.js"></script>
  </body>
</html>`;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseOptionalPositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stringFormValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
