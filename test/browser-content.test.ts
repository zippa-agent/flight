import assert from "node:assert/strict";
import test from "node:test";
import { fetchBrowserContent } from "../src/tools/browser-content";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--agent--d2Vi`;
const env = {
  CRAWDAD_API_BASE: "https://crawdad.test",
  CRAWDAD_API_TOKEN: "fat_ops_test",
};

test("browser_content returns Crawdad rendered content when the browser succeeds", async () => {
  const calls: string[] = [];

  const result = await fetchBrowserContent({
    env,
    instanceId,
    request: { url: "https://example.com/" },
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fat_ops_test");
      return Response.json({
        ok: true,
        action: "content",
        url: "https://example.com/",
        title: "Example",
        text: "Example page",
        links: [],
      });
    },
  }) as Record<string, unknown>;

  assert.equal(calls.length, 1);
  assert.equal(result.title, "Example");
  assert.equal(result.text, "Example page");
});

test("browser_content binds global fetch when no test fetch is injected", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async function fetchWithReceiverCheck(this: unknown, url) {
    assert.equal(this, globalThis);
    calls.push(String(url));
    return Response.json({
      ok: true,
      action: "content",
      url: "https://example.com/",
      title: "Example",
      text: "bound fetch",
      links: [],
    });
  }) as typeof fetch;

  try {
    const result = await fetchBrowserContent({
      env,
      instanceId,
      request: { url: "https://example.com/" },
    }) as Record<string, unknown>;

    assert.equal(calls.length, 1);
    assert.equal(result.text, "bound fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser_content falls back to direct text fetch for TinyFat content-store objects", async () => {
  const target = "https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/floopy-dashboard-upload-20260619.txt";
  const marker = "DASHBOARD_UPLOAD_MARKER_20260619_FLIGHT";
  const calls: string[] = [];

  const result = await fetchBrowserContent({
    env,
    instanceId,
    request: { url: target },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/browser/content")) {
        return Response.json(
          { ok: false, error: "browser_action_failed", error_description: "download refused" },
          { status: 500 },
        );
      }
      if (String(url) === target) {
        return new Response(`${marker}\n`, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(marker.length + 1),
          },
        });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    },
  }) as Record<string, unknown>;

  assert.deepEqual(calls, [
    `https://crawdad.test/api/v2/agents/${agentId}/browser/content`,
    target,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.action, "content");
  assert.equal(result.mode, "direct_text_fallback");
  assert.equal(result.url, target);
  assert.match(String(result.text), /DASHBOARD_UPLOAD_MARKER_20260619_FLIGHT/u);
  assert.match(String(result.fallbackReason), /browser_action_failed/u);
});

test("browser_content does not direct-fetch non-TinyFat URLs after a browser failure", async () => {
  const calls: string[] = [];

  await assert.rejects(
    fetchBrowserContent({
      env,
      instanceId,
      request: { url: "https://example.com/file.txt" },
      fetchImpl: async (url) => {
        calls.push(String(url));
        return Response.json(
          { ok: false, error: "browser_action_failed", error_description: "renderer failed" },
          { status: 500 },
        );
      },
    }),
    /browser_action_failed/u,
  );

  assert.deepEqual(calls, [`https://crawdad.test/api/v2/agents/${agentId}/browser/content`]);
});

test("browser_content rejects binary TinyFat fallback responses", async () => {
  const target = "https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/image.bin";

  await assert.rejects(
    fetchBrowserContent({
      env,
      instanceId,
      request: { url: target },
      fetchImpl: async (url) => {
        if (String(url).includes("/browser/content")) {
          return Response.json(
            { ok: false, error: "browser_action_failed", error_description: "download refused" },
            { status: 500 },
          );
        }
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        });
      },
    }),
    /direct fallback only supports text-like responses/u,
  );
});
