import type { FlightTurnPayload } from "../adapters/types";

export interface ToolPolicy {
  allowSendMessage: boolean;
  allowFullBash: boolean;
  allowYieldNoAction?: boolean;
}

export interface RuntimeContractInput {
  toolNames?: string[];
}

export function toolPolicyForTurn(turn: FlightTurnPayload | null): ToolPolicy {
  return {
    allowSendMessage: turn?.event.deliveryMode === "messages-only" && !!turn.event.replyTarget,
    allowFullBash: Boolean(turn?.toolPolicy.allowFullBash),
    allowYieldNoAction: Boolean(turn?.toolPolicy.allowYieldNoAction),
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
  if (available.has("search_tools")) {
    tools.push("search_tools: available for finding exact Flight tool names by capability, category, risk, and description. Use it when unsure which browser, site, domain/DNS, conversation, or runtime tool fits a task.");
  }
  if (available.has("browser_content")) {
    tools.push("browser_content: available for loading public http(s) pages through TinyFat's remote Browser Rendering API and returning rendered text and links. For TinyFat public content-store URLs, it can direct-fetch text as a fallback when browser rendering fails. It cannot access private networks, localhost, or logged-in browser sessions.");
  }
  if (available.has("browser_screenshot")) {
    tools.push("browser_screenshot: available for capturing a public page screenshot. It stores the image under /workspace/browser-artifacts and returns artifact metadata instead of large base64.");
  }
  if (available.has("browser_pdf")) {
    tools.push("browser_pdf: available for rendering a public page to PDF. It stores the PDF under /workspace/browser-artifacts and returns artifact metadata.");
  }
  if (available.has("browser_evaluate")) {
    tools.push("browser_evaluate: available for structured DOM/page inspection on a public URL with a JSON-serializable JavaScript expression.");
  }
  if (available.has("browser_session")) {
    tools.push("browser_session: available for short-lived persistent public-browser sessions with start/status/nav/content/evaluate/screenshot/pdf/close actions. Binary artifacts are saved under /workspace/browser-artifacts.");
  }
  if (available.has("domain_list")) {
    tools.push("Domain/DNS tools: available for managed-domain listing, onboarding preparation, status, record listing, snapshots, change planning, explicit approval, apply, and export. Use search_tools with category \"domain\" for exact names. Never pick, onboard, or approve high-risk DNS changes without explicit user confirmation.");
  }
  if (available.has("list_channels")) {
    tools.push("list_channels: available for messages-only turns with durable conversation ledgers. It lists exact email-thread:<id> and slack:<channel_id>:<thread_ts> targets when known.");
  }
  if (available.has("read_thread")) {
    tools.push("read_thread: available for reading a known email-thread:<id>, slack:<channel_id>:<thread_ts>, or slack:<channel_id> target before choosing where to send a reply.");
  }
  if (policy.allowYieldNoAction && available.has("yield_no_action")) {
    tools.push("yield_no_action: available for ambient or passive turns only. Use it when you were not directly addressed and have nothing useful to add; it records a quiet no-op without sending a user-visible message.");
  }

  tools.push(policy.allowSendMessage && available.has("send_message")
    ? "send_message: available for this turn. It is the only user-visible delivery path on this messages-only surface. Email targets use email-thread:<id>; Slack thread targets use slack:<channel_id>:<thread_ts>, and top-level Slack sends use slack:<channel_id>."
    : "No provider delivery tool is available for this turn.");
  tools.push(policy.allowFullBash && available.has("full_bash")
    ? "full_bash: available for this turn. It reaches the configured Crawdad-backed host container tool."
    : "No container-backed bash tool is available for this turn.");

  return [
    "Flight capability contract:",
    "- Identity: Flight loads available /workspace BOOTSTRAP, AGENTS, IDENTITY, SOUL, USER, MEMORY, BRIEF, and recent daily memory files for the parent TinyFat agent before each turn.",
    "- Awareness: Flight injects the scoped awareness tail supplied by the runner. Treat it as the durable relationship-local stream.",
    policy.allowSendMessage
      ? "- Delivery: direct browser surfaces receive ordinary assistant text. This messages-only turn has send_message for user-visible delivery."
      : "- Delivery: direct browser surfaces receive ordinary assistant text. No external provider delivery tool is registered for this turn.",
    "- Skills and autonomous lifecycle: not present in this beta runtime unless an explicit tool makes them available.",
    "- Tool labels: every tool call must include a required label argument with a concise user-facing one-sentence description of what the tool call is doing. Flight rejects tool calls that omit this label.",
    "- Tool honesty: do not mention or pretend to use a tool that is listed as unavailable.",
    "",
    "Available capability details:",
    ...tools.map((tool) => `- ${tool}`),
  ].join("\n");
}
