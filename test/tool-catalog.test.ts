import assert from "node:assert/strict";
import test from "node:test";
import { availableToolCatalog, buildToolCatalog, createSearchToolsTool } from "../src/tools/catalog";
import { availableToolNames, resolveTurnTools } from "../src/tools/registry";
import type { Env } from "../src/env";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--agent--d2Vi`;

test("search_tools is always available and can discover browser tools", async () => {
  const env: Env = {
    CRAWDAD_API_BASE: "https://crawdad.test",
    CRAWDAD_API_TOKEN: "fat_ops_test",
    FLIGHT_WORKSPACE: {} as R2Bucket,
  };
  const catalog = availableToolCatalog({ env, instanceId, turn: null });

  assert(catalog.some((entry) => entry.name === "search_tools"));
  assert(catalog.some((entry) => entry.name === "browser_session"));

  const search = createSearchToolsTool(() => buildToolCatalog({ env, instanceId, turn: null }));
  const result = await search.execute({ query: "browser screenshot session", limit: 3 } as never, undefined as never);
  const data = JSON.parse(String(result));
  const names = data.tools.map((tool: { name: string }) => tool.name);

  assert(names.includes("browser_screenshot"));
  assert(names.includes("browser_session"));
});

test("registry resolves catalog-backed browser and domain tools", () => {
  const env: Env = {
    CRAWDAD_API_BASE: "https://crawdad.test",
    CRAWDAD_API_TOKEN: "fat_ops_test",
    FLIGHT_WORKSPACE: {} as R2Bucket,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service_role",
  };

  assert.deepEqual(availableToolNames({ env, turn: null }).sort(), [
    "browser_content",
    "browser_evaluate",
    "browser_pdf",
    "browser_screenshot",
    "browser_session",
    "deploy_site",
    "dns_change_apply",
    "dns_change_approve",
    "dns_change_plan",
    "dns_records_list",
    "dns_snapshot_create",
    "domain_export",
    "domain_list",
    "domain_onboard_prepare",
    "domain_onboard_status",
    "search_tools",
    "set_site_binding",
    "upload_site_content",
  ].sort());

  const tools = resolveTurnTools({ env, instanceId, turn: null });
  assert(tools.some((tool) => tool.name === "browser_session"));
  assert(tools.some((tool) => tool.name === "domain_onboard_prepare"));
});
