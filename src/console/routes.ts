import type { Context } from "hono";
import type { Env } from "../env";
import { jsonError } from "../shared/http";
import { fetchConsoleHistory, postAgentMessage, streamConsoleHistory, streamConsoleMessage } from "./stream";
import { flightInstanceId, normalizeFlightWebhook } from "../webhooks/flight-input";
import { requireConsoleAgent } from "../platform/supabase";

type AppContext = Context<{ Bindings: Env }>;

const UI_SCRIPT = "index-CwoJ3r9l.js";
const UI_STYLES = "index-DvKbFLU-.css";
const DEFAULT_CRAW_DAD_ASSET_BASE = "https://crawdad-cf.alexgarcia042.workers.dev";

export async function handleConsoleShell(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return c.html(consoleHtml(auth.agent.name));
}

export async function handleConsoleAsset(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  const asset = c.req.param("asset");
  if (!agentId || !asset || !/^[a-zA-Z0-9_.-]+$/.test(asset)) {
    return new Response("Not found", { status: 404 });
  }
  const base = (c.env.CRAWDAD_ASSET_BASE || DEFAULT_CRAW_DAD_ASSET_BASE).replace(/\/+$/, "");
  const url = `${base}/agents/${encodeURIComponent(agentId)}/assets/${encodeURIComponent(asset)}`;
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", {
      status: 404,
      headers: { "X-TinyFat-Upstream-Status": String(upstream.status) },
    });
  }
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-TinyFat-Console-Frontend", "flight-proxy");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function handleConsoleStatus(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return c.json({
    agent_id: auth.agent.id,
    mode: "hosted",
    runtime: "flight",
    workspace_ready: true,
    display_mode: "terminal",
    agent_name: auth.agent.name,
    capabilities: {
      awareness: true,
      messages: true,
      terminal: false,
      desktop: false,
      files: false,
      calendar: false,
      display: false,
      voice: false,
    },
  });
}

export async function handleConsoleDescribe(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  const model = c.env.TINYFAT_MODEL?.trim() || "fireworks/accounts/fireworks/models/minimax-m2p7";
  return c.json({
    model,
    provider: model.split("/")[0] || "fireworks",
    thinking_level: "medium",
    thinking_level_accepted: ["off", "minimal", "low", "medium", "high", "xhigh"],
    models: [{
      provider: "fireworks",
      id: "accounts/fireworks/models/minimax-m2p7",
      name: "MiniMax-M2.7",
      api: "anthropic-messages",
    }],
    described_at: new Date().toISOString(),
  });
}

export async function handleConsoleEvents(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  const limit = parseLimit(c.req.query("limit"));
  const before = parseBefore(c.req.query("before"));
  const instanceId = webInstanceId(agentId);
  const history = await fetchConsoleHistory(c, instanceId, limit, before);
  return c.json(history);
}

export async function handleConsoleEventsStream(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return streamConsoleHistory(c, webInstanceId(agentId));
}

export async function handleConsoleMessage(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    const parsed = await c.req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return jsonError("Expected JSON body", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return jsonError("Missing message", 400);

  const input = normalizeFlightWebhook({
    surface: "web",
    provider: "web",
    scope: webScope(body),
    actor: {
      id: auth.user.id,
      email: auth.user.email,
      displayName: auth.user.email || "user",
    },
    message: { text: message },
    delivery: {
      id: crypto.randomUUID(),
      provider: "web",
      receivedAt: new Date().toISOString(),
    },
    context: typeof body.project === "object" && body.project !== null ? { project: body.project } : undefined,
  }, { agentId });

  const channel = input.scope.kind === "agent" ? "web" : input.scope.id;
  const user = input.actor.email || input.actor.displayName || input.actor.id;
  const prompt = `[${input.delivery.receivedAt}] [${channel}] [${user}]: ${input.message.text}`;
  const admission = await postAgentMessage(c, {
    agentId,
    instanceId: flightInstanceId(input),
    message: prompt,
  });
  return streamConsoleMessage(c, admission);
}

export async function handleConsoleStop(c: AppContext): Promise<Response> {
  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);
  const auth = await requireConsoleAgent(c.req.raw, c.env, agentId);
  if (auth instanceof Response) return auth;
  return c.json({ ok: true, stopped: false });
}

function consoleHtml(agentName: string): string {
  const safeTitle = escapeHtml(agentName || "Flight");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <title>${safeTitle}</title>
    <link rel="icon" href="data:image/svg+xml,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'&gt;&lt;text y='.9em' font-size='90'&gt;F&lt;/text&gt;&lt;/svg&gt;" />
    <script>
      (function() {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('tf_host_tools')) {
          url.searchParams.set('tf_host_tools', '0');
          window.history.replaceState(null, '', url.toString());
        }
        const saved = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
    <script type="module" crossorigin src="./assets/${UI_SCRIPT}"></script>
    <link rel="stylesheet" crossorigin href="./assets/${UI_STYLES}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

function webInstanceId(agentId: string): string {
  return flightInstanceId({
    agentId,
    scope: {
      kind: "agent",
      id: "web",
      parentAgentId: agentId,
    },
  });
}

function webScope(body: Record<string, unknown>): Record<string, unknown> {
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (channelId && channelId !== "web") {
    return { kind: "channel", id: channelId, channelId };
  }
  if (sessionId) {
    return { kind: "relationship", id: sessionId };
  }
  return { kind: "agent", id: "web" };
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value || "50", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function parseBefore(value: string | undefined): number | undefined {
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
