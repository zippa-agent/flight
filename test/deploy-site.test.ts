import assert from "node:assert/strict";
import test from "node:test";
import { deploySiteFromWorkspace } from "../src/tools/deploy-site";
import { FakeR2Bucket } from "./support/fake-r2";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("deploy_site publishes a static workspace directory through sites publish", async () => {
  const bucket = new FakeR2Bucket();
  await bucket.r2.put(`tiny-agents-data/${agentId}/site/index.html`, "<h1>Hello</h1>");
  await bucket.r2.put(`tiny-agents-data/${agentId}/site/assets/app.css`, "body{color:#111}");

  let captured: {
    url?: string;
    headers?: Headers;
    body?: ArrayBuffer;
  } = {};

  const result = await deploySiteFromWorkspace({
    env: {
      FLIGHT_WORKSPACE: bucket.r2,
      SITES_PUBLISH_URL: "https://publish.test/api/sites",
    },
    ownerId: agentId,
    toolsToken: "fat_tools_test",
    request: {
      site: "mom-blog",
      path: "/workspace/site",
      environment: "preview",
      message: "QA deploy",
    },
    fetchImpl: async (url, init) => {
      captured = {
        url: String(url),
        headers: new Headers(init?.headers),
        body: init?.body as ArrayBuffer,
      };
      return Response.json({ url: "https://mom-blog.tinyfat.site" });
    },
  });

  assert.equal(captured.url, "https://publish.test/api/sites/mom-blog/deploy");
  assert.equal(captured.headers?.get("Authorization"), "Bearer fat_tools_test");
  assert.equal(captured.headers?.get("Content-Type"), "application/gzip");
  assert.equal(captured.headers?.get("X-Environment"), "preview");
  assert.equal(captured.headers?.get("X-Deploy-Message"), "QA deploy");
  assert.equal(new Uint8Array(captured.body || new ArrayBuffer(0))[0], 0x1f);
  assert.equal(new Uint8Array(captured.body || new ArrayBuffer(0))[1], 0x8b);
  assert.equal(result.ok, true);
  assert.equal(result.files, 2);
  assert.equal(result.site, "mom-blog");
});

test("deploy_site rejects an unbuilt app instead of pretending to build it", async () => {
  const bucket = new FakeR2Bucket();
  await bucket.r2.put(`tiny-agents-data/${agentId}/package.json`, "{\"scripts\":{\"build\":\"astro build\"}}");
  await bucket.r2.put(`tiny-agents-data/${agentId}/astro.config.mjs`, "export default {}");

  await assert.rejects(() => deploySiteFromWorkspace({
    env: {
      FLIGHT_WORKSPACE: bucket.r2,
      SITES_PUBLISH_URL: "https://publish.test/api/sites",
    },
    ownerId: agentId,
    toolsToken: "fat_tools_test",
    request: {
      site: "mom-blog",
    },
    fetchImpl: async () => {
      throw new Error("publish API should not be called");
    },
  }), /unbuilt app/u);
});
