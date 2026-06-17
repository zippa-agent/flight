import { registerProvider } from "@flue/runtime";
import type { Env } from "../env";
import { fetchAgentRuntimeRecord } from "./supabase";
import { parentAgentIdFromInstanceId } from "../webhooks/flight-input";

const DEFAULT_FIREWORKS_MODEL = "fireworks/accounts/fireworks/models/minimax-m2p7";
const DEFAULT_FIREWORKS_PROXY_BASE = "https://tinyfat.com/api/fireworks";

function stableProviderId(agentId: string): string {
  return `tf-fireworks-${agentId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

function isFireworksModel(model: string): boolean {
  return model.startsWith("fireworks/") && model.length > "fireworks/".length;
}

export async function resolveTinyFatModel(env: Env, instanceId: string): Promise<string> {
  const requested = env.TINYFAT_MODEL?.trim() || DEFAULT_FIREWORKS_MODEL;
  if (!isFireworksModel(requested)) return requested;

  const agentId = parentAgentIdFromInstanceId(instanceId);
  if (!agentId) return requested;

  const record = await fetchAgentRuntimeRecord(agentId, env);
  const toolsToken = record?.tools_token?.trim();
  if (!toolsToken) return requested;

  const providerId = stableProviderId(agentId);
  registerProvider(providerId, {
    api: "anthropic-messages" as never,
    baseUrl: env.TINYFAT_FIREWORKS_BASE_URL?.trim() || DEFAULT_FIREWORKS_PROXY_BASE,
    apiKey: toolsToken,
    contextWindow: 200_000,
    maxTokens: 32_000,
  });

  return `${providerId}/${requested.slice("fireworks/".length)}`;
}
