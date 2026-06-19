import type { FlightTurnPayload } from "../adapters/types";

export interface ToolPolicy {
  allowSendMessage: boolean;
  allowFullBash: boolean;
}

export interface RuntimeContractInput {
  toolNames?: string[];
}

export function toolPolicyForTurn(turn: FlightTurnPayload | null): ToolPolicy {
  return {
    allowSendMessage: turn?.event.deliveryMode === "messages-only" && !!turn.event.replyTarget,
    allowFullBash: Boolean(turn?.toolPolicy.allowFullBash),
  };
}

export function contractText(policy: ToolPolicy, input: RuntimeContractInput = {}): string {
  const available = new Set(input.toolNames || []);
  const tools = [
    "Workspace files: /workspace is a durable R2-backed workspace scoped to the parent TinyFat agent UUID under tiny-agents/tiny-agents-data/<agent-uuid>/. It is not a /data mount.",
    "Generic bash: unavailable in the R2 workspace. Use file tools for workspace changes and a dedicated platform tool for build/deploy work when one is available.",
  ];

  if (available.has("set_site_binding")) {
    tools.push("set_site_binding: available for site runtime resources. Use it before deploy_site when a site needs Cloudflare R2, D1, or KV bindings.");
  }
  if (available.has("deploy_site")) {
    tools.push("deploy_site: available for website publishing from /workspace. It publishes static directories directly and builds npm/Astro projects in a temporary TinyFat container before deploy. Use mode \"worker\" for real framework runtimes. EmDash can deploy dist/server plus dist/client. Payload/OpenNext should deploy a Wrangler dry-run bundle containing worker.js, a wrangler.json with D1/R2 bindings plus vars.PAYLOAD_SECRET, and an assets/ directory copied from .open-next/assets. For Payload/D1 Worker builds, set the admin users collection to lockDocuments: false before building unless document locks have been explicitly tested.");
  }
  if (available.has("upload_site_content")) {
    tools.push("upload_site_content: available for uploading /workspace files or inline text into a deployed site's R2 content binding.");
  }
  if (available.has("browser_content")) {
    tools.push("browser_content: available for loading public http(s) pages through TinyFat's remote Browser Rendering API and returning rendered text and links. For TinyFat public content-store URLs, it can direct-fetch text as a fallback when browser rendering fails. It cannot access private networks, localhost, or logged-in browser sessions.");
  }

  tools.push(policy.allowSendMessage && available.has("send_message")
    ? "send_message: available for this turn. It is the only user-visible delivery path on this messages-only surface."
    : "No provider delivery tool is available for this turn.");
  tools.push(policy.allowFullBash && available.has("full_bash")
    ? "full_bash: available for this turn. It reaches the configured Crawdad-backed host container tool."
    : "No container-backed bash tool is available for this turn.");

  return [
    "Flight capability contract:",
    "- Identity: this beta runtime knows the TinyFat agent id and the active relationship scope. It does not yet load encrypted R2 BOOTSTRAP/IDENTITY/MEMORY files.",
    "- Awareness: Flight injects the scoped awareness tail supplied by the runner. Treat it as the durable relationship-local stream.",
    policy.allowSendMessage
      ? "- Delivery: direct browser surfaces receive ordinary assistant text. This messages-only turn has send_message for user-visible delivery."
      : "- Delivery: direct browser surfaces receive ordinary assistant text. No external provider delivery tool is registered for this turn.",
    "- Skills and autonomous lifecycle: not present in this beta runtime unless an explicit tool makes them available.",
    "- Tool honesty: do not mention or pretend to use a tool that is listed as unavailable.",
    "",
    "Available capability details:",
    ...tools.map((tool) => `- ${tool}`),
  ].join("\n");
}
