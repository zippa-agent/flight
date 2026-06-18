import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplyThreadHeaders,
  compileReferences,
  composeEmailReplyBody,
  normalizeEmailEvent,
  normalizeMessageIdForHeader,
  parseReferencesHeader,
  stripQuotedEmailText,
} from "../src/adapters/email";

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
