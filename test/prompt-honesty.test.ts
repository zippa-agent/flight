import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentInstructions } from "../src/agent/prompt";
import { toolPolicyForTurn } from "../src/agent/contract";
import { normalizeEmailEvent } from "../src/adapters/email";
import { normalizeWebEvent } from "../src/adapters/web";
import type { FlightTurnPayload } from "../src/adapters/types";

const base = "Base Flight instructions.";

test("web prompt does not name unavailable delivery or full container tools", () => {
  const text = buildAgentInstructions({
    instanceId: "agent-1--agent--d2Vi",
    turn: null,
    policy: toolPolicyForTurn(null),
    baseInstructions: base,
  });

  assert.equal(text.includes("send_message"), false);
  assert.equal(text.includes("full_bash"), false);
  assert.match(text, /light bash/i);
  assert.match(text, /not R2/);
  assert.match(text, /not \/data/);
});

test("email prompt names send_message only when delivery tool is registered", () => {
  const event = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    payload: {
      from: "alex@example.com",
      to: "floopy@tinyfat.com",
      subject: "hello",
      body: "hello",
      messageId: "<m1@example.com>",
    },
  });
  const turn: FlightTurnPayload = {
    version: "flight.turn.v1",
    event,
    awarenessTail: [],
    prompt: "turn prompt",
    toolPolicy: { allowSendMessage: true, allowFullBash: false },
  };
  const text = buildAgentInstructions({
    instanceId: "agent-1--email-thread--bTE",
    turn,
    policy: toolPolicyForTurn(turn),
    baseInstructions: base,
  });

  assert.match(text, /send_message/);
  assert.equal(text.includes("full_bash"), false);
});

test("web adapter instructions avoid unavailable tool names", () => {
  const event = normalizeWebEvent({
    agentId: "agent-1",
    user: { id: "u1" },
    body: { message: "hello" },
  });

  assert.equal(event.formatInstructions.join("\n").includes("send_message"), false);
});
