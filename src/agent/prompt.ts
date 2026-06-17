import type { FlightTurnPayload, InboundEvent } from "../adapters/types";
import type { AwarenessEntry } from "../awareness/store";
import { describeInstanceScope } from "../awareness/id";
import { contractText, type ToolPolicy } from "./contract";

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
    ...event.formatInstructions.map((line) => `- ${line}`),
  ].join("\n");
}

function renderAwarenessTail(entries: AwarenessEntry[]): string {
  if (entries.length === 0) return "(none yet)";
  return entries.slice(-40).map((entry) => {
    const text = (entry.content || []).map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return `[thinking] ${block.thinking}`;
      if (block.type === "toolCall") return `[tool_call ${block.name}] ${JSON.stringify(block.arguments)}`;
      if (block.type === "toolResult") return `[tool_result ${block.toolCallId}] ${block.result}`;
      return "";
    }).filter(Boolean).join("\n");
    const role = entry.role || entry.type;
    const channel = entry.channel || entry.adapter;
    return `[${entry.timestamp}] [${channel}] [${role}] ${text}`;
  }).join("\n");
}
