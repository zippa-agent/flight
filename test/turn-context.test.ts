import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailEvent } from "../src/adapters/email";
import type { FlightTurnPayload } from "../src/adapters/types";
import { promptWithTurnContext, resolveTurnContext, storeTurnContext } from "../src/turns/context";
import { FakeR2Bucket } from "./support/fake-r2";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--email-thread--bTE`;

test("direct Flue payloads can recover stored Flight turn context", async () => {
  const bucket = new FakeR2Bucket();
  const turn: FlightTurnPayload = {
    version: "flight.turn.v1",
    event: normalizeEmailEvent({
      agentId,
      toolsToken: "fat_tools_test",
      payload: {
        from: "alex@example.com",
        to: "floopy@tinyfat.ai",
        subject: "hello",
        body: "hello",
        messageId: "<m1@example.com>",
      },
    }),
    awarenessTail: [],
    prompt: "turn prompt",
    toolPolicy: { allowSendMessage: true, allowFullBash: false },
  };

  const contextId = await storeTurnContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    instanceId,
    turn,
  });
  const payload = {
    message: promptWithTurnContext({ contextId, prompt: turn.prompt }),
  };

  assert.deepEqual(await resolveTurnContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    instanceId,
    payload,
  }), turn);
});

test("created-agent initialization can recover the latest turn without direct payload", async () => {
  const bucket = new FakeR2Bucket();
  const turn: FlightTurnPayload = {
    version: "flight.turn.v1",
    event: normalizeEmailEvent({
      agentId,
      toolsToken: "fat_tools_test",
      payload: {
        from: "alex@example.com",
        to: "floopy@tinyfat.ai",
        subject: "hello",
        body: "hello",
        messageId: "<m2@example.com>",
      },
    }),
    awarenessTail: [],
    prompt: "turn prompt",
    toolPolicy: { allowSendMessage: true, allowFullBash: false },
  };

  await storeTurnContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    instanceId,
    turn,
  });

  assert.deepEqual(await resolveTurnContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    instanceId,
    payload: undefined,
  }), turn);
});
