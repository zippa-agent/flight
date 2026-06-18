import assert from "node:assert/strict";
import test from "node:test";
import { flightInstanceId } from "../src/awareness/id";
import { normalizeEmailEvent } from "../src/adapters/email";
import { normalizeWebEvent } from "../src/adapters/web";

test("default email and default web chat map to one unified Flight instance id", () => {
  const email = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    payload: {
      from: "alex@example.com",
      to: "floopy@tinyfat.com",
      subject: "Question",
      body: "one",
      messageId: "<m1@example.com>",
    },
  });
  const web = normalizeWebEvent({
    agentId: "agent-1",
    user: { id: "u1", email: "alex@example.com" },
    body: { message: "two" },
  });

  assert.equal(flightInstanceId(email), flightInstanceId(web));
});
