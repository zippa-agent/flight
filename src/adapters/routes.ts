import type { Context } from "hono";
import type { Env } from "../env";
import { normalizeEmailEvent, type EmailPayload } from "./email";
import { normalizeFlightEvent } from "./flight";
import { fetchAgentRuntimeRecord } from "../platform/supabase";
import { jsonError, requireBearer } from "../shared/http";
import { submitDetachedTurn } from "../turns/submit";
import { isRecord } from "./types";

type AppContext = Context<{ Bindings: Env }>;

export async function handleEmailWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);

  let payload: EmailPayload;
  try {
    payload = await c.req.json() as EmailPayload;
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  const record = await fetchAgentRuntimeRecord(agentId, c.env);
  if (!record || record.runtime !== "flight" || record.enabled === false) {
    return jsonError("Flight agent not found.", 404);
  }
  if (!record.tools_token) return jsonError("Agent tools token is not configured.", 500);

  try {
    const event = normalizeEmailEvent({
      agentId,
      payload,
      toolsToken: record.tools_token,
    });
    const receipt = await submitDetachedTurn(c, event, { detachedMode: "inline" });
    return c.json({
      ok: true,
      runtime: "flight",
      adapter: "email",
      agentId,
      ...receipt,
    }, 202);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function handleFlightWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  const record = await fetchAgentRuntimeRecord(agentId, c.env);
  if (!record || record.runtime !== "flight" || record.enabled === false) {
    return jsonError("Flight agent not found.", 404);
  }

  try {
    const event = normalizeFlightEvent(body, { agentId });
    const receipt = await submitDetachedTurn(c, event, {
      allowFullBash: requestedFullBash(body),
    });
    return c.json({
      ok: true,
      runtime: "flight",
      adapter: event.adapter,
      agentId,
      ...receipt,
    }, 202);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

function requestedFullBash(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const tools = isRecord(body.tools) ? body.tools : {};
  return body.allowFullBash === true || tools.full_bash === true || tools.fullBash === true;
}
