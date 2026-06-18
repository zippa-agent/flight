import assert from "node:assert/strict";
import test from "node:test";
import { deploySiteFromWorkspace } from "../src/tools/deploy-site";
import { setSiteBinding } from "../src/tools/set-site-binding";
import { uploadSiteContent } from "../src/tools/upload-site-content";
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
  assert.equal(result.mode, "static");
  assert.equal(result.files, 2);
  assert.equal(result.site, "mom-blog");
});

test("deploy_site builds an unbuilt app in the container before publishing", async () => {
  const bucket = new FakeR2Bucket();
  await bucket.r2.put(`tiny-agents-data/${agentId}/package.json`, "{\"scripts\":{\"build\":\"astro build\"}}");
  await bucket.r2.put(`tiny-agents-data/${agentId}/astro.config.mjs`, "export default {}");
  await bucket.r2.put(`tiny-agents-data/${agentId}/src/pages/index.astro`, "<h1>Mom blog</h1>");

  let builtSourcePaths: string[] = [];
  let capturedBody: ArrayBuffer | undefined;

  const result = await deploySiteFromWorkspace({
    env: {
      FLIGHT_WORKSPACE: bucket.r2,
      SITES_PUBLISH_URL: "https://publish.test/api/sites",
      CRAWDAD_API_BASE: "https://crawdad.test",
      CRAWDAD_API_TOKEN: "fat_ops_test",
    },
    ownerId: agentId,
    toolsToken: "fat_tools_test",
    request: {
      site: "mom-blog",
      message: "Build deploy",
    },
    buildImpl: async (input) => {
      builtSourcePaths = input.sourceFiles.map((file) => file.path).sort();
      return {
        tarball: new Uint8Array([0x1f, 0x8b, 0x08]).buffer,
        command: "npm run build",
        outputPath: "dist",
        files: 1,
        bytes: 64,
        log: "built",
      };
    },
    fetchImpl: async (_url, init) => {
      capturedBody = init?.body as ArrayBuffer;
      return Response.json({ url: "https://main-mom-blog.tinyfat.dev/" });
    },
  });

  assert.deepEqual(builtSourcePaths, ["astro.config.mjs", "package.json", "src/pages/index.astro"]);
  assert.equal(new Uint8Array(capturedBody || new ArrayBuffer(0))[0], 0x1f);
  assert.equal(new Uint8Array(capturedBody || new ArrayBuffer(0))[1], 0x8b);
  assert.equal(result.mode, "built");
  assert.equal(result.files, 1);
  assert.equal(result.bytes, 64);
  assert.equal(result.build?.outputPath, "/workspace/dist");
});

test("set_site_binding provisions a site resource through sites publish", async () => {
  let captured: { url?: string; body?: Record<string, unknown>; headers?: Headers } = {};
  const result = await setSiteBinding({
    env: { SITES_PUBLISH_URL: "https://publish.test/api/sites" },
    toolsToken: "fat_tools_test",
    request: {
      site: "mom-blog",
      type: "r2",
      binding: "MEDIA",
      environment: "shared",
    },
    fetchImpl: async (url, init) => {
      captured = {
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ site: "mom-blog", resource: { type: "r2", binding: "MEDIA" } });
    },
  });

  assert.equal(captured.url, "https://publish.test/api/sites/mom-blog/resources");
  assert.equal(captured.headers?.get("Authorization"), "Bearer fat_tools_test");
  assert.deepEqual(captured.body, { type: "r2", binding: "MEDIA", environment: "shared" });
  assert.deepEqual(result, { site: "mom-blog", resource: { type: "r2", binding: "MEDIA" } });
});

test("upload_site_content uploads a workspace file through sites publish", async () => {
  const bucket = new FakeR2Bucket();
  await bucket.r2.put(`tiny-agents-data/${agentId}/content/posts.json`, JSON.stringify([{ title: "Hello" }]));

  let captured: { url?: string; body?: Record<string, unknown>; headers?: Headers } = {};
  const result = await uploadSiteContent({
    env: {
      FLIGHT_WORKSPACE: bucket.r2,
      SITES_PUBLISH_URL: "https://publish.test/api/sites",
    },
    ownerId: agentId,
    toolsToken: "fat_tools_test",
    request: {
      site: "mom-blog",
      key: "posts.json",
      source_path: "/workspace/content/posts.json",
      environment: "preview",
    },
    fetchImpl: async (url, init) => {
      captured = {
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      };
      return Response.json({ site: "mom-blog", key: "posts.json", url: "https://main-mom-blog.tinyfat.dev/__tinyfat/content/posts.json" });
    },
  });

  assert.equal(captured.url, "https://publish.test/api/sites/mom-blog/content");
  assert.equal(captured.headers?.get("Authorization"), "Bearer fat_tools_test");
  assert.equal(captured.body?.key, "posts.json");
  assert.equal(captured.body?.binding, "MEDIA");
  assert.equal(captured.body?.environment, "preview");
  assert.equal(captured.body?.contentType, "application/json; charset=utf-8");
  assert.equal(typeof captured.body?.contentBase64, "string");
  assert.equal(atob(String(captured.body?.contentBase64)), JSON.stringify([{ title: "Hello" }]));
  assert.deepEqual(result, {
    site: "mom-blog",
    key: "posts.json",
    url: "https://main-mom-blog.tinyfat.dev/__tinyfat/content/posts.json",
  });
});
