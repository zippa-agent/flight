import assert from "node:assert/strict";
import test from "node:test";
import { availableToolNames } from "../src/tools/registry";
import { normalizeEmailEvent } from "../src/adapters/email";
import type { Env } from "../src/env";
import type { FlightTurnPayload } from "../src/adapters/types";

const env: Env = {};
const workspaceEnv: Env = { FLIGHT_WORKSPACE: {} as R2Bucket };

test("search_tools is available even without configured provider tools", () => {
  assert.deepEqual(availableToolNames({ env, turn: null }), ["search_tools"]);
});

test("site tools are available when Flight workspace storage is configured", () => {
  assert.deepEqual(availableToolNames({ env: workspaceEnv, turn: null }), [
    "search_tools",
    "set_site_binding",
    "deploy_site",
    "upload_site_content",
    "set_goal",
    "complete_goal",
    "abandon_goal",
  ]);
});

test("browser content tool requires Crawdad browser credentials", () => {
  assert.equal(availableToolNames({ env, turn: null }).includes("browser_content"), false);
  assert.deepEqual(availableToolNames({
    env: { CRAWDAD_API_BASE: "https://crawdad.tinyfat.com", CRAWDAD_API_TOKEN: "token" },
    turn: null,
  }), ["search_tools", "browser_content", "browser_evaluate"]);
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

  assert.deepEqual(availableToolNames({ env, turn }), ["search_tools", "send_message"]);
  assert.deepEqual(availableToolNames({ env: workspaceEnv, turn }), [
    "search_tools",
    "set_site_binding",
    "deploy_site",
    "upload_site_content",
    "list_channels",
    "read_thread",
    "remember_contact",
    "send_message",
    "set_goal",
    "complete_goal",
    "abandon_goal",
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

  assert.deepEqual(availableToolNames({ env, turn }), ["search_tools", "send_message"]);
  assert.deepEqual(availableToolNames({
    env: { CRAWDAD_API_BASE: "https://crawdad.tinyfat.com", CRAWDAD_API_TOKEN: "token" },
    turn,
  }), ["search_tools", "browser_content", "browser_evaluate", "send_message", "full_bash"]);
});
