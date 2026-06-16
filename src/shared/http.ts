import type { Context } from "hono";
import type { Env } from "../env";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function requireBearer(c: Context<{ Bindings: Env }>, token?: string): Response | null {
  if (!token) return null;
  if (bearerToken(c.req.raw) === token) return null;
  return c.json({ ok: false, error: "unauthorized" }, 401);
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}
