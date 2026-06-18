import type { Env } from "../env";
import { fetchAgentRuntimeRecord } from "../platform/supabase";
import { workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";

export const DEFAULT_SITES_PUBLISH_URL = "https://publish.tinyfat.com/api/sites";

export async function agentToolsToken(input: {
  env: Env;
  instanceId: string;
}): Promise<{ ownerId: string; toolsToken: string }> {
  const ownerId = workspaceOwnerIdFromInstanceId(input.instanceId);
  const record = await fetchAgentRuntimeRecord(ownerId, input.env);
  if (!record?.tools_token) {
    throw new Error("TinyFat Sites tools require the agent tools token.");
  }
  return { ownerId, toolsToken: record.tools_token };
}

export function siteApiUrl(env: Env, site: string, path = ""): string {
  const base = env.SITES_PUBLISH_URL?.trim() || DEFAULT_SITES_PUBLISH_URL;
  const cleanPath = path ? `/${path.replace(/^\/+/u, "")}` : "";
  return `${base.replace(/\/+$/u, "")}/${encodeURIComponent(site)}${cleanPath}`;
}

export function cleanSiteMessage(value: string | undefined, fallback: string): string {
  return (value || fallback).trim().replace(/\s+/g, " ").slice(0, 200) || fallback;
}
