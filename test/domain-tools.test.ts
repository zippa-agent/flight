import assert from "node:assert/strict";
import test from "node:test";
import { dnsChangeApprove, dnsChangePlan, domainRoutePrepare, domainRouteStatus, prepareDomainOnboarding } from "../src/tools/domains";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--agent--d2Vi`;

test("domain_onboard_prepare uses the agent tools token and normalizes domains", async () => {
  const calls: Array<{ url: string; method?: string; auth?: string | null; body?: any }> = [];

  const result = await prepareDomainOnboarding({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service_role",
      DOMAIN_BROKER_URL: "https://domains.test",
    },
    instanceId,
    request: {
      domain: "https://Example.COM/path",
      site_tenant: "floopy-blog",
    },
    fetchImpl: async (url, init) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({
        url: String(url),
        method: init?.method,
        auth: new Headers(init?.headers).get("Authorization"),
        body: parsedBody,
      });
      if (String(url).startsWith("https://supabase.test/rest/v1/agents")) {
        return Response.json([{ id: agentId, tools_token: "fat_tools_test" }]);
      }
      return Response.json({
        ok: true,
        domain: "example.com",
        nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
      });
    },
  }) as Record<string, unknown>;

  assert.match(calls[0].url, /https:\/\/supabase\.test\/rest\/v1\/agents\?/u);
  assert.equal(calls[1].url, "https://domains.test/domains/onboard/prepare");
  assert.equal(calls[1].auth, "Bearer fat_tools_test");
  assert.deepEqual(calls[1].body, {
    domain: "example.com",
    siteTenant: "floopy-blog",
  });
  assert.equal(result.ok, true);
});

test("dns_change_plan sends a structured broker request", async () => {
  const calls: Array<{ url: string; body?: any }> = [];

  const result = await dnsChangePlan({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service_role",
    },
    instanceId,
    request: {
      domain: "example.com",
      summary: "Point www at Pages",
      changes: [{ op: "create", record: { type: "CNAME", name: "www", content: "target.example" } }],
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).startsWith("https://supabase.test/rest/v1/agents")) {
        return Response.json([{ id: agentId, tools_token: "fat_tools_test" }]);
      }
      return Response.json({ ok: true, changeSet: { id: "change-1", risk: "low" } });
    },
  }) as Record<string, unknown>;

  assert.equal(calls.at(-1)?.url, "https://domains.tinyfat.com/domains/example.com/changes/plan");
  assert.deepEqual(calls.at(-1)?.body, {
    summary: "Point www at Pages",
    changes: [{ op: "create", record: { type: "CNAME", name: "www", content: "target.example" } }],
  });
  assert.deepEqual(result, { ok: true, changeSet: { id: "change-1", risk: "low" } });
});

test("dns_change_approve records explicit approval with the broker", async () => {
  const calls: Array<{ url: string; body?: any }> = [];

  const result = await dnsChangeApprove({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service_role",
      DOMAIN_BROKER_URL: "https://domains.test",
    },
    instanceId,
    request: {
      domain: "Example.COM",
      change_set_id: "change-1",
      approval_note: "Alex explicitly confirmed applying the tinyfat.blog DNS alias plan.",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).startsWith("https://supabase.test/rest/v1/agents")) {
        return Response.json([{ id: agentId, tools_token: "fat_tools_test" }]);
      }
      return Response.json({ ok: true, changeSet: { id: "change-1", status: "planned" } });
    },
  }) as Record<string, unknown>;

  assert.equal(calls.at(-1)?.url, "https://domains.test/domains/example.com/changes/change-1/approve");
  assert.deepEqual(calls.at(-1)?.body, {
    approvalNote: "Alex explicitly confirmed applying the tinyfat.blog DNS alias plan.",
  });
  assert.deepEqual(result, { ok: true, changeSet: { id: "change-1", status: "planned" } });
});

test("domain_route_prepare sends Cloudflare for SaaS route intent", async () => {
  const calls: Array<{ url: string; body?: any }> = [];

  const result = await domainRoutePrepare({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service_role",
      DOMAIN_BROKER_URL: "https://domains.test",
    },
    instanceId,
    request: {
      domain: "tinyfat.blog",
      site_tenant: "main-flight-floopy-payload-blog-20260618",
      hostnames: ["tinyfat.blog", "www.tinyfat.blog"],
      include_www: true,
      primary_hostname: "tinyfat.blog",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).startsWith("https://supabase.test/rest/v1/agents")) {
        return Response.json([{ id: agentId, tools_token: "fat_tools_test" }]);
      }
      return Response.json({ ok: true, domain: "tinyfat.blog", routes: [] });
    },
  }) as Record<string, unknown>;

  assert.equal(calls.at(-1)?.url, "https://domains.test/domains/tinyfat.blog/routes/prepare");
  assert.deepEqual(calls.at(-1)?.body, {
    siteTenant: "main-flight-floopy-payload-blog-20260618",
    hostnames: ["tinyfat.blog", "www.tinyfat.blog"],
    includeWww: true,
    primaryHostname: "tinyfat.blog",
  });
  assert.deepEqual(result, { ok: true, domain: "tinyfat.blog", routes: [] });
});

test("domain_route_status forwards optional hostnames as query params", async () => {
  const calls: Array<{ url: string }> = [];

  const result = await domainRouteStatus({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service_role",
      DOMAIN_BROKER_URL: "https://domains.test",
    },
    instanceId,
    request: {
      domain: "tinyfat.blog",
      hostnames: ["tinyfat.blog", "www.tinyfat.blog"],
    },
    fetchImpl: async (url) => {
      calls.push({ url: String(url) });
      if (String(url).startsWith("https://supabase.test/rest/v1/agents")) {
        return Response.json([{ id: agentId, tools_token: "fat_tools_test" }]);
      }
      return Response.json({ ok: true, domain: "tinyfat.blog", routes: [] });
    },
  }) as Record<string, unknown>;

  assert.equal(
    calls.at(-1)?.url,
    "https://domains.test/domains/tinyfat.blog/routes/status?hostname=tinyfat.blog&hostname=www.tinyfat.blog",
  );
  assert.deepEqual(result, { ok: true, domain: "tinyfat.blog", routes: [] });
});
