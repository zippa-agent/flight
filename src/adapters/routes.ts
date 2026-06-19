import type { Context } from "hono";
import type { Env } from "../env";
import { cleanEmailBody, normalizeEmailAddress, normalizeEmailEvent, type EmailPayload } from "./email";
import { persistEmailAttachments, withWorkspaceAttachmentPaths } from "./email/attachments";
import { appendEmailThreadEvent, readRelatedEmailThreadForEvent } from "./email/thread-ledger";
import { normalizeFlightEvent } from "./flight";
import { resolvePromptOnDelivery } from "./listener-policy";
import { normalizePhoneEvent, normalizePhonePayload, phoneLedgerEventFromPayload, type PhoneInboundPayload } from "./phone";
import { appendPhoneThreadEvent } from "./phone/thread-ledger";
import { normalizeSlackEvent, type SlackBridgePayload } from "./slack";
import { appendSlackThreadEvent } from "./slack/thread-ledger";
import { fetchAgentRuntimeRecord } from "../platform/supabase";
import { jsonError, requireBearer } from "../shared/http";
import { noteListenerInboundThread } from "../listener/store";
import { submitDetachedTurn } from "../turns/submit";
import { isRecord } from "./types";

type AppContext = Context<{ Bindings: Env }>;
const EMAIL_INLINE_MIRROR_TIMEOUT_MS = 50_000;
const SLACK_INLINE_MIRROR_TIMEOUT_MS = 50_000;
const PHONE_INLINE_MIRROR_TIMEOUT_MS = 50_000;

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
    const promptOnDelivery = resolvePromptOnDelivery({
      headers: c.req.raw.headers,
      body: payload,
      defaultValue: true,
    });
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

    const emailThreadTarget = event.replyTarget?.kind === "email"
      ? event.replyTarget.threadTarget || String(event.context?.emailThreadTarget || "")
      : String(event.context?.emailThreadTarget || "");
    await noteListenerInboundThread({
      env: c.env,
      agentId,
      target: emailThreadTarget,
      adapter: "email",
      at: event.delivery.receivedAt,
      eventId: event.delivery.id,
      label: payload.subject,
      lastPreview: cleanEmailBody(payload),
      participants: compactStrings([event.actor.email || payload.from, payload.to, ...(payload.allRecipients || [])]),
    }).catch((error) => {
      console.warn("Flight email listener state update failed:", error);
    });

    if (!promptOnDelivery) {
      return c.json({
        ok: true,
        runtime: "flight",
        adapter: "email",
        agentId,
        prompted: false,
      }, 202);
    }

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
      prompted: true,
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

export async function handleSlackWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);

  let payload: SlackBridgePayload;
  try {
    payload = await c.req.json() as SlackBridgePayload;
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  const record = await fetchAgentRuntimeRecord(agentId, c.env);
  if (!record || record.runtime !== "flight" || record.enabled === false) {
    return jsonError("Flight agent not found.", 404);
  }

  try {
    const promptOnDelivery = resolvePromptOnDelivery({
      headers: c.req.raw.headers,
      body: payload,
      defaultValue: true,
    });
    const normalized = normalizeSlackEvent({
      agentId,
      payload,
    });
    if (normalized.status === "skipped") {
      return c.json({
        ok: true,
        runtime: "flight",
        adapter: "slack",
        agentId,
        skipped: true,
        reason: normalized.reason,
      }, 202);
    }

    await appendSlackThreadEvent(c.env, agentId, {
      type: "inbound",
      at: normalized.event.delivery.receivedAt,
      channelId: normalized.slackEvent.channel,
      channelName: normalized.slackEvent.channelName,
      threadTs: normalized.slackEvent.threadTs,
      messageTs: normalized.slackEvent.messageTs,
      userId: normalized.slackEvent.userId,
      userName: normalized.slackEvent.userName,
      body: normalized.slackEvent.text || normalized.slackEvent.rawText,
      directlyAddressed: normalized.slackEvent.directlyAddressed,
      sourceEventType: normalized.slackEvent.sourceEventType,
    }).catch((error) => {
      console.warn("Flight Slack thread ledger inbound append failed:", error);
    });

    const slackThreadTarget = String(normalized.event.context?.slackThreadTarget || normalized.event.scope.channelId || normalized.event.scope.id);
    await noteListenerInboundThread({
      env: c.env,
      agentId,
      target: slackThreadTarget,
      adapter: "slack",
      at: normalized.event.delivery.receivedAt,
      eventId: normalized.event.delivery.id,
      label: normalized.slackEvent.channelName,
      lastPreview: normalized.slackEvent.text || normalized.slackEvent.rawText,
      participants: compactStrings([normalized.slackEvent.userName, normalized.slackEvent.userId]),
    }).catch((error) => {
      console.warn("Flight Slack listener state update failed:", error);
    });

    if (!promptOnDelivery) {
      return c.json({
        ok: true,
        runtime: "flight",
        adapter: "slack",
        agentId,
        prompted: false,
      }, 202);
    }

    const receipt = await submitDetachedTurn(c, normalized.event, {
      detachedMode: "inline",
      inlineMirrorTimeoutMs: SLACK_INLINE_MIRROR_TIMEOUT_MS,
      tolerateMirrorErrors: true,
    });
    return c.json({
      ok: true,
      runtime: "flight",
      adapter: "slack",
      agentId,
      prompted: true,
      ...receipt,
    }, 202);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

export async function handlePhoneWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id.", 400);

  let payload: PhoneInboundPayload;
  try {
    payload = await c.req.json() as PhoneInboundPayload;
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  const record = await fetchAgentRuntimeRecord(agentId, c.env);
  if (!record || record.runtime !== "flight" || record.enabled === false) {
    return jsonError("Flight agent not found.", 404);
  }

  try {
    const promptOnDelivery = resolvePromptOnDelivery({
      headers: c.req.raw.headers,
      body: payload,
      defaultValue: false,
    });
    const normalizedPayload = normalizePhonePayload(payload);
    const event = normalizePhoneEvent({
      agentId,
      payload: normalizedPayload,
    });
    const ledgerEvent = phoneLedgerEventFromPayload(normalizedPayload);
    const threadTarget = String(event.context?.phoneThreadTarget || event.scope.channelId || event.scope.id);

    await appendPhoneThreadEvent(c.env, agentId, ledgerEvent).catch((error) => {
      console.warn("Flight phone thread ledger inbound append failed:", error);
    });
    await noteListenerInboundThread({
      env: c.env,
      agentId,
      target: threadTarget,
      adapter: "phone",
      at: event.delivery.receivedAt,
      eventId: event.delivery.id,
      label: event.actor.displayName,
      lastPreview: normalizedPayload.text,
      participants: compactStrings([normalizedPayload.from, normalizedPayload.to, normalizedPayload.sender, ...(normalizedPayload.recipients || [])]),
    }).catch((error) => {
      console.warn("Flight phone listener state update failed:", error);
    });

    if (!promptOnDelivery) {
      return c.json({
        ok: true,
        runtime: "flight",
        adapter: "phone",
        agentId,
        prompted: false,
      }, 202);
    }

    const receipt = await submitDetachedTurn(c, event, {
      detachedMode: "inline",
      inlineMirrorTimeoutMs: PHONE_INLINE_MIRROR_TIMEOUT_MS,
      tolerateMirrorErrors: true,
    });
    return c.json({
      ok: true,
      runtime: "flight",
      adapter: "phone",
      agentId,
      prompted: true,
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

function compactStrings(values: Array<string | undefined | null>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}
