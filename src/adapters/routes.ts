import type { Context } from "hono";
import type { Env } from "../env";
import { cleanEmailBody, normalizeEmailAddress, normalizeEmailEvent, type EmailPayload } from "./email";
import { persistEmailAttachments, withWorkspaceAttachmentPaths } from "./email/attachments";
import { appendEmailThreadEvent, readRelatedEmailThreadForEvent } from "./email/thread-ledger";
import { normalizeFlightEvent } from "./flight";
import { fetchAgentRuntimeRecord } from "../platform/supabase";
import { jsonError, requireBearer } from "../shared/http";
import { submitDetachedTurn } from "../turns/submit";
import { isRecord } from "./types";

type AppContext = Context<{ Bindings: Env }>;
const EMAIL_INLINE_MIRROR_TIMEOUT_MS = 50_000;

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
    const receivedAt = new Date();
    const storedAttachments = await persistEmailAttachments({
      env: c.env,
      agentId,
      payload,
      receivedAt,
    });
    payload = withWorkspaceAttachmentPaths(payload, storedAttachments);
    const from = normalizeEmailAddress(payload.from);
    const channelId = `email:${from || payload.from}`;
    const threadRecords = await readRelatedEmailThreadForEvent(c.env, agentId, {
      channelId,
      subject: payload.subject,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    });
    const event = normalizeEmailEvent({
      agentId,
      payload,
      toolsToken: record.tools_token,
      threadRecords,
      now: receivedAt,
    });
    await appendEmailThreadEvent(c.env, agentId, {
      type: "inbound",
      at: event.delivery.receivedAt,
      channelId: event.scope.channelId || channelId,
      from: event.actor.email || payload.from,
      to: [payload.to],
      subject: payload.subject,
      body: cleanEmailBody(payload),
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    }).catch((error) => {
      console.warn("Flight email thread ledger inbound append failed:", error);
    });
    const receipt = await submitDetachedTurn(c, event, {
      detachedMode: "inline",
      inlineMirrorTimeoutMs: EMAIL_INLINE_MIRROR_TIMEOUT_MS,
      tolerateMirrorErrors: true,
    });
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
