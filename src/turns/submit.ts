import { dispatch } from "@flue/runtime";
import type { Context } from "hono";
import tinyfatAgent from "../agents/tinyfat";
import type { FlightTurnPayload, InboundEvent } from "../adapters/types";
import { flightInstanceId } from "../awareness/id";
import {
  appendAwarenessEntry,
  fetchAwarenessEntries,
  userAwarenessEntry,
  type AwarenessEntry,
} from "../awareness/store";
import type { Env } from "../env";
import { buildTurnPrompt } from "../agent/prompt";
import { postDirectPrompt, readAgentStream, sseHeaders } from "./flue-client";
import { flueEventToAwarenessEntry, flueEventToUiEvents, isTerminalFlueEvent } from "./stream";

type AppContext = Context<{ Bindings: Env }>;

export interface SubmitOptions {
  allowFullBash?: boolean;
}

export async function submitDirectWebTurn(
  c: AppContext,
  event: InboundEvent,
  options: SubmitOptions = {},
): Promise<Response> {
  const instanceId = flightInstanceId(event);
  const awarenessTail = await fetchAwarenessEntries(c.env, instanceId, { limit: 60 }).then((page) => page.entries);
  await appendInbound(c.env, instanceId, event);
  const turn = buildTurnPayload(event, awarenessTail, options);
  const admission = await postDirectPrompt(c, instanceId, turn.prompt);

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      void (async () => {
        try {
          send({ type: "status", status: "accepted", submissionId: admission.submissionId });
          await readAgentStream(c, admission, async (events) => {
            let completed = false;
            for (const flueEvent of events) {
              if (flueEvent?.submissionId && flueEvent.submissionId !== admission.submissionId) continue;

              for (const uiEvent of flueEventToUiEvents(flueEvent)) send(uiEvent);

              const entry = flueEventToAwarenessEntry({
                event: flueEvent,
                adapter: event.adapter,
                channel: event.scope.channelId || event.scope.id,
                submissionId: admission.submissionId,
              });
              if (entry) {
                await appendAwarenessEntry(c.env, instanceId, entry).catch((error) => {
                  console.warn("Flight awareness append failed:", error);
                });
              }

              if (isTerminalFlueEvent(flueEvent)) completed = true;
            }
            return completed;
          });
          send({ type: "done" });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
  }), { headers: sseHeaders() });
}

export async function dispatchTurn(
  env: Env,
  event: InboundEvent,
  options: SubmitOptions = {},
): Promise<{ dispatchId: string; acceptedAt: string; instanceId: string }> {
  const instanceId = flightInstanceId(event);
  const awarenessTail = await fetchAwarenessEntries(env, instanceId, { limit: 60 }).then((page) => page.entries);
  await appendInbound(env, instanceId, event);
  const turn = buildTurnPayload(event, awarenessTail, options);
  const receipt = await dispatch(tinyfatAgent, {
    id: instanceId,
    input: turn,
  });
  return { ...receipt, instanceId };
}

function buildTurnPayload(
  event: InboundEvent,
  awarenessTail: AwarenessEntry[],
  options: SubmitOptions,
): FlightTurnPayload {
  const toolPolicy = {
    allowSendMessage: event.deliveryMode === "messages-only" && !!event.replyTarget,
    allowFullBash: Boolean(options.allowFullBash),
  };
  const prompt = buildTurnPrompt({ event, awarenessTail });
  return {
    version: "flight.turn.v1",
    event,
    awarenessTail,
    prompt,
    toolPolicy,
  };
}

async function appendInbound(env: Env, instanceId: string, event: InboundEvent): Promise<void> {
  const entry = userAwarenessEntry({
    id: `inbound-${event.delivery.id}`,
    timestamp: event.delivery.receivedAt,
    adapter: event.adapter,
    channel: event.scope.channelId || event.scope.id,
    userName: event.actor.displayName || event.actor.email || event.actor.id,
    text: event.message.text,
    deliveryId: event.delivery.id,
  });
  await appendAwarenessEntry(env, instanceId, entry);
}
