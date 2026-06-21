import { registerProvider } from "@flue/runtime";
import type { Env } from "../env";
import { fetchAgentRuntimeRecord } from "./supabase";
import { parentAgentIdFromInstanceId } from "../awareness/id";

export const DEFAULT_FIREWORKS_MODEL = "fireworks/accounts/fireworks/models/glm-5p2";
const DEFAULT_FIREWORKS_PROXY_BASE = "https://tinyfat.com/api/fireworks";

const FIREWORKS_MODEL_LIMITS: Record<string, { contextWindow: number; maxTokens: number }> = {
  "accounts/fireworks/models/glm-5p2": {
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
};

function stableProviderId(agentId: string): string {
  return `tf-fireworks-${agentId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

function isFireworksModel(model: string): boolean {
  return model.startsWith("fireworks/") && model.length > "fireworks/".length;
}

export function fireworksModelId(model: string): string | null {
  return isFireworksModel(model) ? model.slice("fireworks/".length) : null;
}

export function fireworksModelLimits(modelId: string): { contextWindow: number; maxTokens: number } {
  return FIREWORKS_MODEL_LIMITS[modelId] || {
    contextWindow: 200_000,
    maxTokens: 32_000,
  };
}

export async function resolveTinyFatModel(env: Env, instanceId: string): Promise<string> {
  const requested = env.TINYFAT_MODEL?.trim() || DEFAULT_FIREWORKS_MODEL;
  const requestedModelId = fireworksModelId(requested);
  if (!requestedModelId) return requested;

  const agentId = parentAgentIdFromInstanceId(instanceId);
  if (!agentId) return requested;

  const record = await fetchAgentRuntimeRecord(agentId, env);
  const toolsToken = record?.tools_token?.trim();
  if (!toolsToken) return requested;

  const limits = fireworksModelLimits(requestedModelId);
  const providerId = stableProviderId(agentId);
  registerProvider(providerId, {
    api: "anthropic-messages" as never,
    baseUrl: env.TINYFAT_FIREWORKS_BASE_URL?.trim() || DEFAULT_FIREWORKS_PROXY_BASE,
    apiKey: toolsToken,
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
    models: {
      [requestedModelId]: limits,
    },
  });

  return `${providerId}/${requestedModelId}`;
}
