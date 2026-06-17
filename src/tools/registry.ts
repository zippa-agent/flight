import type { ToolDefinition } from "@flue/runtime";
import type { FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { toolPolicyForTurn } from "../agent/contract";
import { createFullBashTool } from "./full-bash";
import { createSendMessageTool } from "./send-message";

export function resolveTurnTools(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload | null;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const policy = toolPolicyForTurn(input.turn);

  if (input.turn && policy.allowSendMessage) {
    tools.push(createSendMessageTool({
      env: input.env,
      instanceId: input.instanceId,
      turn: input.turn,
    }));
  }

  if (policy.allowFullBash && input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN) {
    tools.push(createFullBashTool({
      env: input.env,
      instanceId: input.instanceId,
    }));
  }

  return tools;
}

export function availableToolNames(input: {
  env: Env;
  turn: FlightTurnPayload | null;
}): string[] {
  const policy = toolPolicyForTurn(input.turn);
  return [
    policy.allowSendMessage ? "send_message" : null,
    policy.allowFullBash && input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN ? "full_bash" : null,
  ].filter((name): name is string => !!name);
}
