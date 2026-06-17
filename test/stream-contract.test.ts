import assert from "node:assert/strict";
import test from "node:test";
import { flueEventToUiEvents, terminalUiEvent } from "../src/turns/stream";

test("Flue stream deltas use the Troublemaker chat reducer contract", () => {
  assert.deepEqual(flueEventToUiEvents({ type: "text_delta", text: "hello" }), [
    { type: "text_delta", delta: "hello" },
  ]);
  assert.deepEqual(flueEventToUiEvents({ type: "thinking_delta", delta: "checking" }), [
    { type: "thinking_delta", delta: "checking" },
  ]);
});

test("Flue tool events expose labeled tool calls and results", () => {
  assert.deepEqual(flueEventToUiEvents({
    type: "tool_start",
    toolCallId: "call-1",
    toolName: "full_bash",
    args: { command: "pwd" },
  }), [{
    type: "toolcall_start",
    toolCall: {
      type: "toolCall",
      id: "call-1",
      name: "full_bash",
      arguments: { command: "pwd", label: "Full bash" },
    },
  }]);

  assert.deepEqual(flueEventToUiEvents({
    type: "tool",
    toolCallId: "call-1",
    result: "ok",
  }), [{
    type: "toolResult",
    toolCallId: "call-1",
    result: "ok",
    isError: false,
  }]);
});

test("Flue assistant completion emits a snapshot and terminal run event", () => {
  const events = flueEventToUiEvents({
    type: "message_end",
    submissionId: "sub-1",
    eventIndex: 12,
    timestamp: "2026-06-17T17:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    },
  });

  assert.equal(events.length, 1);
  assert.equal((events[0] as any).type, "assistant_snapshot");
  assert.equal((events[0] as any).entry.id, "assistant-sub-1-12");
  assert.deepEqual((events[0] as any).entry.content, [{ type: "text", text: "done" }]);
  assert.deepEqual(terminalUiEvent(), { type: "run_complete" });
});
