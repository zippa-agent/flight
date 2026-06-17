import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAssistantFallbackRecorder,
  flueEventToConsoleEvents,
  flueEventToContextLine,
  mergeConsoleHistoryLines,
  streamConsoleHistory,
} from "../src/console/stream";

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

test("translates user message_end strings into console history lines", () => {
  const line = flueEventToContextLine({
    type: "message_end",
    instanceId: "agent--agent--web",
    eventIndex: 3,
    timestamp: "2026-06-16T12:00:00.000Z",
    message: {
      role: "user",
      content: "[2026-06-16T12:00:00.000Z] [web] [alex@example.com]: hello floopy",
    },
  });

  assert.ok(line);
  assert.deepEqual(JSON.parse(line), {
    id: "flight-agent--agent--web-user-3",
    type: "message",
    timestamp: "2026-06-16T12:00:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "[2026-06-16T12:00:00.000Z] [web] [alex@example.com]: hello floopy" }],
    },
  });
});

test("translates alternate text block message content into console history lines", () => {
  const line = flueEventToContextLine({
    type: "message_end",
    instanceId: "agent--agent--web",
    eventIndex: 4,
    timestamp: "2026-06-16T12:00:01.000Z",
    message: {
      role: "user",
      content: [{ type: "input_text", text: "[2026-06-16T12:00:01.000Z] [web] [alex@example.com]: persisted" }],
    },
  });

  assert.ok(line);
  const parsed = JSON.parse(line);
  assert.equal(parsed.id, "flight-agent--agent--web-user-4");
  assert.deepEqual(parsed.message.content, [{
    type: "text",
    text: "[2026-06-16T12:00:01.000Z] [web] [alex@example.com]: persisted",
  }]);
});

test("uses stable durable context ids for assistant history lines", () => {
  const line = flueEventToContextLine({
    type: "message_end",
    instanceId: "agent--agent--web",
    eventIndex: 7,
    timestamp: "2026-06-16T12:00:02.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    },
  });

  assert.ok(line);
  const parsed = JSON.parse(line);
  assert.equal(parsed.id, "flight-agent--agent--web-assistant-7");
  assert.deepEqual(parsed.message.content, [{ type: "text", text: "done" }]);
});

test("merges console history lines by durable id and timestamp", () => {
  const user = JSON.stringify({
    id: "flight-console-submission-user",
    type: "message",
    timestamp: "2026-06-16T12:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  });
  const assistant = JSON.stringify({
    id: "flight-agent-assistant-7",
    type: "message",
    timestamp: "2026-06-16T12:00:01.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
  });

  assert.deepEqual(mergeConsoleHistoryLines([assistant, user, assistant, "not json"]), [user, assistant]);
});

test("streams console history from the durable console ledger when available", async () => {
  const ledgerResponse = new Response(": connected\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
  const calls: string[] = [];
  const c = {
    env: {
      FLIGHT_CONSOLE_LEDGER: {
        idFromName(name: string) {
          calls.push(`id:${name}`);
          return { name };
        },
        get(id: { name: string }) {
          calls.push(`get:${id.name}`);
          return {
            fetch(request: Request | string) {
              calls.push(typeof request === "string" ? request : request.url);
              return Promise.resolve(ledgerResponse);
            },
          };
        },
      },
    },
  };

  const response = await streamConsoleHistory(c as any, "agent--floopy--web");

  assert.equal(response, ledgerResponse);
  assert.deepEqual(calls, [
    "id:agent--floopy--web",
    "get:agent--floopy--web",
    "https://flight-console-ledger.local/entries/stream",
  ]);
});

test("creates a fallback assistant ledger line from deltas when no message_end arrives", () => {
  const recorder = createAssistantFallbackRecorder("submission-1");
  recorder.capture({ type: "thinking_delta", timestamp: "2026-06-17T02:00:00.000Z", delta: "Thinking" });
  recorder.capture({ type: "thinking_delta", delta: " briefly." });
  recorder.capture({ type: "text_delta", delta: "ignored" });
  recorder.capture({ type: "text_delta", text: "hello" });
  recorder.capture({ type: "text_delta", text: " world" });

  const line = recorder.toContextLine();

  assert.ok(line);
  assert.equal(recorder.toContextLine(), null);
  assert.deepEqual(JSON.parse(line), {
    id: "flight-console-submission-1-assistant",
    type: "message",
    timestamp: "2026-06-17T02:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Thinking briefly." },
        { type: "text", text: "hello world" },
      ],
    },
  });
});

test("does not create a fallback assistant line after an authoritative snapshot", () => {
  const recorder = createAssistantFallbackRecorder("submission-2");
  recorder.capture({ type: "text_delta", text: "partial" });
  recorder.markAuthoritative();

  assert.equal(recorder.toContextLine(), null);
});
