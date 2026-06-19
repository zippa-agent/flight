import type { Context } from "hono";
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
import { promptWithTurnContext, storeTurnContext } from "./context";
import { postDirectPrompt, readAgentStream, sseHeaders } from "./flue-client";
import { flueEventToAwarenessEntry, flueEventToUiEvents, isTerminalFlueEvent, terminalUiEvent } from "./stream";

type AppContext = Context<{ Bindings: Env }>;
const MAX_TURN_CONTEXT_BLOCK_CHARS = 4_000;

export interface SubmitOptions {
  allowFullBash?: boolean;
  detachedMode?: "waitUntil" | "inline";
  inlineMirrorTimeoutMs?: number;
  tolerateMirrorErrors?: boolean;
}

export type DetachedMirrorStatus =
  | { status: "completed" }
  | { status: "timed_out" }
  | { status: "failed"; error: string };

export async function submitDirectWebTurn(
  c: AppContext,
  event: InboundEvent,
  options: SubmitOptions = {},
): Promise<Response> {
  const instanceId = flightInstanceId(event);
  const awarenessTail = await fetchAwarenessEntries(c.env, instanceId, { limit: 60 }).then((page) => page.entries);
  await appendInbound(c.env, instanceId, event);
  const turn = buildTurnPayload(event, awarenessTail, options);
  const admission = await admitDirectTurn(c, instanceId, turn);

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

              if (isTerminalFlueEvent(flueEvent)) {
                send(terminalUiEvent());
                completed = true;
              }
            }
            return completed;
          });
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

export async function submitDetachedTurn(
  c: AppContext,
  event: InboundEvent,
  options: SubmitOptions = {},
): Promise<{
  submissionId: string;
  streamUrl: string;
  offset: string;
  acceptedAt: string;
  instanceId: string;
  mirrorStatus?: DetachedMirrorStatus;
}> {
  const instanceId = flightInstanceId(event);
  const awarenessTail = await fetchAwarenessEntries(c.env, instanceId, { limit: 60 }).then((page) => page.entries);
  await appendInbound(c.env, instanceId, event);
  const turn = buildTurnPayload(event, awarenessTail, options);
  const admission = await admitDirectTurn(c, instanceId, turn);

  let mirrorStatus: DetachedMirrorStatus | undefined;
  if (options.detachedMode === "inline") {
    const mirrorPromise = mirrorTurnStreamToAwareness(c, event, admission);
    mirrorStatus = await settleDetachedMirror({
      promise: mirrorPromise,
      timeoutMs: options.inlineMirrorTimeoutMs,
      tolerateErrors: options.tolerateMirrorErrors,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      onError: (error) => {
        console.warn("Flight detached turn stream mirror failed:", error);
      },
    });
  } else {
    c.executionCtx.waitUntil(mirrorTurnStreamToAwareness(c, event, admission).catch((error) => {
      console.warn("Flight detached turn stream mirror failed:", error);
    }));
  }

  return {
    ...admission,
    acceptedAt: new Date().toISOString(),
    instanceId,
    ...(mirrorStatus ? { mirrorStatus } : {}),
  };
}

export async function settleDetachedMirror(input: {
  promise: Promise<void>;
  timeoutMs?: number;
  tolerateErrors?: boolean;
  waitUntil?: (promise: Promise<void>) => void;
  onError?: (error: unknown) => void;
}): Promise<DetachedMirrorStatus> {
  const observed = input.promise.then(
    () => ({ status: "completed" as const }),
    (error) => ({ status: "failed" as const, error }),
  );

  const result = input.timeoutMs && input.timeoutMs > 0
    ? await Promise.race([observed, mirrorTimeout(input.timeoutMs)])
    : await observed;

  if (result.status === "timed_out") {
    input.waitUntil?.(input.promise.catch((error) => {
      input.onError?.(error);
    }));
    return result;
  }

  if (result.status === "failed") {
    if (!input.tolerateErrors) throw result.error;
    input.onError?.(result.error);
    return { status: "failed", error: errorMessage(result.error) };
  }

  return result;
}

function mirrorTimeout(timeoutMs: number): Promise<{ status: "timed_out" }> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function admitDirectTurn(
  c: AppContext,
  instanceId: string,
  turn: FlightTurnPayload,
) {
  const contextId = await storeTurnContext({ env: c.env, instanceId, turn });
  return postDirectPrompt(c, instanceId, promptWithTurnContext({
    contextId,
    prompt: turn.prompt,
  }));
}

async function mirrorTurnStreamToAwareness(
  c: AppContext,
  event: InboundEvent,
  admission: { streamUrl: string; offset: string; submissionId: string },
): Promise<void> {
  const instanceId = flightInstanceId(event);
  await readAgentStream(c, admission, async (events) => {
    let completed = false;
    for (const flueEvent of events) {
      if (flueEvent?.submissionId && flueEvent.submissionId !== admission.submissionId) continue;

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
}

function buildTurnPayload(
  event: InboundEvent,
  awarenessTail: AwarenessEntry[],
  options: SubmitOptions,
): FlightTurnPayload {
  const toolPolicy = {
    allowSendMessage: event.deliveryMode === "messages-only" && !!event.replyTarget,
    allowFullBash: Boolean(options.allowFullBash),
    allowYieldNoAction: event.context?.slackDirectlyAddressed === false,
  };
  const prompt = buildTurnPrompt({ event, awarenessTail });
  return {
    version: "flight.turn.v1",
    event,
    awarenessTail: compactAwarenessTail(awarenessTail),
    prompt,
    toolPolicy,
  };
}

function compactAwarenessTail(entries: AwarenessEntry[]): AwarenessEntry[] {
  return entries.slice(-40).map((entry) => ({
    ...entry,
    content: entry.content?.map((block) => {
      if (block.type === "text") return { ...block, text: clipText(block.text, MAX_TURN_CONTEXT_BLOCK_CHARS) };
      if (block.type === "thinking") return { ...block, thinking: clipText(block.thinking, MAX_TURN_CONTEXT_BLOCK_CHARS) };
      if (block.type === "toolCall") {
        const args = JSON.stringify(block.arguments);
        return args.length > MAX_TURN_CONTEXT_BLOCK_CHARS
          ? { ...block, arguments: { truncated: clipText(args, MAX_TURN_CONTEXT_BLOCK_CHARS) } }
          : block;
      }
      if (block.type === "toolResult") return { ...block, result: clipText(block.result, MAX_TURN_CONTEXT_BLOCK_CHARS) };
      return block;
    }),
  }));
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

async function appendInbound(env: Env, instanceId: string, event: InboundEvent): Promise<void> {
  const entry = userAwarenessEntry({
    id: `inbound-${event.delivery.id}`,
    timestamp: event.delivery.receivedAt,
    adapter: event.adapter,
    channel: event.scope.channelId || event.scope.id,
    userName: event.actor.displayName || event.actor.email || event.actor.id,
    text: event.message.text,
    modelText: event.message.modelText,
    deliveryId: event.delivery.id,
  });
  await appendAwarenessEntry(env, instanceId, entry);
}
