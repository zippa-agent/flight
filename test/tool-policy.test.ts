import assert from "node:assert/strict";
import test from "node:test";
import { availableToolNames } from "../src/tools/registry";
import { normalizeEmailEvent } from "../src/adapters/email";
import type { Env } from "../src/env";
import type { FlightTurnPayload } from "../src/adapters/types";

const env: Env = {};
const workspaceEnv: Env = { FLIGHT_WORKSPACE: {} as R2Bucket };

test("no custom tools are available without a turn payload", () => {
  assert.deepEqual(availableToolNames({ env, turn: null }), []);
});

test("deploy_site is available when Flight workspace storage is configured", () => {
  assert.deepEqual(availableToolNames({ env: workspaceEnv, turn: null }), ["deploy_site"]);
});

test("messages-only email turns expose send_message", () => {
  const event = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    payload: {
      from: "alex@example.com",
      to: "floopy@tinyfat.com",
      body: "hello",
      messageId: "<m1@example.com>",
    },
  });
  const turn: FlightTurnPayload = {
    version: "flight.turn.v1",
    event,
    awarenessTail: [],
    prompt: "prompt",
    toolPolicy: { allowSendMessage: true, allowFullBash: false },
  };

  assert.deepEqual(availableToolNames({ env, turn }), ["send_message"]);
  assert.deepEqual(availableToolNames({ env: workspaceEnv, turn }), [
    "deploy_site",
    "list_channels",
    "read_thread",
    "send_message",
  ]);
});

test("full_bash requires both policy and Crawdad credentials", () => {
  const turn = {
    version: "flight.turn.v1",
    event: normalizeEmailEvent({
      agentId: "agent-1",
      toolsToken: "fat_tools_test",
      payload: {
        from: "alex@example.com",
        to: "floopy@tinyfat.com",
        body: "hello",
        messageId: "<m1@example.com>",
      },
    }),
    awarenessTail: [],
    prompt: "prompt",
    toolPolicy: { allowSendMessage: true, allowFullBash: true },
  } satisfies FlightTurnPayload;

  assert.deepEqual(availableToolNames({ env, turn }), ["send_message"]);
  assert.deepEqual(availableToolNames({
    env: { CRAWDAD_API_BASE: "https://crawdad.tinyfat.com", CRAWDAD_API_TOKEN: "token" },
    turn,
  }), ["send_message", "full_bash"]);
});
