import type { Env } from "../env";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface FlightAgentRecord {
  id: string;
  name: string;
  runtime: string | null;
  enabled: boolean | null;
  user_id: string;
  tools_token?: string | null;
}

interface SessionTokens {
  access_token: string;
  refresh_token?: string;
}

function supabaseUrl(env: Env): string {
  const value = env.SUPABASE_URL?.trim();
  if (!value) throw new Error("SUPABASE_URL is not configured");
  return value.replace(/\/+$/g, "");
}

function supabaseServiceKey(env: Env): string {
  const value = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return value;
}

function supabaseAnonKey(env: Env): string {
  const value = env.SUPABASE_ANON_KEY?.trim() || env.PUBLIC_SUPABASE_ANON_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_ANON_KEY is not configured");
  return value;
}

function projectRef(env: Env): string | null {
  try {
    return new URL(supabaseUrl(env)).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function readPossiblyChunkedCookie(cookies: Map<string, string>, name: string): string | null {
  const exact = cookies.get(name);
  if (exact) return exact;

  const chunks = Array.from(cookies.entries())
    .map(([chunkName, value]) => {
      const match = chunkName.match(new RegExp(`^${escapeRegExp(name)}\\.(\\d+)$`));
      return match ? { index: Number(match[1]), value } : null;
    })
    .filter((chunk): chunk is { index: number; value: string } => !!chunk)
    .sort((a, b) => a.index - b.index);

  return chunks.length ? chunks.map((chunk) => chunk.value).join("") : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSessionCookie(rawValue: string | null): SessionTokens | null {
  if (!rawValue) return null;
  try {
    let decoded = decodeURIComponent(rawValue);
    if (decoded.startsWith("base64-")) {
      decoded = atob(decoded.slice("base64-".length));
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const accessToken = typeof record.access_token === "string" ? record.access_token : "";
      if (!accessToken) return null;
      return {
        access_token: accessToken,
        refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
      };
    }
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return {
        access_token: parsed[0],
        refresh_token: typeof parsed[1] === "string" ? parsed[1] : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function sessionTokensFromRequest(request: Request, env: Env): SessionTokens | null {
  const ref = projectRef(env);
  if (!ref) return null;
  const cookieName = `sb-${ref}-auth-token`;
  const cookies = parseCookies(request.headers.get("cookie"));
  return parseSessionCookie(readPossiblyChunkedCookie(cookies, cookieName));
}

async function validateAccessToken(accessToken: string, env: Env): Promise<AuthenticatedUser | null> {
  const response = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey(env),
    },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null) as { id?: unknown; email?: unknown } | null;
  return typeof user?.id === "string"
    ? { id: user.id, email: typeof user.email === "string" ? user.email : undefined }
    : null;
}

async function refreshSession(refreshToken: string, env: Env): Promise<AuthenticatedUser | null> {
  const response = await fetch(`${supabaseUrl(env)}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey(env),
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as {
    user?: { id?: unknown; email?: unknown };
  } | null;
  return typeof data?.user?.id === "string"
    ? { id: data.user.id, email: typeof data.user.email === "string" ? data.user.email : undefined }
    : null;
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const tokens = sessionTokensFromRequest(request, env);
  if (!tokens) return null;

  const user = await validateAccessToken(tokens.access_token, env);
  if (user) return user;

  return tokens.refresh_token ? refreshSession(tokens.refresh_token, env) : null;
}

export async function fetchFlightAgentForUser(
  agentId: string,
  userId: string,
  env: Env,
): Promise<FlightAgentRecord | null> {
  const rows = await supabaseRest<FlightAgentRecord>(
    env,
    `agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,runtime,enabled,user_id,tools_token&limit=1`,
  );
  const agent = rows[0] || null;
  if (!agent) return null;
  if ((agent.runtime || "troublemaker") !== "flight") return null;
  if (agent.enabled === false) return null;
  return agent;
}

export async function fetchAgentRuntimeRecord(agentId: string, env: Env): Promise<FlightAgentRecord | null> {
  const rows = await supabaseRest<FlightAgentRecord>(
    env,
    `agents?id=eq.${encodeURIComponent(agentId)}&select=id,name,runtime,enabled,user_id,tools_token&limit=1`,
  );
  return rows[0] || null;
}

export async function requireConsoleAgent(request: Request, env: Env, agentId: string): Promise<{
  user: AuthenticatedUser;
  agent: FlightAgentRecord;
} | Response> {
  let user: AuthenticatedUser | null = null;
  try {
    user = await authenticateRequest(request, env);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Authentication failed" }, { status: 500 });
  }
  if (!user) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const agent = await fetchFlightAgentForUser(agentId, user.id, env);
  if (!agent) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return { user, agent };
}

export async function supabaseRest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T[]> {
  const response = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseServiceKey(env),
      Authorization: `Bearer ${supabaseServiceKey(env)}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase REST ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T[]>;
}
