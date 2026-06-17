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
    "Flue light bash: the default Flue virtual sandbox. It is an ephemeral scratch workspace, not Crawdad, not R2, and not /data.",
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
