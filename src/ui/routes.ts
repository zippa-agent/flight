import type { Context } from "hono";
import type { Env } from "../env";
import { instanceIdForScope } from "../awareness/id";
import { fetchAwarenessEntries, streamAwarenessEntries } from "../awareness/store";
import { parseEmailThreadTarget, readEmailThreadById, collectEmailThreadListings } from "../adapters/email/thread-ledger";
import { parsePhoneThreadTarget, readPhoneThreadByTarget, collectPhoneThreadListings } from "../adapters/phone/thread-ledger";
import { normalizeWebEvent, webScopeFromQuery } from "../adapters/web";
import { readListenerThreadStates } from "../listener/store";
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

export async function handleUiListenerShell(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return c.html(listenerShellHtml(auth.agent.name, agentId));
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

export async function handleUiListenerThreads(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;

  const url = new URL(c.req.url);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 100);
  const filter = url.searchParams.get("filter") || "all";
  const [emailThreads, phoneThreads, states] = await Promise.all([
    collectEmailThreadListings(c.env, agentId, limit),
    collectPhoneThreadListings(c.env, agentId, limit),
    readListenerThreadStates(c.env, agentId),
  ]);
  const threads = [
    ...emailThreads.map((thread) => ({
      adapter: "email",
      target: thread.sendTarget,
      title: thread.subject,
      lastPreview: thread.lastPreview,
      participants: thread.participants,
      messageCount: thread.messageCount,
      lastSeen: thread.lastSeen,
      read: states[thread.sendTarget]?.read ?? true,
      source: thread.source,
    })),
    ...phoneThreads.map((thread) => ({
      adapter: "phone",
      target: thread.sendTarget,
      title: thread.displayName,
      lastPreview: thread.lastPreview,
      participants: thread.participants,
      messageCount: thread.messageCount,
      lastSeen: thread.lastSeen,
      read: states[thread.sendTarget]?.read ?? true,
      source: thread.source,
      transport: thread.transport,
    })),
  ]
    .filter((thread) => filter === "unread" ? !thread.read : filter === "read" ? thread.read : true)
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, limit);

  return c.json({
    ok: true,
    runtime: "flight",
    agentId,
    threads,
  });
}

export async function handleUiListenerThread(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);
  const auth = await requireFlightAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;

  const url = new URL(c.req.url);
  const target = url.searchParams.get("target") || "";
  const limit = parsePositiveInt(url.searchParams.get("limit"), 80, 200);
  const states = await readListenerThreadStates(c.env, agentId);

  const emailTarget = parseEmailThreadTarget(target);
  if (emailTarget) {
    const records = await readEmailThreadById(c.env, agentId, emailTarget.threadId, limit);
    return c.json({
      ok: true,
      runtime: "flight",
      agentId,
      target: emailTarget.inputTarget,
      adapter: "email",
      read: states[emailTarget.inputTarget]?.read ?? true,
      records,
    });
  }

  const phoneTarget = parsePhoneThreadTarget(target);
  if (phoneTarget) {
    const records = await readPhoneThreadByTarget(c.env, agentId, phoneTarget, limit);
    return c.json({
      ok: true,
      runtime: "flight",
      agentId,
      target: phoneTarget.inputTarget,
      adapter: "phone",
      read: states[phoneTarget.inputTarget]?.read ?? true,
      records,
    });
  }

  return jsonError("Expected target=email-thread:<id> or target=phone-...", 400);
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

function listenerShellHtml(agentName: string, agentId: string): string {
  const safeTitle = escapeHtml(`${agentName || "Flight"} Listener`);
  const safeAgentId = escapeHtml(agentId);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f6f7f9; color: #111827; }
      .shell { min-height: 100vh; display: grid; grid-template-columns: minmax(280px, 380px) 1fr; }
      .sidebar { border-right: 1px solid #d8dde6; background: #fff; display: flex; flex-direction: column; min-width: 0; }
      .main { min-width: 0; display: flex; flex-direction: column; }
      header { padding: 16px 18px; border-bottom: 1px solid #d8dde6; display: flex; gap: 12px; align-items: center; justify-content: space-between; }
      h1 { font-size: 18px; line-height: 1.2; margin: 0; font-weight: 700; }
      .filters { display: flex; gap: 6px; }
      button { border: 1px solid #c7ceda; background: #fff; color: #111827; border-radius: 6px; padding: 7px 10px; font: inherit; cursor: pointer; }
      button.active { background: #111827; color: #fff; border-color: #111827; }
      .threads { overflow: auto; }
      .thread { width: 100%; text-align: left; border: 0; border-bottom: 1px solid #edf0f4; border-radius: 0; padding: 12px 14px; background: #fff; display: grid; gap: 5px; }
      .thread:hover, .thread.selected { background: #f1f5f9; }
      .meta { display: flex; gap: 8px; align-items: center; color: #64748b; font-size: 12px; min-width: 0; }
      .badge { border-radius: 999px; padding: 2px 7px; background: #e5e7eb; color: #111827; font-weight: 650; }
      .badge.unread { background: #bfdbfe; color: #1e3a8a; }
      .title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .preview { color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .transcript { overflow: auto; padding: 18px; display: grid; gap: 12px; }
      .message { background: #fff; border: 1px solid #d8dde6; border-radius: 8px; padding: 13px 14px; max-width: 860px; }
      .message h2 { font-size: 13px; margin: 0 0 8px; color: #475569; font-weight: 650; }
      .message pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.45; }
      .empty { padding: 24px; color: #64748b; }
      @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .sidebar { min-height: 42vh; border-right: 0; border-bottom: 1px solid #d8dde6; } }
      @media (prefers-color-scheme: dark) {
        body { background: #0f172a; color: #e5e7eb; }
        .sidebar, .thread, .message, button { background: #111827; color: #e5e7eb; }
        header, .sidebar, .thread, .message { border-color: #293445; }
        .thread:hover, .thread.selected { background: #1f2937; }
        button { border-color: #374151; }
        button.active { background: #e5e7eb; color: #111827; }
        .preview, .meta, .empty, .message h2 { color: #9ca3af; }
        .badge { background: #374151; color: #e5e7eb; }
        .badge.unread { background: #1d4ed8; color: #dbeafe; }
      }
    </style>
  </head>
  <body>
    <div class="shell" data-agent-id="${safeAgentId}">
      <aside class="sidebar">
        <header>
          <h1>${safeTitle}</h1>
          <div class="filters">
            <button data-filter="all" class="active">All</button>
            <button data-filter="unread">Unread</button>
            <button data-filter="read">Read</button>
          </div>
        </header>
        <div id="threads" class="threads"><div class="empty">Loading threads...</div></div>
      </aside>
      <main class="main">
        <header><h1 id="thread-title">Select a thread</h1></header>
        <section id="transcript" class="transcript"><div class="empty">Captured email and phone threads appear here.</div></section>
      </main>
    </div>
    <script>
      const agentId = document.querySelector('.shell').dataset.agentId;
      let filter = 'all';
      let selected = '';
      const threadsEl = document.getElementById('threads');
      const transcriptEl = document.getElementById('transcript');
      const titleEl = document.getElementById('thread-title');
      const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      for (const button of document.querySelectorAll('[data-filter]')) {
        button.addEventListener('click', () => {
          filter = button.dataset.filter;
          document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
          loadThreads();
        });
      }
      async function loadThreads() {
        threadsEl.innerHTML = '<div class="empty">Loading threads...</div>';
        const response = await fetch('/api/agents/' + encodeURIComponent(agentId) + '/listener/threads?filter=' + encodeURIComponent(filter));
        const data = await response.json();
        const threads = data.threads || [];
        if (!threads.length) {
          threadsEl.innerHTML = '<div class="empty">No ' + esc(filter === 'all' ? '' : filter + ' ') + 'threads yet.</div>';
          return;
        }
        threadsEl.innerHTML = threads.map((thread) => '<button class="thread ' + (thread.target === selected ? 'selected' : '') + '" data-target="' + esc(thread.target) + '">'
          + '<div class="meta"><span class="badge ' + (thread.read ? '' : 'unread') + '">' + (thread.read ? 'read' : 'unread') + '</span><span>' + esc(thread.adapter) + '</span><span>' + esc(thread.lastSeen || '') + '</span></div>'
          + '<div class="title">' + esc(thread.title || thread.target) + '</div>'
          + '<div class="preview">' + esc(thread.lastPreview || '') + '</div>'
          + '</button>').join('');
        threadsEl.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => loadThread(button.dataset.target)));
      }
      async function loadThread(target) {
        selected = target;
        titleEl.textContent = target;
        transcriptEl.innerHTML = '<div class="empty">Loading transcript...</div>';
        const response = await fetch('/api/agents/' + encodeURIComponent(agentId) + '/listener/thread?target=' + encodeURIComponent(target));
        const data = await response.json();
        if (!response.ok) {
          transcriptEl.innerHTML = '<div class="empty">' + esc(data.error || 'Unable to load thread.') + '</div>';
          return;
        }
        const records = data.records || [];
        if (!records.length) {
          transcriptEl.innerHTML = '<div class="empty">No captured messages for this target.</div>';
          return;
        }
        transcriptEl.innerHTML = records.map((record) => '<article class="message">'
          + '<h2>' + esc(record.at || '') + ' - ' + esc(record.from || record.userName || record.userId || 'unknown sender') + '</h2>'
          + '<pre>' + esc(record.body || '') + '</pre>'
          + '</article>').join('');
        await loadThreads();
      }
      loadThreads();
    </script>
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
