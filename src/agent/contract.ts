import type { FlightTurnPayload } from "../adapters/types";

export interface ToolPolicy {
  allowSendMessage: boolean;
  allowFullBash: boolean;
}

export function toolPolicyForTurn(turn: FlightTurnPayload | null): ToolPolicy {
  return {
    allowSendMessage: turn?.event.deliveryMode === "messages-only" && !!turn.event.replyTarget,
    allowFullBash: Boolean(turn?.toolPolicy.allowFullBash),
  };
}

export function contractText(policy: ToolPolicy): string {
  const tools = [
    "Workspace files: /workspace is a durable R2-backed workspace scoped to the parent TinyFat agent UUID under tiny-agents/tiny-agents-data/<agent-uuid>/. It is not a /data mount.",
    "Generic bash: unavailable in the R2 workspace. Use file tools for workspace changes and a dedicated platform tool for build/deploy work when one is available.",
    "deploy_site: available for static site publishing from /workspace. It deploys an already-built directory with index.html; it does not run npm install or Astro builds.",
    policy.allowSendMessage
      ? "send_message: available for this turn. It is the only user-visible delivery path on this messages-only surface."
      : "No provider delivery tool is available for this turn.",
    policy.allowFullBash
      ? "full_bash: available for this turn. It reaches the configured Crawdad-backed host container tool."
      : "No container-backed bash tool is available for this turn.",
  ];

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
