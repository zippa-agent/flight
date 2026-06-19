import assert from "node:assert/strict";
import test from "node:test";
import { getToolDetail, getToolTitle } from "../ui/src/toolDisplay";
import { reduceWebChatStreamEntry } from "../ui/src/webChatStream";
import type { AwarenessEntry } from "../ui/src/types";

test("tool display uses the model-provided label as the row title", () => {
  assert.equal(getToolTitle({
    type: "toolCall",
    id: "call-1",
    name: "browser_content",
    label: "Verify the uploaded public content marker.",
    arguments: {
      url: "https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/file.txt",
    },
  }), "Verify the uploaded public content marker.");
});

test("send_message detail previews Flight body text", () => {
  assert.equal(getToolDetail({
    type: "toolCall",
    id: "call-1",
    name: "send_message",
    label: "Reply to the active email thread.",
    arguments: {
      target: "email-thread:abc123def4567890",
      body: "I uploaded the files and verified the public content URL.",
    },
  }), "Email thread: I uploaded the files and verified the public content URL.");
});

test("web chat reducer preserves labels across partial tool call patches", () => {
  const entry: AwarenessEntry = {
    id: "assistant-1",
    type: "message",
    timestamp: "2026-06-19T15:00:00.000Z",
    role: "assistant",
    isStreaming: true,
    content: [],
  };

  const started = reduceWebChatStreamEntry(entry, {
    type: "toolcall_start",
    toolCall: {
      type: "toolCall",
      id: "call-1",
      name: "upload_site_content",
      label: "Publish the uploaded attachment into the site content store.",
      arguments: { label: "Publish the uploaded attachment into the site content store." },
    },
  });

  const updated = reduceWebChatStreamEntry(started, {
    type: "toolcall_delta",
    toolCall: {
      type: "toolCall",
      id: "call-1",
      name: "upload_site_content",
      arguments: {
        site: "floopy-payload-live",
        key: "qa/file.txt",
      },
    },
  });

  const block = updated?.content?.find((content) => content.type === "toolCall");
  assert.equal(block?.type, "toolCall");
  assert.equal(block?.label, "Publish the uploaded attachment into the site content store.");
  assert.deepEqual(block?.arguments, {
    label: "Publish the uploaded attachment into the site content store.",
    site: "floopy-payload-live",
    key: "qa/file.txt",
  });
});
