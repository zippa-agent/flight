import assert from "node:assert/strict";
import test from "node:test";
import { resolvePromptOnDelivery } from "../src/adapters/listener-policy";
import { normalizePhoneEvent, phoneLedgerEventFromPayload, type PhoneInboundPayload } from "../src/adapters/phone";
import {
  appendPhoneThreadEvent,
  collectPhoneThreadListings,
  phoneThreadTargetForEvent,
  readPhoneThreadByTarget,
  parsePhoneThreadTarget,
} from "../src/adapters/phone/thread-ledger";
import { rememberContactIdentity } from "../src/listener/contacts";
import { noteListenerInboundThread, readListenerThreadStates } from "../src/listener/store";
import { createListChannelsTool } from "../src/tools/list-channels";
import { createReadThreadTool } from "../src/tools/read-thread";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("listener prompt policy honors explicit header and payload values", () => {
  assert.equal(resolvePromptOnDelivery({
    headers: new Headers({ "x-flight-prompt-on-delivery": "false" }),
    defaultValue: true,
  }), false);
  assert.equal(resolvePromptOnDelivery({
    body: { providerData: { listenerPromptOnDelivery: true } },
    defaultValue: false,
  }), true);
  assert.equal(resolvePromptOnDelivery({
    body: { listener: { prompt_on_delivery: "no" } },
    defaultValue: true,
  }), false);
});

test("phone listener ledger stores targets and read_thread can explicitly mark read", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  const payload: PhoneInboundPayload = {
    provider: "twilio",
    transport: "sms",
    messageId: "SM123",
    conversationId: "+15550001111:+15550002222",
    from: "+1 (555) 000-2222",
    to: "+1 (555) 000-1111",
    sender: "+1 (555) 000-1111",
    recipients: ["+1 (555) 000-1111", "+1 (555) 000-3333"],
    text: "Alice confirmed Tuesday.",
    timestamp: "2026-06-19T10:00:00.000Z",
  };
  const event = normalizePhoneEvent({ agentId, payload });
  const ledgerEvent = phoneLedgerEventFromPayload(payload);
  const target = phoneThreadTargetForEvent(ledgerEvent);

  assert.equal(event.adapter, "phone");
  assert.equal(event.replyTarget, undefined);
  assert.equal(event.context?.phoneThreadTarget, target);

  await appendPhoneThreadEvent(env, agentId, ledgerEvent);
  await noteListenerInboundThread({
    env,
    agentId,
    target,
    adapter: "phone",
    at: "2026-06-19T10:00:00.000Z",
    eventId: "SM123",
    lastPreview: payload.text,
  });

  const listings = await collectPhoneThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sendTarget, target);
  assert.equal(listings[0].messageCount, 1);

  const parsed = parsePhoneThreadTarget(target);
  assert(parsed);
  const records = await readPhoneThreadByTarget(env, agentId, parsed);
  assert.equal(records.length, 1);
  assert.equal(records[0].body, "Alice confirmed Tuesday.");

  await rememberContactIdentity({
    env,
    agentId,
    identityKind: "phone",
    identity: payload.from,
    displayName: "Alice",
  });
  await rememberContactIdentity({
    env,
    agentId,
    identityKind: "phone",
    identity: "+1 (555) 000-3333",
    displayName: "Bob",
  });

  const listTool = createListChannelsTool({ env, agentId });
  const channelList = await listTool.execute?.({
    limit: 10,
  }, new AbortController().signal);
  assert.match(String(channelList), /Alice \(\+15550002222\)/u);
  assert.match(String(channelList), /Bob \(\+15550003333\)/u);

  let states = await readListenerThreadStates(env, agentId);
  assert.equal(states[target].read, false);

  const tool = createReadThreadTool({ env, agentId });
  const transcript = await tool.execute?.({
    target,
    mark: "read",
  }, new AbortController().signal);

  assert.match(String(transcript), /Alice confirmed Tuesday/u);
  assert.match(String(transcript), /Alice \(\+15550002222\)/u);
  assert.match(String(transcript), /Participants: Alice \(\+15550002222\), \+15550001111, Bob \(\+15550003333\)/u);
  assert.match(String(transcript), /Read state: read/u);

  states = await readListenerThreadStates(env, agentId);
  assert.equal(states[target].read, true);
  assert.equal(states[target].readBy, "agent");
});

test("listener state preserves Discord and Telegram adapter types", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;

  await noteListenerInboundThread({
    env,
    agentId,
    target: "discord:123456789012345678",
    adapter: "discord",
    at: "2026-06-21T10:00:00.000Z",
    eventId: "discord-evt",
    lastPreview: "Discord note.",
  });
  await noteListenerInboundThread({
    env,
    agentId,
    target: "telegram:8389147137",
    adapter: "telegram",
    at: "2026-06-21T10:01:00.000Z",
    eventId: "telegram-evt",
    lastPreview: "Telegram note.",
  });

  const states = await readListenerThreadStates(env, agentId);
  assert.equal(states["discord:123456789012345678"].adapter, "discord");
  assert.equal(states["telegram:8389147137"].adapter, "telegram");
});
