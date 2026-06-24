import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTelegramEvent } from "../src/adapters/telegram";
import {
  appendTelegramThreadEvent,
  collectTelegramThreadListings,
  parseTelegramThreadTarget,
  readTelegramThreadByTarget,
} from "../src/adapters/telegram/thread-ledger";
import { createSendMessageTool } from "../src/tools/send-message";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";
import type { FlightTurnPayload } from "../src/adapters/types";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("telegram target parser accepts reply and top-level targets", () => {
  assert.deepEqual(parseTelegramThreadTarget("telegram:8389147137:42"), {
    chatId: "8389147137",
    replyToMessageId: "42",
    inputTarget: "telegram:8389147137:42",
  });
  assert.deepEqual(parseTelegramThreadTarget("telegram:-1001234567890"), {
    chatId: "-1001234567890",
    inputTarget: "telegram:-1001234567890",
  });
  assert.deepEqual(parseTelegramThreadTarget("8389147137"), {
    chatId: "8389147137",
    inputTarget: "telegram:8389147137",
  });
});

test("telegram target parser rejects invalid targets", () => {
  assert.equal(parseTelegramThreadTarget("telegram:abc"), null);
  assert.equal(parseTelegramThreadTarget("telegram:123:abc"), null);
  assert.equal(parseTelegramThreadTarget(""), null);
  assert.equal(parseTelegramThreadTarget(undefined), null);
});

test("telegram top-level ledger groups chat sends without splitting by message id", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  await appendTelegramThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-21T10:00:00.000Z",
    chatId: "8389147137",
    chatName: "DM:Alex",
    chatType: "private",
    messageId: "100",
    userId: "999988887",
    userName: "alexg",
    displayName: "Alex Garcia",
    body: "Hey, what's up?",
    directlyAddressed: true,
    sourceEventType: "telegram_dm",
  });
  await appendTelegramThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-21T10:01:00.000Z",
    chatId: "8389147137",
    chatName: "DM:Alex",
    chatType: "private",
    messageId: "101",
    userId: "agent",
    userName: "agent",
    body: "Not much, you?",
    sourceEventType: "flight_send_message",
  });

  const listings = await collectTelegramThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, "telegram:8389147137");
  assert.equal(listings[0].chatName, "DM:Alex");
  assert.equal(listings[0].messageCount, 2);

  const records = await readTelegramThreadByTarget(env, agentId, {
    chatId: "8389147137",
    inputTarget: "telegram:8389147137",
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].body, "Hey, what's up?");
});

test("telegram reply ledger stores and lists durable reply send targets", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  await appendTelegramThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-21T10:00:00.000Z",
    chatId: "-1001234567890",
    chatName: "Test Group",
    chatType: "supergroup",
    messageId: "200",
    replyToMessageId: "150",
    userId: "999988887",
    userName: "alexg",
    displayName: "Alex Garcia",
    body: "Replying in a thread.",
    directlyAddressed: true,
    sourceEventType: "telegram_mention",
  });
  await appendTelegramThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-21T10:01:00.000Z",
    chatId: "-1001234567890",
    chatName: "Test Group",
    chatType: "supergroup",
    messageId: "201",
    replyToMessageId: "150",
    userId: "agent",
    userName: "agent",
    body: "Reply response.",
    sourceEventType: "flight_send_message",
  });

  const listings = await collectTelegramThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, "telegram:-1001234567890:150");
  assert.equal(listings[0].messageCount, 2);

  const records = await readTelegramThreadByTarget(env, agentId, {
    chatId: "-1001234567890",
    replyToMessageId: "150",
    inputTarget: "telegram:-1001234567890:150",
  });
  assert.equal(records.length, 2);
  assert.equal(records[1].body, "Reply response.");
});

test("telegram normalizer accepts a DM message", () => {
  const result = normalizeTelegramEvent({
    agentId,
    payload: {
      event_id: "evt123",
      botToken: "test-bot-token",
      botUserId: "testbot",
      update: {
        message: {
          message_id: 100,
          date: 1789123456,
          text: "hello there",
          chat: {
            id: 8389147137,
            type: "private",
            first_name: "Alex",
            last_name: "Garcia",
            username: "alexg",
          },
          from: {
            id: 999988887,
            is_bot: false,
            first_name: "Alex",
            last_name: "Garcia",
            username: "alexg",
          },
        },
      },
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.telegramEvent.chatId, "8389147137");
  assert.equal(result.telegramEvent.isPrivate, true);
  assert.equal(result.telegramEvent.directlyAddressed, true);
  assert.equal(result.telegramEvent.displayName, "Alex Garcia");
  assert.equal(result.telegramEvent.text, "hello there");
  assert.equal(result.event.adapter, "telegram");
  assert.equal(result.event.scope.kind, "agent");
  assert.equal(result.event.scope.id, "web");
  assert.equal(result.event.replyTarget?.kind, "telegram");
});

test("telegram normalizer skips bot messages", () => {
  const result = normalizeTelegramEvent({
    agentId,
    payload: {
      botToken: "test-bot-token",
      update: {
        message: {
          message_id: 100,
          date: 1789123456,
          text: "I am a bot",
          chat: { id: 8389147137, type: "private" },
          from: { id: 123, is_bot: true, first_name: "Bot" },
        },
      },
    },
  });

  assert.equal(result.status, "skipped");
  if (result.status !== "skipped") throw new Error("expected skipped");
  assert.match(result.reason, /bot/u);
});

test("telegram normalizer handles group messages with reply-to", () => {
  const result = normalizeTelegramEvent({
    agentId,
    payload: {
      botToken: "test-bot-token",
      botUserId: "testbot",
      update: {
        message: {
          message_id: 200,
          date: 1789123456,
          text: "@testbot help me",
          chat: {
            id: -1001234567890,
            type: "supergroup",
            title: "Test Group",
          },
          from: {
            id: 999988887,
            is_bot: false,
            first_name: "Alex",
            username: "alexg",
          },
          reply_to_message: {
            message_id: 150,
            chat: { id: -1001234567890 },
            date: 1789123400,
          },
        },
      },
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.telegramEvent.isPrivate, false);
  assert.equal(result.telegramEvent.directlyAddressed, true);
  assert.equal(result.telegramEvent.replyToMessageId, "150");
  assert.equal(result.telegramEvent.sourceEventType, "telegram_mention");
  assert.equal(result.telegramEvent.chatName, "Test Group");
});

test("telegram normalizer handles media-only messages", () => {
  const result = normalizeTelegramEvent({
    agentId,
    payload: {
      botToken: "test-bot-token",
      update: {
        message: {
          message_id: 300,
          date: 1789123456,
          chat: { id: 8389147137, type: "private", first_name: "Alex" },
          from: { id: 999988887, is_bot: false, first_name: "Alex" },
          document: { file_id: "abc", file_name: "report.pdf" },
          caption: "Here's the report",
        },
      },
    },
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") throw new Error("expected accepted");
  assert.equal(result.telegramEvent.hasMedia, true);
  assert.equal(result.telegramEvent.mediaDescription, "[File: report.pdf]");
  assert.equal(result.telegramEvent.text, "Here's the report");
});

test("send_message posts Telegram replies with reply_parameters", async () => {
  const priorFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 201 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const bucket = new FakeR2Bucket();
    const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
    const normalized = normalizeTelegramEvent({
      agentId,
      payload: {
        botToken: "test-bot-token",
        botUserId: "testbot",
        update: {
          message: {
            message_id: 200,
            date: 1789123456,
            text: "@testbot help me",
            chat: {
              id: -1001234567890,
              type: "supergroup",
              title: "Test Group",
            },
            from: {
              id: 999988887,
              is_bot: false,
              first_name: "Alex",
              username: "alexg",
            },
            reply_to_message: {
              message_id: 150,
              chat: { id: -1001234567890 },
              date: 1789123400,
            },
          },
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
      target: "telegram:-1001234567890:150",
    }, new AbortController().signal);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.telegram.org/bottest-bot-token/sendMessage");
    assert.equal(calls[0].body.chat_id, -1001234567890);
    assert.equal(calls[0].body.text, "Done with <b>bold</b> update.");
    assert.deepEqual(calls[0].body.reply_parameters, { message_id: 150 });
    assert.equal("reply_to_message_id" in calls[0].body, false);
    assert.match(String(result), /Sent Telegram message/u);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
