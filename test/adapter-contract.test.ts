import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailEvent } from "../src/adapters/email";
import { normalizeFlightEvent } from "../src/adapters/flight";
import { normalizeWebEvent } from "../src/adapters/web";

test("web chat normalizes to direct delivery", () => {
  const event = normalizeWebEvent({
    agentId: "agent-1",
    user: { id: "user-1", email: "alex@example.com" },
    body: { message: "hello" },
    now: new Date("2026-06-17T10:00:00.000Z"),
  });

  assert.equal(event.adapter, "web");
  assert.equal(event.deliveryMode, "direct");
  assert.equal(event.scope.id, "web");
  assert.equal(event.replyTarget, undefined);
});

test("email normalizes to messages-only with explicit email target", () => {
  const event = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    now: new Date("2026-06-17T10:00:00.000Z"),
    payload: {
      from: "Alex <alex@example.com>",
      to: "floopy@tinyfat.com",
      subject: "Question",
      body: "Can you help?",
      messageId: "<msg-1@example.com>",
    },
  });

  assert.equal(event.adapter, "email");
  assert.equal(event.deliveryMode, "messages-only");
  assert.equal(event.scope.kind, "agent");
  assert.equal(event.scope.id, "web");
  assert.equal(event.scope.channelId, "email:alex@example.com");
  assert.equal(event.scope.threadId, "<msg-1@example.com>");
  assert.equal(event.replyTarget?.kind, "email");
  assert.deepEqual(event.replyTarget?.kind === "email" ? event.replyTarget.to : [], ["alex@example.com"]);
});

test("generic Flight webhook preserves relationship scope", () => {
  const event = normalizeFlightEvent({
    surface: "slack",
    scope: { kind: "channel", id: "slack:C123:1740000000.000000" },
    actor: { id: "U1", displayName: "Alex" },
    message: { text: "status?" },
    delivery: { id: "evt-1", provider: "slack", receivedAt: "2026-06-17T10:00:00.000Z" },
  }, { agentId: "agent-1" });

  assert.equal(event.adapter, "slack");
  assert.equal(event.deliveryMode, "messages-only");
  assert.equal(event.scope.id, "slack:C123:1740000000.000000");
});
