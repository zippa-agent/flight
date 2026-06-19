import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentInstructions } from "../src/agent/prompt";
import { toolPolicyForTurn } from "../src/agent/contract";
import { normalizeEmailEvent } from "../src/adapters/email";
import { normalizeWebEvent } from "../src/adapters/web";
import type { FlightTurnPayload } from "../src/adapters/types";

const base = "Base Flight instructions.";
const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("web prompt does not name unavailable delivery or full container tools", () => {
  const text = buildAgentInstructions({
    instanceId: `${agentId}--agent--d2Vi`,
    turn: null,
    policy: toolPolicyForTurn(null),
    baseInstructions: base,
    workspaceContext: "Flight workspace context:\nIdentity:\nFloopy knows the content store.",
  });

  assert.equal(text.includes("send_message"), false);
  assert.equal(text.includes("full_bash"), false);
  assert.match(text, /Floopy knows the content store/);
  assert.doesNotMatch(text, /does not yet load/i);
  assert.match(text, /durable R2-backed workspace/i);
  assert.match(text, /loads available \/workspace BOOTSTRAP/);
  assert.match(text, /every tool call must include a required label argument/i);
  assert.match(text, /tiny-agents-data\/<agent-uuid>/);
  assert.match(text, /Generic bash: unavailable/);
  assert.match(text, /not a \/data/);
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
    instanceId: `${agentId}--agent--d2Vi`,
    turn,
    policy: toolPolicyForTurn(turn),
    toolNames: ["send_message"],
    baseInstructions: base,
  });

  assert.match(text, /send_message/);
  assert.equal(text.includes("full_bash"), false);
  assert.match(event.formatInstructions.join("\n"), /do not retry with another thread or recipient/i);
});

test("browser prompt names browser_content only when tool is registered", () => {
  const textWithoutBrowser = buildAgentInstructions({
    instanceId: `${agentId}--agent--d2Vi`,
    turn: null,
    policy: toolPolicyForTurn(null),
    toolNames: ["set_site_binding", "deploy_site", "upload_site_content"],
    baseInstructions: base,
  });
  const textWithBrowser = buildAgentInstructions({
    instanceId: `${agentId}--agent--d2Vi`,
    turn: null,
    policy: toolPolicyForTurn(null),
    toolNames: ["set_site_binding", "deploy_site", "upload_site_content", "browser_content"],
    baseInstructions: base,
  });

  assert.equal(textWithoutBrowser.includes("browser_content"), false);
  assert.match(textWithBrowser, /browser_content/);
  assert.match(textWithBrowser, /direct-fetch text as a fallback/i);
});

test("web adapter instructions avoid unavailable tool names", () => {
  const event = normalizeWebEvent({
    agentId: "agent-1",
    user: { id: "u1" },
    body: { message: "hello" },
  });

  assert.equal(event.formatInstructions.join("\n").includes("send_message"), false);
});
