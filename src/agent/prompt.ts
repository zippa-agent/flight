import type { FlightTurnPayload, InboundEvent } from "../adapters/types";
import type { AwarenessEntry } from "../awareness/store";
import { describeInstanceScope } from "../awareness/id";
import { contractText, type ToolPolicy } from "./contract";

const MAX_AWARENESS_BLOCK_CHARS = 2_000;
const MAX_AWARENESS_TAIL_CHARS = 30_000;

export function buildAgentInstructions(input: {
  instanceId: string;
  turn: FlightTurnPayload | null;
  policy: ToolPolicy;
  baseInstructions: string;
}): string {
  const parts = [
    input.baseInstructions.trim(),
    describeInstanceScope(input.instanceId),
    contractText(input.policy),
  ];

  if (input.turn) {
    parts.push(activeAdapterInstructions(input.turn.event));
  }

  return parts.filter(Boolean).join("\n\n");
}

export function buildTurnPrompt(input: {
  event: InboundEvent;
  awarenessTail: AwarenessEntry[];
}): string {
  const actor = [
    input.event.actor.displayName || input.event.actor.username || input.event.actor.id,
    input.event.actor.email ? `<${input.event.actor.email}>` : "",
    input.event.actor.phone ? `<${input.event.actor.phone}>` : "",
  ].filter(Boolean).join(" ");

  return [
    "[Flight inbound turn]",
    `Adapter: ${input.event.adapter}`,
    `Delivery mode: ${input.event.deliveryMode}`,
    `Provider: ${input.event.delivery.provider}`,
    `TinyFat agent: ${input.event.agentId}`,
    `Scope: ${input.event.scope.kind}:${input.event.scope.id}`,
    input.event.scope.label ? `Scope label: ${input.event.scope.label}` : "",
    input.event.scope.channelId ? `Channel: ${input.event.scope.channelId}` : "",
    input.event.scope.threadId ? `Thread: ${input.event.scope.threadId}` : "",
    `Actor: ${actor}`,
    input.event.message.subject ? `Subject: ${input.event.message.subject}` : "",
    ...((input.event.scope.instructions || []).map((line) => `Scope instruction: ${line}`)),
    "",
    "Adapter delivery instructions:",
    ...input.event.formatInstructions.map((line) => `- ${line}`),
    "",
    "Recent scoped awareness:",
    renderAwarenessTail(input.awarenessTail),
    "",
    "Current inbound message:",
    input.event.message.text,
  ].filter((line) => line !== "").join("\n");
}

function activeAdapterInstructions(event: InboundEvent): string {
  return [
    "Active adapter contract:",
    `- Adapter: ${event.adapter}`,
    `- Delivery mode: ${event.deliveryMode}`,
    ...(event.scope.instructions || []).map((line) => `- Scope: ${line}`),
    ...event.formatInstructions.map((line) => `- ${line}`),
  ].join("\n");
}

function renderAwarenessTail(entries: AwarenessEntry[]): string {
  if (entries.length === 0) return "(none yet)";
  const rendered = entries.slice(-40).map((entry) => {
    const text = (entry.content || []).map((block) => {
      if (block.type === "text") return clipText(block.text, MAX_AWARENESS_BLOCK_CHARS);
      if (block.type === "thinking") return `[thinking] ${clipText(block.thinking, MAX_AWARENESS_BLOCK_CHARS)}`;
      if (block.type === "toolCall") return `[tool_call ${block.name}] ${clipText(JSON.stringify(block.arguments), MAX_AWARENESS_BLOCK_CHARS)}`;
      if (block.type === "toolResult") return `[tool_result ${block.toolCallId}] ${clipText(block.result, MAX_AWARENESS_BLOCK_CHARS)}`;
      return "";
    }).filter(Boolean).join("\n");
    const role = entry.role || entry.type;
    const channel = entry.channel || entry.adapter;
    return `[${entry.timestamp}] [${channel}] [${role}] ${text}`;
  }).join("\n");
  return clipText(rendered, MAX_AWARENESS_TAIL_CHARS);
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
