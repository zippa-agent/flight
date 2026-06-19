import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplyThreadHeaders,
  compileReferences,
  composeEmailReplyBody,
  cleanEmailBody,
  normalizeEmailEvent,
  normalizeMessageIdForHeader,
  parseReferencesHeader,
  stripQuotedEmailText,
} from "../src/adapters/email";
import {
  persistEmailAttachments,
  withWorkspaceAttachmentPaths,
} from "../src/adapters/email/attachments";
import {
  appendEmailThreadEvent,
  collectEmailThreadListings,
  emailThreadIdForEvent,
  readEmailThreadForEvent,
  readRelatedEmailThreadForEvent,
} from "../src/adapters/email/thread-ledger";
import { FakeR2Bucket } from "./support/fake-r2";

test("email ingress strips Gmail-style quoted history from model-visible text", () => {
  const body = [
    "Fresh request for the agent.",
    "",
    "On Wed, Jun 17, 2026 at 9:12 PM Alex <alex@example.com> wrote:",
    "> Earlier message",
    "> Previous reply",
  ].join("\n");

  const event = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    now: new Date("2026-06-18T10:00:00.000Z"),
    payload: {
      from: "Alex <alex@example.com>",
      fromFull: "Alex <alex@example.com>",
      to: "floopy@tinyfat.ai",
      subject: "Re: Project",
      body,
      messageId: "<reply-1@example.com>",
      references: "<root@example.com>",
    },
  });

  assert.match(event.message.text, /Fresh request for the agent/u);
  assert.doesNotMatch(event.message.text, /Earlier message/u);
  assert.equal(event.scope.threadId, "<root@example.com>");
  assert.equal(event.replyTarget?.kind, "email");
  if (event.replyTarget?.kind !== "email") throw new Error("expected email target");
  assert.equal(event.replyTarget.inReplyTo, "<reply-1@example.com>");
  assert.equal(event.replyTarget.references, "<root@example.com> <reply-1@example.com>");
  assert.equal(event.replyTarget.replyQuote?.body, "Fresh request for the agent.");
});

test("email quote stripping handles original-message header blocks", () => {
  const clean = stripQuotedEmailText([
    "Current reply",
    "",
    "From: Alex <alex@example.com>",
    "Sent: Wednesday, June 17, 2026 10:30 PM",
    "To: Floopy <floopy@tinyfat.ai>",
    "Subject: Re: Project",
    "",
    "Old text",
  ].join("\n"));

  assert.equal(clean, "Current reply");
});

test("email thread headers reject malformed ids and dedupe references", () => {
  assert.equal(normalizeMessageIdForHeader("reply@example.com"), "<reply@example.com>");
  assert.equal(normalizeMessageIdForHeader("not a header"), undefined);
  assert.deepEqual(parseReferencesHeader("<root@example.com> <root@EXAMPLE.com> <next@example.com>"), [
    "<root@example.com>",
    "<next@example.com>",
  ]);
  assert.equal(
    compileReferences("<root@example.com>", "<reply@example.com>"),
    "<root@example.com> <reply@example.com>",
  );
  assert.deepEqual(buildReplyThreadHeaders("<reply@example.com>", "<root@example.com>"), {
    in_reply_to: "<reply@example.com>",
    references: "<root@example.com> <reply@example.com>",
  });
});

test("email replies include a native-style quoted prior inbound body", () => {
  const body = composeEmailReplyBody("Here is the answer.", {
    body: "Fresh request for the agent.",
    from: "Alex <alex@example.com>",
    sentAt: "2026-06-18T10:00:00.000Z",
  });

  assert.match(body, /^Here is the answer\./u);
  assert.match(body, /On Thu, Jun 18, 2026 at/u);
  assert.match(body, /> Fresh request for the agent\./u);
});

test("email reply quote reconstructs the prior thread chain with dated headers", () => {
  const records = [
    {
      type: "inbound" as const,
      at: "2026-06-18T10:00:00.000Z",
      channelId: "email:alex@example.com",
      from: "Alex Garcia <alex@example.com>",
      to: ["floopy@tinyfat.ai"],
      subject: "Project",
      body: "brrrrrrr hello",
      messageId: "<root@example.com>",
      threadKey: "message:root@example.com",
      threadId: "thread-1",
    },
    {
      type: "outbound" as const,
      at: "2026-06-18T10:01:00.000Z",
      channelId: "email:alex@example.com",
      from: "floopy@tinyfat.ai",
      to: ["alex@example.com"],
      subject: "Re: Project",
      body: "beep boop! hello to you too.",
      inReplyTo: "<root@example.com>",
      references: "<root@example.com>",
      threadKey: "message:root@example.com",
      threadId: "thread-1",
    },
  ];

  const event = normalizeEmailEvent({
    agentId: "agent-1",
    toolsToken: "fat_tools_test",
    threadRecords: records,
    now: new Date("2026-06-18T10:02:00.000Z"),
    payload: {
      from: "Alex Garcia <alex@example.com>",
      fromFull: "Alex Garcia <alex@example.com>",
      to: "floopy@tinyfat.ai",
      subject: "Re: Project",
      body: "what's up?",
      messageId: "<reply@example.com>",
      references: "<root@example.com>",
    },
  });

  assert.equal(event.replyTarget?.kind, "email");
  if (event.replyTarget?.kind !== "email") throw new Error("expected email target");
  const delivered = composeEmailReplyBody("nothing much.", event.replyTarget.replyQuote);

  assert.match(delivered, /nothing much\./u);
  assert.match(delivered, /On Thu, Jun 18, 2026 at .+Alex Garcia <alex@example\.com> wrote:/u);
  assert.match(delivered, /> what's up\?/u);
  assert.match(delivered, /> On Thu, Jun 18, 2026 at .+floopy@tinyfat\.ai wrote:/u);
  assert.match(delivered, /> > beep boop! hello to you too\./u);
  assert.match(delivered, /> > On Thu, Jun 18, 2026 at .+Alex Garcia <alex@example\.com> wrote:/u);
  assert.match(delivered, /> > > brrrrrrr hello/u);
  assert.doesNotMatch(delivered, /On Alex Garcia <alex@example\.com> wrote:/u);
});

test("email thread ledger stores immutable R2 events and reloads a thread", async () => {
  const bucket = new FakeR2Bucket();
  const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
  const env = { FLIGHT_WORKSPACE: bucket.r2 };
  const threadEvent = {
    channelId: "email:alex@example.com",
    subject: "Project",
    messageId: "<root@example.com>",
  };
  const threadId = emailThreadIdForEvent(threadEvent);

  await appendEmailThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-18T10:00:00.000Z",
    ...threadEvent,
    from: "alex@example.com",
    to: ["floopy@tinyfat.ai"],
    body: "hello",
  });
  await appendEmailThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-18T10:01:00.000Z",
    channelId: "email:alex@example.com",
    subject: "Re: Project",
    inReplyTo: "<root@example.com>",
    references: "<root@example.com>",
    from: "floopy@tinyfat.ai",
    to: ["alex@example.com"],
    body: "hi",
  });

  const records = await readEmailThreadForEvent(env, agentId, threadEvent);
  assert.equal(records.length, 2);
  assert.equal(records[0].threadId, threadId);
  assert.equal(records[1].threadId, threadId);
  assert.match(bucket.keys()[0], /tiny-agents-data\/6884e994-60f4-4395-8008-38f73989c34d\/\.flight\/email-thread-events\//u);
});

test("email thread reconstruction falls back to channel and subject when headers are missing", async () => {
  const bucket = new FakeR2Bucket();
  const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
  const env = { FLIGHT_WORKSPACE: bucket.r2 };

  await appendEmailThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-18T10:00:00.000Z",
    channelId: "email:alex@example.com",
    subject: "Flight thread parity",
    from: "alex@example.com",
    to: ["floopy@tinyfat.ai"],
    body: "THREAD_A",
    messageId: "<a@example.com>",
  });
  await appendEmailThreadEvent(env, agentId, {
    type: "outbound",
    at: "2026-06-18T10:01:00.000Z",
    channelId: "email:alex@example.com",
    subject: "Re: Flight thread parity",
    from: "floopy@tinyfat.ai",
    to: ["alex@example.com"],
    body: "REPLY_A",
    inReplyTo: "<a@example.com>",
    references: "<a@example.com>",
  });

  const threadRecords = await readRelatedEmailThreadForEvent(env, agentId, {
    channelId: "email:alex@example.com",
    subject: "Re: Flight thread parity",
    messageId: "<b@example.com>",
  });
  assert.equal(threadRecords.length, 2);

  const event = normalizeEmailEvent({
    agentId,
    toolsToken: "fat_tools_test",
    threadRecords,
    now: new Date("2026-06-18T10:02:00.000Z"),
    payload: {
      from: "alex@example.com",
      to: "floopy@tinyfat.ai",
      subject: "Re: Flight thread parity",
      body: "THREAD_B",
      messageId: "<b@example.com>",
    },
  });
  assert.equal(event.replyTarget?.kind, "email");
  if (event.replyTarget?.kind !== "email") throw new Error("expected email target");
  const delivered = composeEmailReplyBody("REPLY_B", event.replyTarget.replyQuote);

  assert.match(delivered, /REPLY_B/u);
  assert.match(delivered, /> THREAD_B/u);
  assert.match(delivered, /> > REPLY_A/u);
  assert.match(delivered, /> > > THREAD_A/u);
});

test("email thread listings collapse missing-header replies into a stable send target", async () => {
  const bucket = new FakeR2Bucket();
  const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
  const env = { FLIGHT_WORKSPACE: bucket.r2 };

  await appendEmailThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-18T10:00:00.000Z",
    channelId: "email:alex@example.com",
    subject: "Project",
    from: "alex@example.com",
    to: ["floopy@tinyfat.ai"],
    body: "first",
    messageId: "<first@example.com>",
  });
  await appendEmailThreadEvent(env, agentId, {
    type: "inbound",
    at: "2026-06-18T10:02:00.000Z",
    channelId: "email:alex@example.com",
    subject: "Re: Project",
    from: "alex@example.com",
    to: ["floopy@tinyfat.ai"],
    body: "second",
    messageId: "<second@example.com>",
  });

  const listings = await collectEmailThreadListings(env, agentId);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].messageCount, 2);
  assert.equal(listings[0].subject, "Re: Project");
  assert.match(listings[0].sendTarget, /^email-thread:[a-f0-9]{16}$/u);
});

test("cleanEmailBody strips quoted content before ledger storage", () => {
  const body = [
    "Fresh line",
    "",
    "On Thu, Jun 18, 2026 at 10:00 AM Alex <alex@example.com> wrote:",
    "> Old line",
  ].join("\n");

  assert.equal(cleanEmailBody({ from: "alex@example.com", to: "floopy@tinyfat.ai", body }), "Fresh line");
});

test("email attachments are persisted into workspace and exposed as source paths", async () => {
  const bucket = new FakeR2Bucket();
  const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
  const env = { FLIGHT_WORKSPACE: bucket.r2 };
  const payload = {
    from: "Alex <alex@example.com>",
    to: "floopy@tinyfat.ai",
    subject: "Place this image",
    body: "Please upload this image to the site content store.",
    messageId: "<image-message@example.com>",
    attachments: [{
      filename: "Hero Image.png",
      content_type: "image/png",
      content: Buffer.from("fake-png").toString("base64"),
    }],
  };

  const files = await persistEmailAttachments({
    env,
    agentId,
    payload,
    receivedAt: new Date("2026-06-19T12:00:00.000Z"),
  });
  const event = normalizeEmailEvent({
    agentId,
    toolsToken: "fat_tools_test",
    payload: withWorkspaceAttachmentPaths(payload, files),
    now: new Date("2026-06-19T12:00:00.000Z"),
  });

  assert.equal(files.length, 1);
  assert.match(files[0].path, /^\/workspace\/attachments\/email\/2026-06-19\/image-message-example.com\/Hero-Image.png$/u);
  assert.deepEqual(bucket.keys(), [
    `tiny-agents-data/${agentId}/attachments/email/2026-06-19/image-message-example.com/Hero-Image.png`,
  ]);
  assert.match(event.message.text, /Hero Image\.png \(image\/png, 8 bytes\) -> \/workspace\/attachments\/email/u);
  assert.match(event.message.text, /upload_site_content/u);
});

test("email attachment persistence accepts camelCase adapter payloads", async () => {
  const bucket = new FakeR2Bucket();
  const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
  const env = { FLIGHT_WORKSPACE: bucket.r2 };
  const payload = {
    from: "Alex <alex@tinyfat.com>",
    to: "floopy@tinyfat.ai",
    subject: "Place this text",
    body: "Please upload this text file to the site content store.",
    messageId: "<text-message@example.com>",
    attachments: [{
      filename: "content marker.txt",
      contentType: "text/plain",
      contentBase64: Buffer.from("marker").toString("base64"),
    }],
  };

  const files = await persistEmailAttachments({
    env,
    agentId,
    payload,
    receivedAt: new Date("2026-06-19T12:00:00.000Z"),
  });
  const event = normalizeEmailEvent({
    agentId,
    toolsToken: "fat_tools_test",
    payload: withWorkspaceAttachmentPaths(payload, files),
    now: new Date("2026-06-19T12:00:00.000Z"),
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].contentType, "text/plain");
  assert.match(files[0].path, /\/content-marker\.txt$/u);
  assert.deepEqual(bucket.keys(), [
    `tiny-agents-data/${agentId}/attachments/email/2026-06-19/text-message-example.com/content-marker.txt`,
  ]);
  assert.match(event.message.text, /content marker\.txt \(text\/plain, 6 bytes\) -> \/workspace\/attachments\/email/u);
});
