import assert from "node:assert/strict";
import { test } from "node:test";
import { flueEventToConsoleEvents } from "../src/console/stream";

test("translates Flue text deltas to console web chat deltas", () => {
  assert.deepEqual(flueEventToConsoleEvents({
    type: "text_delta",
    text: "hello",
  }), [{
    type: "text_delta",
    delta: "hello",
    contentIndex: 0,
    phase: "final_answer",
  }]);
});

test("translates Flue tool events with a display label", () => {
  assert.deepEqual(flueEventToConsoleEvents({
    type: "tool_start",
    toolName: "host_bash",
    toolCallId: "tool-1",
    args: { command: "pwd" },
  }), [{
    type: "toolCall",
    id: "tool-1",
    name: "host_bash",
    arguments: {
      command: "pwd",
      label: "Host Bash",
    },
  }]);

  assert.deepEqual(flueEventToConsoleEvents({
    type: "tool",
    toolName: "host_bash",
    toolCallId: "tool-1",
    isError: false,
    result: { content: [{ type: "text", text: "/workspace" }] },
  }), [{
    type: "toolResult",
    toolCallId: "tool-1",
    result: "/workspace",
    isError: false,
  }]);
});

test("translates authoritative assistant message_end snapshots", () => {
  const [event] = flueEventToConsoleEvents({
    type: "message_end",
    eventIndex: 7,
    timestamp: "2026-06-16T12:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    },
  }) as any[];

  assert.equal(event.type, "assistant_snapshot");
  assert.equal(event.entry.id, "flight-assistant-7");
  assert.deepEqual(event.entry.content, [{ type: "text", text: "done" }]);
});
