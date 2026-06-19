import type { ToolDefinition } from "@flue/runtime";
import type { FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { toolPolicyForTurn } from "../agent/contract";
import { createBrowserContentTool } from "./browser-content";
import { createDeploySiteTool } from "./deploy-site";
import { createFullBashTool } from "./full-bash";
import { createListChannelsTool } from "./list-channels";
import { createReadThreadTool } from "./read-thread";
import { createSendMessageTool } from "./send-message";
import { createSetSiteBindingTool } from "./set-site-binding";
import { createUploadSiteContentTool } from "./upload-site-content";

export function resolveTurnTools(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload | null;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const policy = toolPolicyForTurn(input.turn);

  if (input.env.FLIGHT_WORKSPACE) {
    tools.push(createSetSiteBindingTool({
      env: input.env,
      instanceId: input.instanceId,
    }));
    tools.push(createDeploySiteTool({
      env: input.env,
      instanceId: input.instanceId,
    }));
    tools.push(createUploadSiteContentTool({
      env: input.env,
      instanceId: input.instanceId,
    }));
  }

  if (input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN) {
    tools.push(createBrowserContentTool({
      env: input.env,
      instanceId: input.instanceId,
    }));
  }

  if (input.turn && policy.allowSendMessage) {
    if (input.env.FLIGHT_WORKSPACE && input.turn.event.adapter === "email") {
      tools.push(createListChannelsTool({
        env: input.env,
        agentId: input.turn.event.agentId,
      }));
      tools.push(createReadThreadTool({
        env: input.env,
        agentId: input.turn.event.agentId,
      }));
    }
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
    input.env.FLIGHT_WORKSPACE ? "set_site_binding" : null,
    input.env.FLIGHT_WORKSPACE ? "deploy_site" : null,
    input.env.FLIGHT_WORKSPACE ? "upload_site_content" : null,
    input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN ? "browser_content" : null,
    input.env.FLIGHT_WORKSPACE && input.turn?.event.adapter === "email" && policy.allowSendMessage
      ? "list_channels"
      : null,
    input.env.FLIGHT_WORKSPACE && input.turn?.event.adapter === "email" && policy.allowSendMessage
      ? "read_thread"
      : null,
    policy.allowSendMessage ? "send_message" : null,
    policy.allowFullBash && input.env.CRAWDAD_API_BASE && input.env.CRAWDAD_API_TOKEN ? "full_bash" : null,
  ].filter((name): name is string => !!name);
}
