import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscordEvent } from "../src/adapters/discord";
import {
  appendDiscordThreadEvent,
  collectDiscordThreadListings,
  parseDiscordThreadTarget,
  readDiscordThreadByTarget,
} from "../src/adapters/discord/thread-ledger";
import { createSendMessageTool } from "../src/tools/send-message";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";
import type { FlightTurnPayload } from "../src/adapters/types";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("discord target parser accepts thread and top-level targets", () => {
  assert.deepEqual(parseDiscordThreadTarget("discord:123456789012345678:987654321098765432"), {
    channel: "123456789012345678",
    replyToMessageId: "987654321098765432",
    inputTarget: "discord:123456789012345678:987654321098765432",
  });
  assert.deepEqual(parseDiscordThreadTarget("discord:123456789012345678"), {
    channel: "123456789012345678",
    inputTarget: "discord:123456789012345678",
  });
  assert.deepEqual(parseDiscordThreadTarget("123456789012345678"), {
    channel: "123456789012345678",
    inputTarget: "discord:123456789012345678",
  });
});

test("discord target parser rejects invalid targets", () => {
  assert.equal(parseDiscordThreadTarget("discord:abc"), null);
  assert.equal(parseDiscordThreadTarget("discord:123:abc"), null);
  assert.equal(parseDiscordThreadTarget(""), null);
  assert.equal(parseDiscordThreadTarget(undefined), null);
});

test("discord thread ledger stores and lists durable reply send targets", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  await appendDiscordThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-21T10:00:00.000Z",
    channelId: "123456789012345678",
    channelName: "general",
    replyToMessageId: "987654321098765432",
    messageId: "111122223333444455",
    userId: "999988887777666655",
    userName: "Alex",
    displayName: "Alex Garcia",
    body: "Hey, can you help me with this?",
    directlyAddressed: true,
    sourceEventType: "discord_mention",
  });
  await appendDiscordThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-21T10:01:00.000Z",
    channelId: "123456789012345678",
    channelName: "general",
    replyToMessageId: "987654321098765432",
    messageId: "111122223333444466",
    userId: "agent",
    userName: "agent",
    body: "Sure, what do you need?",
    sourceEventType: "flight_send_message",
  });

  const listings = await collectDiscordThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, "discord:123456789012345678:987654321098765432");
  assert.equal(listings[0].channelName, "general");
  assert.equal(listings[0].messageCount, 2);

  const records = await readDiscordThreadByTarget(env, agentId, {
    channel: "123456789012345678",
    replyToMessageId: "987654321098765432",
    inputTarget: "discord:123456789012345678:987654321098765432",
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].body, "Hey, can you help me with this?");
});

test("discord top-level ledger groups channel sends without splitting by message id", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  await appendDiscordThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-21T11:00:00.000Z",
    channelId: "123456789012345678",
    channelName: "general",
    messageId: "111122223333444455",
    userId: "999988887777666655",
    userName: "Alex",
    displayName: "Alex Garcia",
    body: "Top-level message.",
    directlyAddressed: true,
    sourceEventType: "discord_mention",
  });
  await appendDiscordThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-21T11:01:00.000Z",
    channelId: "123456789012345678",
    channelName: "general",
    messageId: "111122223333444466",
    userId: "agent",
    userName: "agent",
    body: "Top-level response.",
    sourceEventType: "flight_send_message",
  });

  const listings = await collectDiscordThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, "discord:123456789012345678");
  assert.equal(listings[0].messageCount, 2);

  const records = await readDiscordThreadByTarget(env, agentId, {
    channel: "123456789012345678",
    inputTarget: "discord:123456789012345678",
  });
  assert.equal(records.length, 2);
  assert.equal(records[1].body, "Top-level response.");
});

test("discord normalizer accepts a mention event", () => {
  const result = normalizeDiscordEvent({
    agentId,
    payload: {
      type: "MESSAGE_CREATE",
      event_id: "evt123",
      botToken: "test-bot-token",
      botUserId: "888877776666555544",
      guild_id: "777766665555444433",
      event: {
        type: "MESSAGE_CREATE",
        channel_id: "123456789012345678",
        id: "111122223333444455",
        guild_id: "777766665555444433",
        author: {
          id: "999988887777666655",
          username: "alex",
          global_name: "Alex Garcia",
          bot: false,
        },
        content: "<@888877776666555544> what's up?",
      },
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.discordEvent.channelId, "123456789012345678");
  assert.equal(result.discordEvent.userId, "999988887777666655");
  assert.equal(result.discordEvent.displayName, "Alex Garcia");
  assert.equal(result.discordEvent.directlyAddressed, true);
  assert.equal(result.discordEvent.text, "what's up?");
  assert.equal(result.event.adapter, "discord");
  assert.equal(result.event.scope.kind, "agent");
  assert.equal(result.event.scope.id, "web");
  assert.equal(result.event.replyTarget?.kind, "discord");
});

test("discord normalizer skips bot messages", () => {
  const result = normalizeDiscordEvent({
    agentId,
    payload: {
      event: {
        type: "MESSAGE_CREATE",
        channel_id: "123456789012345678",
        id: "111122223333444455",
        author: { id: "888877776666555544", username: "testbot", bot: true },
        content: "Hello",
      },
      botToken: "test-bot-token",
    },
  });

  assert.equal(result.status, "skipped");
  if (result.status !== "skipped") throw new Error("expected skipped");
  assert.match(result.reason, /bot/u);
});

test("discord normalizer handles DM messages", () => {
  const result = normalizeDiscordEvent({
    agentId,
    payload: {
      event: {
        type: "MESSAGE_CREATE",
        channel_id: "123456789012345678",
        channel_type: 1,
        id: "111122223333444455",
        author: { id: "999988887777666655", username: "alex", bot: false },
        content: "hey there",
      },
      botToken: "test-bot-token",
      botUserId: "888877776666555544",
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.discordEvent.isDm, true);
  assert.equal(result.discordEvent.directlyAddressed, true);
  assert.equal(result.discordEvent.sourceEventType, "discord_dm");
});

test("discord normalizer handles ambient channel messages", () => {
  const result = normalizeDiscordEvent({
    agentId,
    payload: {
      event: {
        type: "MESSAGE_CREATE",
        channel_id: "123456789012345678",
        id: "111122223333444455",
        guild_id: "777766665555444433",
        author: { id: "999988887777666655", username: "alex", bot: false },
        content: "just chatting here",
      },
      botToken: "test-bot-token",
      botUserId: "888877776666555544",
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.discordEvent.directlyAddressed, false);
  assert.equal(result.discordEvent.sourceEventType, "discord_ambient_message");
});

test("send_message posts Discord replies only when a message reply target is explicit", async () => {
  const priorFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "222233334444555566" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const bucket = new FakeR2Bucket();
    const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
    const normalized = normalizeDiscordEvent({
      agentId,
      payload: {
        type: "MESSAGE_CREATE",
        event_id: "evt123",
        botToken: "test-bot-token",
        botUserId: "888877776666555544",
        guild_id: "777766665555444433",
        event: {
          type: "MESSAGE_CREATE",
          channel_id: "123456789012345678",
          id: "111122223333444455",
          guild_id: "777766665555444433",
          author: {
            id: "999988887777666655",
            username: "alex",
            global_name: "Alex Garcia",
            bot: false,
          },
          content: "<@888877776666555544> respond here",
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
      target: "discord:123456789012345678:111122223333444455",
    }, new AbortController().signal);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://discord.com/api/v10/channels/123456789012345678/messages");
    assert.equal(calls[0].body.content, "Done with **bold** update.");
    assert.deepEqual(calls[0].body.message_reference, {
      message_id: "111122223333444455",
      channel_id: "123456789012345678",
    });
    assert.match(String(result), /Sent Discord message/u);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
