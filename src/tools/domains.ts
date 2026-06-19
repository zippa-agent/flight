import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";

const DomainInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
});

const DomainOnboardPrepareInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  site_tenant: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
});

const DnsChangePlanInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  summary: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1000))),
  changes: v.array(v.unknown()),
});

const DnsChangeApplyInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  change_set_id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
});

const DomainRoutePrepareInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  site_tenant: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  hostnames: v.optional(v.array(v.pipe(v.string(), v.minLength(3), v.maxLength(253)))),
  include_www: v.optional(v.boolean()),
  primary_hostname: v.optional(v.pipe(v.string(), v.minLength(3), v.maxLength(253))),
});

const DomainRouteStatusInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  hostnames: v.optional(v.array(v.pipe(v.string(), v.minLength(3), v.maxLength(253)))),
});

const DnsChangeApproveInput = v.object({
  domain: v.pipe(v.string(), v.minLength(3), v.maxLength(253)),
  change_set_id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  approval_note: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
});

type DomainInputValue = v.InferOutput<typeof DomainInput>;
type DomainOnboardPrepareInputValue = v.InferOutput<typeof DomainOnboardPrepareInput>;
type DnsChangePlanInputValue = v.InferOutput<typeof DnsChangePlanInput>;
type DnsChangeApplyInputValue = v.InferOutput<typeof DnsChangeApplyInput>;
type DomainRoutePrepareInputValue = v.InferOutput<typeof DomainRoutePrepareInput>;
type DomainRouteStatusInputValue = v.InferOutput<typeof DomainRouteStatusInput>;
type DnsChangeApproveInputValue = v.InferOutput<typeof DnsChangeApproveInput>;

export const DEFAULT_DOMAIN_BROKER_URL = "https://domains.tinyfat.com";

export function createDomainTools(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition[] {
  return [
    defineTool({
      name: "domain_list",
      description:
        "List domains this Flight agent can manage through TinyFat DNS custody. Use before DNS changes when you need to know what is already under management.",
      parameters: v.object({}),
      execute: async (_args, signal) => brokerJsonResult(await domainBrokerRequest({
        ...input,
        path: "/domains",
        method: "GET",
        signal,
      })),
    }),
    defineTool({
      name: "domain_onboard_prepare",
      description:
        "Prepare DNS custody for an existing customer-owned apex domain after the user has explicitly confirmed that domain. Creates or loads a Cloudflare DNS zone and returns nameserver instructions. This does not transfer registrar billing.",
      parameters: DomainOnboardPrepareInput,
      execute: async (args, signal) => brokerJsonResult(await prepareDomainOnboarding({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "domain_onboard_status",
      description:
        "Check whether a managed domain's Cloudflare zone is active after nameserver delegation.",
      parameters: DomainInput,
      execute: async (args, signal) => brokerJsonResult(await domainStatus({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "dns_records_list",
      description:
        "List DNS records for a TinyFat-managed domain before planning changes.",
      parameters: DomainInput,
      execute: async (args, signal) => brokerJsonResult(await dnsRecordsList({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "dns_snapshot_create",
      description:
        "Create a DNS snapshot for a TinyFat-managed domain before a risky change or as a manual checkpoint.",
      parameters: DomainInput,
      execute: async (args, signal) => brokerJsonResult(await dnsSnapshotCreate({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "dns_change_plan",
      description:
        "Plan DNS changes and receive a risk/approval decision. Provide changes as objects like {op:'create', record:{type,name,content,ttl?,proxied?}}, {op:'update', id, record:{...}}, or {op:'delete', id}.",
      parameters: DnsChangePlanInput,
      execute: async (args, signal) => brokerJsonResult(await dnsChangePlan({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "domain_route_prepare",
      description:
        "Prepare a production custom-domain route through TinyFat's Cloudflare for SaaS provider zone. Creates/loads custom hostnames, writes host routing, records site_domains state, and returns DNS-only CNAME/TXT changes for review before applying.",
      parameters: DomainRoutePrepareInput,
      execute: async (args, signal) => brokerJsonResult(await domainRoutePrepare({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "domain_route_preflight",
      description:
        "Check whether TinyFat's Cloudflare for SaaS provider zone is ready to create custom hostnames for a managed domain. Use before domain_route_prepare so quota/configuration blockers are reported clearly.",
      parameters: DomainInput,
      execute: async (args, signal) => brokerJsonResult(await domainRoutePreflight({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "domain_route_status",
      description:
        "Refresh and read Cloudflare for SaaS route status for a managed domain, including site_domains TLS/DNS state and host-map routing.",
      parameters: DomainRouteStatusInput,
      execute: async (args, signal) => brokerJsonResult(await domainRouteStatus({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "dns_change_apply",
      description:
        "Apply a previously planned DNS change set. High-risk mail/apex/delete changes must be explicitly approved first with dns_change_approve.",
      parameters: DnsChangeApplyInput,
      execute: async (args, signal) => brokerJsonResult(await dnsChangeApply({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "dns_change_approve",
      description:
        "Approve a high-risk DNS change set only after the user explicitly confirms the exact change. This records approval with the broker so dns_change_apply can proceed.",
      parameters: DnsChangeApproveInput,
      execute: async (args, signal) => brokerJsonResult(await dnsChangeApprove({
        ...input,
        request: args,
        signal,
      })),
    }),
    defineTool({
      name: "domain_export",
      description:
        "Export the current Cloudflare zone file for a TinyFat-managed domain, useful for portability or exit.",
      parameters: DomainInput,
      execute: async (args, signal) => brokerJsonResult(await domainExport({
        ...input,
        request: args,
        signal,
      })),
    }),
  ];
}

export async function prepareDomainOnboarding(input: {
  env: Env;
  instanceId: string;
  request: DomainOnboardPrepareInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: "/domains/onboard/prepare",
    method: "POST",
    body: {
      domain: normalizeDomain(input.request.domain),
      siteTenant: input.request.site_tenant,
    },
  });
}

export async function domainStatus(input: {
  env: Env;
  instanceId: string;
  request: DomainInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/status`,
    method: "GET",
  });
}

export async function dnsRecordsList(input: {
  env: Env;
  instanceId: string;
  request: DomainInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/records`,
    method: "GET",
  });
}

export async function dnsSnapshotCreate(input: {
  env: Env;
  instanceId: string;
  request: DomainInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/snapshots`,
    method: "POST",
  });
}

export async function dnsChangePlan(input: {
  env: Env;
  instanceId: string;
  request: DnsChangePlanInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/changes/plan`,
    method: "POST",
    body: {
      summary: input.request.summary,
      changes: input.request.changes,
    },
  });
}

export async function dnsChangeApply(input: {
  env: Env;
  instanceId: string;
  request: DnsChangeApplyInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/changes/${encodeURIComponent(input.request.change_set_id)}/apply`,
    method: "POST",
  });
}

export async function domainRoutePrepare(input: {
  env: Env;
  instanceId: string;
  request: DomainRoutePrepareInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/routes/prepare`,
    method: "POST",
    body: {
      siteTenant: input.request.site_tenant,
      hostnames: input.request.hostnames,
      includeWww: input.request.include_www,
      primaryHostname: input.request.primary_hostname,
    },
  });
}

export async function domainRoutePreflight(input: {
  env: Env;
  instanceId: string;
  request: DomainInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/routes/preflight`,
    method: "GET",
  });
}

export async function domainRouteStatus(input: {
  env: Env;
  instanceId: string;
  request: DomainRouteStatusInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const query = new URLSearchParams();
  for (const hostname of input.request.hostnames || []) query.append("hostname", hostname);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/routes/status${suffix}`,
    method: "GET",
  });
}

export async function dnsChangeApprove(input: {
  env: Env;
  instanceId: string;
  request: DnsChangeApproveInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/changes/${encodeURIComponent(input.request.change_set_id)}/approve`,
    method: "POST",
    body: {
      approvalNote: input.request.approval_note,
    },
  });
}

export async function domainExport(input: {
  env: Env;
  instanceId: string;
  request: DomainInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return domainBrokerRequest({
    ...input,
    path: `/domains/${encodeURIComponent(normalizeDomain(input.request.domain))}/export`,
    method: "POST",
  });
}

async function domainBrokerRequest(input: {
  env: Env;
  instanceId: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const { toolsToken } = await agentToolsTokenForDomain(input);
  const base = (input.env.DOMAIN_BROKER_URL || DEFAULT_DOMAIN_BROKER_URL).replace(/\/+$/u, "");
  const response = await (input.fetchImpl || globalThis.fetch.bind(globalThis))(`${base}${input.path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${toolsToken}`,
      "Content-Type": "application/json",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Domain broker request failed with HTTP ${response.status}`);
  }
  return parseResponse(text, response.headers.get("Content-Type") || "");
}

async function agentToolsTokenForDomain(input: {
  env: Env;
  instanceId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ownerId: string; toolsToken: string }> {
  const ownerId = workspaceOwnerIdFromInstanceId(input.instanceId);
  if (!input.env.SUPABASE_URL || !input.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Domain tools require Supabase service configuration to resolve the agent tools token.");
  }
  const base = input.env.SUPABASE_URL.replace(/\/+$/u, "");
  const path = `agents?id=eq.${encodeURIComponent(ownerId)}&select=id,tools_token&limit=1`;
  const response = await (input.fetchImpl || globalThis.fetch.bind(globalThis))(`${base}/rest/v1/${path}`, {
    headers: {
      apikey: input.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${input.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const rows = await response.json().catch(() => []) as Array<{ tools_token?: unknown }>;
  const toolsToken = typeof rows[0]?.tools_token === "string" ? rows[0].tools_token : "";
  if (!response.ok || !toolsToken) {
    throw new Error("Domain tools require the agent tools token.");
  }
  return { ownerId, toolsToken };
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/.*$/u, "").replace(/\.+$/u, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(domain)) {
    throw new Error(`Invalid apex domain: ${value}`);
  }
  return domain;
}

function parseResponse(text: string, contentType: string): unknown {
  if (!text) return {};
  if (contentType.toLowerCase().includes("application/json")) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}

function brokerJsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
