import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { toolPolicyForTurn } from "../agent/contract";
import {
  createBrowserEvaluateTool,
  createBrowserPdfTool,
  createBrowserScreenshotTool,
  createBrowserSessionTool,
} from "./browser-actions";
import { createBrowserContentTool } from "./browser-content";
import { createDeploySiteTool } from "./deploy-site";
import { createDomainTools } from "./domains";
import { createFullBashTool } from "./full-bash";
import { createListChannelsTool } from "./list-channels";
import { createReadThreadTool } from "./read-thread";
import { createSendMessageTool } from "./send-message";
import { createSetSiteBindingTool } from "./set-site-binding";
import { createUploadSiteContentTool } from "./upload-site-content";
import { createYieldNoActionTool } from "./yield-no-action";

export type ToolCategory =
  | "discovery"
  | "site"
  | "browser"
  | "domain"
  | "conversation"
  | "runtime";

export interface ToolCatalogEntry {
  name: string;
  category: ToolCategory;
  description: string;
  promptDetail?: string;
  keywords?: string[];
  risk?: "read" | "write" | "external-change";
  core?: boolean;
  available: boolean;
  create?: () => ToolDefinition;
}

export interface ToolCatalogInput {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload | null;
}

const SearchToolsInput = v.object({
  query: v.optional(v.pipe(v.string(), v.maxLength(500))),
  category: v.optional(v.union([
    v.literal("discovery"),
    v.literal("site"),
    v.literal("browser"),
    v.literal("domain"),
    v.literal("conversation"),
    v.literal("runtime"),
  ])),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50))),
  include_unavailable: v.optional(v.boolean()),
});

export function buildToolCatalog(input: ToolCatalogInput): ToolCatalogEntry[] {
  const policy = toolPolicyForTurn(input.turn);
  const browserAvailable = !!(input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN);
  const workspaceAvailable = !!input.env.FLIGHT_WORKSPACE;
  const conversationAvailable = !!(input.turn && policy.allowSendMessage);
  const threadedConversationAvailable = workspaceAvailable && supportsConversationTools(input.turn?.event.adapter) && conversationAvailable;
  const domainsAvailable = workspaceAvailable && hasSupabaseForAgentTools(input.env);

  return [
    {
      name: "search_tools",
      category: "discovery",
      description:
        "Search the Flight tool catalog by capability, category, or tool name and return exact callable tool names with safety notes.",
      promptDetail:
        "search_tools: use this when you are unsure which Flight tool fits a task, or when looking for browser, DNS/domain, site, conversation, or runtime capabilities.",
      keywords: ["tool search", "catalog", "capabilities", "discover"],
      risk: "read",
      core: true,
      available: true,
      create: () => createSearchToolsTool(() => buildToolCatalog(input)),
    },
    {
      name: "set_site_binding",
      category: "site",
      description:
        "Configure a TinyFat site runtime binding such as R2, D1, or KV before deploying a site that needs platform resources.",
      promptDetail:
        "set_site_binding: configure site runtime resources such as R2, D1, or KV before deploy_site when needed.",
      keywords: ["site", "binding", "r2", "d1", "kv", "cloudflare"],
      risk: "external-change",
      available: workspaceAvailable,
      create: () => createSetSiteBindingTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "deploy_site",
      category: "site",
      description:
        "Deploy a static or worker-backed website from /workspace to TinyFat Sites, with optional container build support.",
      promptDetail:
        "deploy_site: publish a website from /workspace to TinyFat Sites; static sites deploy directly and buildable apps can use the container build path.",
      keywords: ["site", "deploy", "publish", "website", "astro", "payload", "worker"],
      risk: "external-change",
      available: workspaceAvailable,
      create: () => createDeploySiteTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "upload_site_content",
      category: "site",
      description:
        "Upload inline text or a /workspace file into a deployed site's R2 content binding.",
      promptDetail:
        "upload_site_content: upload /workspace files or inline text into a deployed site's R2 content store.",
      keywords: ["content", "upload", "r2", "media", "site"],
      risk: "external-change",
      available: workspaceAvailable,
      create: () => createUploadSiteContentTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "browser_content",
      category: "browser",
      description:
        "Load a public URL through TinyFat's remote browser and return rendered title, visible text, and links.",
      promptDetail:
        "browser_content: inspect public http(s) pages as rendered text and links; TinyFat public content URLs can direct-fetch text as fallback.",
      keywords: ["browser", "content", "text", "links", "inspect", "page"],
      risk: "read",
      available: browserAvailable,
      create: () => createBrowserContentTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "browser_screenshot",
      category: "browser",
      description:
        "Capture a public URL screenshot and save the image to /workspace/browser-artifacts.",
      promptDetail:
        "browser_screenshot: capture public-page screenshots and save image artifacts under /workspace/browser-artifacts.",
      keywords: ["browser", "screenshot", "image", "visual", "page"],
      risk: "read",
      available: browserAvailable && workspaceAvailable,
      create: () => createBrowserScreenshotTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "browser_pdf",
      category: "browser",
      description:
        "Render a public URL to PDF and save the artifact to /workspace/browser-artifacts.",
      promptDetail:
        "browser_pdf: render public pages to PDF and save artifacts under /workspace/browser-artifacts.",
      keywords: ["browser", "pdf", "print", "render", "page"],
      risk: "read",
      available: browserAvailable && workspaceAvailable,
      create: () => createBrowserPdfTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "browser_evaluate",
      category: "browser",
      description:
        "Load a public URL and evaluate a JSON-serializable JavaScript expression in page context.",
      promptDetail:
        "browser_evaluate: inspect structured DOM/page state with JavaScript when browser_content is too coarse.",
      keywords: ["browser", "evaluate", "javascript", "dom", "forms", "metadata"],
      risk: "read",
      available: browserAvailable,
      create: () => createBrowserEvaluateTool({ env: input.env, instanceId: input.instanceId }),
    },
    {
      name: "browser_session",
      category: "browser",
      description:
        "Operate a short-lived persistent browser session for public sites: start, status, nav, content, evaluate, screenshot, pdf, close.",
      promptDetail:
        "browser_session: use for multi-step public-page inspection where navigation state matters; actions include start/status/nav/content/evaluate/screenshot/pdf/close.",
      keywords: ["browser", "session", "navigate", "multi-step", "state", "screenshot", "pdf"],
      risk: "read",
      available: browserAvailable && workspaceAvailable,
      create: () => createBrowserSessionTool({ env: input.env, instanceId: input.instanceId }),
    },
    ...createDomainCatalogEntries(input, domainsAvailable),
    {
      name: "list_channels",
      category: "conversation",
      description:
        "List durable email and Slack conversation targets known in this relationship scope.",
      promptDetail:
        "list_channels: list exact email-thread:<id> and slack:<channel_id>:<thread_ts> targets when known.",
      keywords: ["conversation", "email", "slack", "channels", "threads"],
      risk: "read",
      available: threadedConversationAvailable,
      create: () => createListChannelsTool({ env: input.env, agentId: input.turn?.event.agentId || "" }),
    },
    {
      name: "read_thread",
      category: "conversation",
      description:
        "Read a known email or Slack thread target before deciding where or how to reply.",
      promptDetail:
        "read_thread: read a known email-thread:<id>, slack:<channel_id>:<thread_ts>, or slack:<channel_id> target.",
      keywords: ["conversation", "thread", "email", "slack", "history"],
      risk: "read",
      available: threadedConversationAvailable,
      create: () => createReadThreadTool({ env: input.env, agentId: input.turn?.event.agentId || "" }),
    },
    {
      name: "send_message",
      category: "conversation",
      description:
        "Send the user-visible reply for an active messages-only email or Slack turn.",
      promptDetail:
        "send_message: the only user-visible delivery path on messages-only surfaces; email targets use email-thread:<id>, Slack targets use slack:<channel_id> or slack:<channel_id>:<thread_ts>.",
      keywords: ["conversation", "send", "reply", "email", "slack"],
      risk: "external-change",
      available: conversationAvailable,
      create: () => {
        if (!input.turn) throw new Error("send_message requires a turn.");
        return createSendMessageTool({ env: input.env, instanceId: input.instanceId, turn: input.turn });
      },
    },
    {
      name: "yield_no_action",
      category: "conversation",
      description:
        "Record an intentional quiet no-op for ambient/passive turns where the agent has nothing useful to add.",
      promptDetail:
        "yield_no_action: available only for ambient/passive turns; use it instead of sending a message when not directly addressed and there is nothing useful to add.",
      keywords: ["ambient", "passive", "no action", "quiet"],
      risk: "read",
      available: !!(input.turn && policy.allowYieldNoAction),
      create: () => createYieldNoActionTool(),
    },
    {
      name: "full_bash",
      category: "runtime",
      description:
        "Execute bash in the configured Crawdad-backed host container when the lightweight R2 workspace is insufficient.",
      promptDetail:
        "full_bash: container-backed bash for turns explicitly allowed to use it; prefer dedicated tools and /workspace file operations when possible.",
      keywords: ["bash", "container", "runtime", "shell", "command"],
      risk: "external-change",
      available: !!(policy.allowFullBash && browserAvailable),
      create: () => createFullBashTool({ env: input.env, instanceId: input.instanceId }),
    },
  ];
}

export function availableToolCatalog(input: ToolCatalogInput): ToolCatalogEntry[] {
  return buildToolCatalog(input).filter((entry) => entry.available);
}

export function createSearchToolsTool(getCatalog: () => ToolCatalogEntry[]): ToolDefinition {
  return defineTool({
    name: "search_tools",
    description:
      "Search the Flight tool catalog. Returns exact callable tool names, categories, descriptions, risk notes, and availability. Use when selecting between site, browser, domain/DNS, conversation, and runtime tools.",
    parameters: SearchToolsInput,
    execute: async (args) => {
      const query = args.query?.trim() || "";
      const limit = normalizeLimit(args.limit);
      const includeUnavailable = args.include_unavailable === true;
      const category = args.category;
      const matches = getCatalog()
        .filter((entry) => includeUnavailable || entry.available)
        .filter((entry) => !category || entry.category === category)
        .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
        .slice(0, limit)
        .map(({ entry }) => serializeEntry(entry));

      return JSON.stringify({
        ok: true,
        query,
        category: category || null,
        tools: matches,
        note: "Returned available tools are already callable in this Flight turn; call the exact tool name with its required label argument.",
      }, null, 2);
    },
  });
}

function createDomainCatalogEntries(input: ToolCatalogInput, available: boolean): ToolCatalogEntry[] {
  const tools = createDomainTools({ env: input.env, instanceId: input.instanceId });
  const descriptions: Record<string, string> = {
    domain_list: "List domains this agent can manage through TinyFat DNS custody.",
    domain_onboard_prepare: "Prepare DNS custody for a user-confirmed customer-owned domain and return nameserver instructions.",
    domain_onboard_status: "Check Cloudflare zone activation status after nameserver delegation.",
    dns_records_list: "List DNS records for a TinyFat-managed domain.",
    dns_snapshot_create: "Create a DNS snapshot before a risky change or manual checkpoint.",
    dns_change_plan: "Plan DNS record changes and receive risk/approval status.",
    domain_route_preflight: "Check Cloudflare for SaaS provider readiness before custom-hostname routing.",
    domain_route_prepare: "Prepare Cloudflare for SaaS custom-hostname routing and return reviewable DNS changes.",
    domain_route_status: "Refresh and read custom-domain TLS/DNS route status.",
    dns_change_approve: "Approve a high-risk DNS change set after explicit user confirmation.",
    dns_change_apply: "Apply a previously planned and, if needed, approved DNS change set.",
    domain_export: "Export the current Cloudflare zone file for portability or exit.",
  };
  const risks: Record<string, ToolCatalogEntry["risk"]> = {
    domain_list: "read",
    domain_onboard_status: "read",
    dns_records_list: "read",
    domain_route_preflight: "read",
    domain_route_status: "read",
    domain_export: "read",
    domain_onboard_prepare: "external-change",
    dns_snapshot_create: "external-change",
    dns_change_plan: "external-change",
    domain_route_prepare: "external-change",
    dns_change_approve: "external-change",
    dns_change_apply: "external-change",
  };
  return tools.map((tool) => ({
    name: tool.name,
    category: "domain" as const,
    description: descriptions[tool.name] || tool.description,
    promptDetail: `${tool.name}: ${descriptions[tool.name] || tool.description}`,
    keywords: ["domain", "dns", "cloudflare", "nameserver", "records", tool.name],
    risk: risks[tool.name] || "external-change",
    available,
    create: () => tool,
  }));
}

function serializeEntry(entry: ToolCatalogEntry): Record<string, unknown> {
  return {
    name: entry.name,
    category: entry.category,
    description: entry.description,
    risk: entry.risk || "read",
    available: entry.available,
    core: entry.core === true,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 8;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function scoreEntry(entry: ToolCatalogEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return entry.core ? 50 : 10;
  const name = entry.name.toLowerCase();
  const haystack = [
    entry.name,
    entry.category,
    entry.description,
    entry.promptDetail || "",
    ...(entry.keywords || []),
  ].join("\n").toLowerCase();
  const terms = q.split(/\s+/u).filter(Boolean);
  let score = 0;
  if (name === q) score += 100;
  if (name.includes(q)) score += 50;
  if (haystack.includes(q)) score += 20;
  for (const term of terms) {
    if (name.includes(term)) score += 12;
    if (haystack.includes(term)) score += 5;
  }
  return score;
}

function supportsConversationTools(adapter: string | undefined): boolean {
  return adapter === "email" || adapter === "slack";
}

function hasSupabaseForAgentTools(env: Env): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
