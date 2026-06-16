import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flightInstanceId,
  normalizeFlightWebhook,
  parentAgentIdFromInstanceId,
  renderFlightPrompt,
} from "../src/webhooks/flight-input";

test("normalizes embed webhook into scoped Flight input", () => {
  const input = normalizeFlightWebhook({
    surface: "embed",
    scope: { id: "site:docs:visitor-123", kind: "embed-session" },
    actor: { id: "visitor-123", displayName: "Visitor" },
    message: { text: "How do I deploy this?" },
    delivery: { id: "evt_123" },
  }, {
    agentId: "agent-1",
    now: new Date("2026-06-16T12:00:00.000Z"),
  });

  assert.equal(input.version, "flight.v1");
  assert.equal(input.agentId, "agent-1");
  assert.equal(input.scope.kind, "embed-session");
  assert.equal(input.scope.id, "site:docs:visitor-123");
  assert.equal(input.delivery.id, "evt_123");
  assert.equal(input.message.text, "How do I deploy this?");
});

test("derives stable instance id and parent agent id", () => {
  const input = normalizeFlightWebhook({
    surface: "telegram",
    channelId: "-100123",
    actor: { id: "42", username: "alex" },
    text: "hello",
  }, {
    agentId: "6884e994-60f4-4395-8008-38f73989c34d",
  });

  const instanceId = flightInstanceId(input);
  assert.match(instanceId, /^6884e994-60f4-4395-8008-38f73989c34d--channel--/);
  assert.equal(parentAgentIdFromInstanceId(instanceId), "6884e994-60f4-4395-8008-38f73989c34d");
});

test("renders prompt without raw provider payload", () => {
  const input = normalizeFlightWebhook({
    surface: "support",
    ticketId: "zendesk:987",
    actor: { id: "customer-1", email: "customer@example.com" },
    subject: "Broken deploy",
    body: "The deploy button hangs.",
  }, {
    agentId: "agent-2",
    now: new Date("2026-06-16T12:00:00.000Z"),
  });

  const prompt = renderFlightPrompt(input);
  assert.match(prompt, /support-ticket:zendesk:987/);
  assert.match(prompt, /Broken deploy/);
  assert.match(prompt, /The deploy button hangs/);
  assert.doesNotMatch(prompt, /secret/i);
});
