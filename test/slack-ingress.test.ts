import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSlackEvent } from "../src/adapters/slack";
import {
  appendSlackThreadEvent,
  collectSlackThreadListings,
  parseSlackThreadTarget,
  readSlackThreadByTarget,
} from "../src/adapters/slack/thread-ledger";
import { createSendMessageTool } from "../src/tools/send-message";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";
import type { FlightTurnPayload } from "../src/adapters/types";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("slack target parser accepts thread and top-level targets", () => {
  assert.deepEqual(parseSlackThreadTarget("slack:C123ABC:1710000000.123456"), {
    channel: "C123ABC",
    threadTs: "1710000000.123456",
    inputTarget: "slack:C123ABC:1710000000.123456",
  });
  assert.deepEqual(parseSlackThreadTarget("slack:D123ABC"), {
    channel: "D123ABC",
    inputTarget: "slack:D123ABC",
  });
  assert.deepEqual(parseSlackThreadTarget("G123ABC"), {
    channel: "G123ABC",
    inputTarget: "slack:G123ABC",
  });
});

test("slack thread ledger stores and lists durable send targets", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  await appendSlackThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-19T10:00:00.000Z",
    channelId: "C123ABC",
    channelName: "floopy-qa",
    threadTs: "1710000000.123456",
    messageTs: "1710000000.123456",
    userId: "UUSER",
    userName: "Alex",
    body: "Can you upload this content?",
    directlyAddressed: true,
    sourceEventType: "slack_app_mention",
  });
  await appendSlackThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-19T10:01:00.000Z",
    channelId: "C123ABC",
    channelName: "floopy-qa",
    threadTs: "1710000000.123456",
    messageTs: "1710000001.123456",
    userId: "UAGENT",
    userName: "agent",
    body: "I uploaded it.",
    sourceEventType: "flight_send_message",
  });

  const listings = await collectSlackThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, "slack:C123ABC:1710000000.123456");
  assert.equal(listings[0].channelName, "floopy-qa");
  assert.equal(listings[0].messageCount, 2);

  const records = await readSlackThreadByTarget(env, agentId, {
    channel: "C123ABC",
    threadTs: "1710000000.123456",
    inputTarget: "slack:C123ABC:1710000000.123456",
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].body, "Can you upload this content?");
});

test("slack channel message duplicate for app mention is skipped", () => {
  const result = normalizeSlackEvent({
    agentId,
    payload: {
      type: "event_callback",
      event_id: "EvMessage123",
      botToken: "xoxb-test",
      botUserId: "UAGENT",
      event: {
        type: "message",
        channel: "C123ABC",
        channel_type: "channel",
        user: "UUSER",
        text: "<@UAGENT> respond here",
        ts: "1710000000.123456",
      },
    },
  });

  assert.equal(result.status, "skipped");
  if (result.status !== "skipped") throw new Error("expected duplicate Slack message to be skipped");
  assert.match(result.reason, /duplicate/u);
});

test("send_message posts Slack replies to explicit thread targets", async () => {
  const priorFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, channel: "C123ABC", ts: "1710000002.123456" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const bucket = new FakeR2Bucket();
    const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
    const normalized = normalizeSlackEvent({
      agentId,
      payload: {
        type: "event_callback",
        event_id: "Ev123",
        botToken: "xoxb-test",
        botUserId: "UAGENT",
        event: {
          type: "app_mention",
          channel: "C123ABC",
          channel_type: "channel",
          user: "UUSER",
          text: "<@UAGENT> respond here",
          ts: "1710000000.123456",
        },
      },
    });
    assert.equal(normalized.status, "accepted");
    if (normalized.status !== "accepted") throw new Error("expected accepted");

    const turn: FlightTurnPayload = {
      version: "flight.turn.v1",
      event: normalized.event,
      awarenessTail: [],
      prompt: "test",
      toolPolicy: { allowSendMessage: true, allowFullBash: false },
    };
    const tool = createSendMessageTool({
      env,
      instanceId: `${agentId}--agent--web`,
      turn,
    });
    const result = await tool.execute?.({
      body: "Done with **bold** update.",
      target: "slack:C123ABC:1710000000.123456",
    }, new AbortController().signal);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
    assert.equal(calls[0].body.channel, "C123ABC");
    assert.equal(calls[0].body.thread_ts, "1710000000.123456");
    assert.equal(calls[0].body.text, "Done with *bold* update.");
    assert.match(String(result), /Sent Slack message/u);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
