import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserEvaluate, runBrowserScreenshot, runBrowserSession } from "../src/tools/browser-actions";
import { FakeR2Bucket } from "./support/fake-r2";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--agent--d2Vi`;

test("browser_screenshot stores Crawdad base64 artifacts in the Flight workspace", async () => {
  const bucket = new FakeR2Bucket();
  const payload = btoa("fake-png");
  const seen: { url?: string; body?: any; auth?: string | null } = {};

  const result = await runBrowserScreenshot({
    env: {
      CRAWDAD_API_BASE: "https://crawdad.test",
      CRAWDAD_API_TOKEN: "fat_ops_test",
      FLIGHT_WORKSPACE: bucket.r2,
    },
    instanceId,
    request: {
      url: "https://example.com/",
      full_page: true,
      save_path: "/workspace/browser-artifacts/example.png",
    },
    fetchImpl: async (url, init) => {
      seen.url = String(url);
      seen.auth = new Headers(init?.headers).get("Authorization");
      seen.body = JSON.parse(String(init?.body));
      return Response.json({
        ok: true,
        action: "screenshot",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/png",
        dataBase64: payload,
      });
    },
  });

  assert.equal(seen.url, `https://crawdad.test/api/v2/agents/${agentId}/browser/screenshot`);
  assert.equal(seen.auth, "Bearer fat_ops_test");
  assert.equal(seen.body.fullPage, true);
  assert.equal((result.artifact as any).path, "/workspace/browser-artifacts/example.png");
  assert.equal((result.artifact as any).bytes, "fake-png".length);
  assert.equal("dataBase64" in result, false);
  assert.deepEqual(bucket.keys(), [`tiny-agents-data/${agentId}/browser-artifacts/example.png`]);
});

test("browser_evaluate posts a structured stateless browser request", async () => {
  const result = await runBrowserEvaluate({
    env: {
      CRAWDAD_API_BASE: "https://crawdad.test/",
      CRAWDAD_API_TOKEN: "fat_ops_test",
    },
    instanceId,
    request: {
      url: "https://example.com/",
      expression: "() => document.title",
      wait_until: "networkidle2",
      timeout_ms: 5000,
    },
    fetchImpl: async (url, init) => {
      assert.equal(String(url), `https://crawdad.test/api/v2/agents/${agentId}/browser/evaluate`);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        url: "https://example.com/",
        expression: "() => document.title",
        waitUntil: "networkidle2",
        timeoutMs: 5000,
      });
      return Response.json({
        ok: true,
        action: "evaluate",
        url: "https://example.com/",
        title: "Example",
        result: "Example",
      });
    },
  }) as Record<string, unknown>;

  assert.equal(result.result, "Example");
});

test("browser_session routes persistent actions and stores binary artifacts", async () => {
  const bucket = new FakeR2Bucket();

  const result = await runBrowserSession({
    env: {
      CRAWDAD_API_BASE: "https://crawdad.test",
      CRAWDAD_API_TOKEN: "fat_ops_test",
      FLIGHT_WORKSPACE: bucket.r2,
    },
    instanceId,
    request: {
      action: "screenshot",
      type: "webp",
      save_path: "/workspace/browser-artifacts/session.webp",
    },
    fetchImpl: async (url, init) => {
      assert.equal(String(url), `https://crawdad.test/api/v2/agents/${agentId}/browser/session/screenshot`);
      assert.deepEqual(JSON.parse(String(init?.body)), { type: "webp" });
      return Response.json({
        ok: true,
        action: "screenshot",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/webp",
        dataBase64: btoa("fake-webp"),
        session: { activeUrl: "https://example.com/" },
      });
    },
  }) as Record<string, unknown>;

  assert.equal((result.artifact as any).path, "/workspace/browser-artifacts/session.webp");
  assert.equal("dataBase64" in result, false);
  assert.deepEqual(bucket.keys(), [`tiny-agents-data/${agentId}/browser-artifacts/session.webp`]);
});
