import assert from "node:assert/strict";
import test from "node:test";
import { flightInstanceId } from "../src/awareness/id";
import { normalizeEmailEvent } from "../src/adapters/email";

test("same email thread maps to one Flight instance id", () => {
  const first = normalizeEmailEvent({
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
  const second = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    payload: {
      from: "alex@example.com",
      to: "floopy@tinyfat.com",
      subject: "Re: Question",
      body: "two",
      messageId: "<m2@example.com>",
      inReplyTo: "<m1@example.com>",
    },
  });

  assert.equal(flightInstanceId(first), flightInstanceId(second));
});
