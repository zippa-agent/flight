import type { AwarenessContent, AwarenessEntry } from "../awareness/store";

const MAX_TOOL_RESULT_CHARS = 20_000;

export function isTerminalFlueEvent(event: any): boolean {
  return event?.type === "idle" || event?.type === "agent_end" || event?.type === "submission_settled";
}

export function flueEventToUiEvents(event: any): unknown[] {
  if (!event || typeof event !== "object") return [];
  switch (event.type) {
    case "text_delta":
      return typeof event.text === "string" ? [{ type: "text_delta", delta: event.text }] : [];
    case "thinking_delta":
      return typeof event.delta === "string" ? [{ type: "thinking_delta", delta: event.delta }] : [];
    case "thinking_end":
      return typeof event.content === "string" ? [{ type: "thinking_patch", thinking: event.content }] : [];
    case "tool_start":
      return [toolCallEvent("toolcall_start", event)];
    case "tool":
      return [{
        type: "toolResult",
        toolCallId: String(event.toolCallId || ""),
        result: stringifyToolResult(event.result),
        isError: Boolean(event.isError),
      }];
    case "message_end": {
      if (event.message?.role !== "assistant") return [];
      const content = normalizeContentBlocks(event.message.content);
      return [{
        type: "assistant_snapshot",
        entry: {
          id: assistantEntryId(event, String(event.submissionId || "submission")),
          type: "message",
          timestamp: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
          role: "assistant",
          content,
        },
      }];
    }
    case "operation":
      return event.isError ? [{ type: "error", message: errorMessage(event.error) }] : [];
    case "submission_settled":
      return event.outcome === "failed" ? [{ type: "error", message: errorMessage(event.error) }] : [];
    default:
      return [];
  }
}

export function terminalUiEvent(): unknown {
  return { type: "run_complete" };
}

export function flueEventToAwarenessEntry(input: {
  event: any;
  adapter: string;
  channel?: string;
  submissionId: string;
}): AwarenessEntry | null {
  const event = input.event;
  if (!event || typeof event !== "object") return null;
  const timestamp = typeof event.timestamp === "string" && event.timestamp
    ? event.timestamp
    : new Date().toISOString();

  if (event.type === "tool_start") {
    const toolCallId = String(event.toolCallId || crypto.randomUUID());
    const name = String(event.toolName || "tool");
    const args = normalizeToolArguments(event.args);
    const label = toolCallLabel(event, args);
    return {
      id: `tool-call-${stableIdPart(input.submissionId)}-${stableIdPart(toolCallId)}`,
      type: "tool_call",
      timestamp,
      role: "assistant",
      adapter: input.adapter,
      channel: input.channel,
      submissionId: input.submissionId,
      content: [{
        type: "toolCall",
        id: toolCallId,
        name,
        arguments: args,
        ...(label ? { label } : {}),
      }],
    };
  }

  if (event.type === "tool") {
    const toolCallId = String(event.toolCallId || "");
    return {
      id: `tool-result-${stableIdPart(input.submissionId)}-${stableIdPart(toolCallId || crypto.randomUUID())}`,
      type: "tool_result",
      timestamp,
      role: "tool",
      adapter: input.adapter,
      channel: input.channel,
      submissionId: input.submissionId,
      content: [{
        type: "toolResult",
        toolCallId,
        result: stringifyToolResult(event.result),
        isError: Boolean(event.isError),
      }],
    };
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    const content = finalAssistantAwarenessContent(normalizeContentBlocks(event.message.content));
    if (content.length === 0) return null;
    return {
      id: assistantEntryId(event, input.submissionId),
      type: "message",
      timestamp,
      role: "assistant",
      adapter: input.adapter,
      channel: input.channel,
      submissionId: input.submissionId,
      content,
    };
  }

  return null;
}

function toolCallEvent(type: "toolcall_start" | "toolcall_delta" | "toolcall_end", event: any): unknown {
  const name = String(event.toolName || event.name || "tool");
  const args = normalizeToolArguments(event.args);
  const label = toolCallLabel(event, args);
  return {
    type,
    toolCall: {
      type: "toolCall",
      id: String(event.toolCallId || event.id || crypto.randomUUID()),
      name,
      ...(label ? { label } : {}),
      arguments: args,
    },
  };
}

function assistantEntryId(event: any, submissionId: string): string {
  return `assistant-${stableIdPart(submissionId)}-${stableIdPart(String(event.eventIndex ?? event.timestamp ?? "final"))}`;
}

function normalizeContentBlocks(content: unknown): AwarenessContent[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return normalizeContentBlock(content as Record<string, unknown>);
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): AwarenessContent[] => {
    if (!block || typeof block !== "object") return [];
    return normalizeContentBlock(block as Record<string, unknown>);
  });
}

function normalizeContentBlock(raw: Record<string, unknown>): AwarenessContent[] {
  if (raw.type === "text" || raw.type === "input_text" || raw.type === "output_text") {
    return [{ type: "text", text: String(raw.text ?? raw.content ?? "") }];
  }
  if (raw.type === "thinking") return [{ type: "thinking", thinking: String(raw.thinking || "") }];
  if (raw.type === "toolCall" || raw.type === "tool_call" || raw.type === "tool_use") {
    const rawArgs = raw.arguments ?? raw.args ?? raw.input;
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? rawArgs as Record<string, unknown>
      : {};
    const label = cleanToolCallLabel(raw.label) || cleanToolCallLabel(args.label);
    return [{
      type: "toolCall",
      id: String(raw.id ?? raw.toolCallId ?? raw.tool_call_id ?? raw.toolUseId ?? raw.tool_use_id ?? ""),
      name: String(raw.name ?? raw.toolName ?? raw.tool_name ?? "tool"),
      arguments: args,
      ...(label ? { label } : {}),
    }];
  }
  if (typeof raw.text === "string") return [{ type: "text", text: raw.text }];
  if (typeof raw.content === "string") return [{ type: "text", text: raw.content }];
  if (Array.isArray(raw.content)) return normalizeContentBlocks(raw.content);
  return [];
}

function finalAssistantAwarenessContent(content: AwarenessContent[]): AwarenessContent[] {
  return content.filter((block) => block.type !== "toolCall" && block.type !== "toolResult");
}

function normalizeToolArguments(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {};
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return clipText(result, MAX_TOOL_RESULT_CHARS);
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content.map((block) => {
        if (!block || typeof block !== "object") return "";
        const raw = block as Record<string, unknown>;
        return raw.type === "text" && typeof raw.text === "string" ? raw.text : "";
      }).filter(Boolean).join("\n\n");
      if (text) return clipText(text, MAX_TOOL_RESULT_CHARS);
    }
  }
  return result === undefined ? "" : clipText(JSON.stringify(result), MAX_TOOL_RESULT_CHARS);
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function toolCallLabel(event: Record<string, unknown>, args: Record<string, unknown>): string {
  return cleanToolCallLabel(event.label)
    || cleanToolCallLabel(event.toolLabel)
    || cleanToolCallLabel((event.toolCall as { label?: unknown } | undefined)?.label)
    || cleanToolCallLabel(args.label);
}

function cleanToolCallLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim();
}

function errorMessage(error: unknown): string {
  if (!error) return "Flight turn failed.";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return JSON.stringify(error);
}

function stableIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "value";
}
