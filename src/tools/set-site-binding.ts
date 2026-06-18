import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { agentToolsToken, siteApiUrl } from "./site-api";

const SetSiteBindingInput = v.object({
  site: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(63),
    v.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/u, "Use a lowercase site slug."),
  ),
  type: v.optional(v.union([v.literal("r2"), v.literal("d1"), v.literal("kv")])),
  binding: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(80))),
  environment: v.optional(v.union([v.literal("shared"), v.literal("preview"), v.literal("production")])),
});

type SetSiteBindingInputValue = v.InferOutput<typeof SetSiteBindingInput>;

export function createSetSiteBindingTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "set_site_binding",
    description:
      "Provision or reuse a Cloudflare resource binding for a TinyFat site. Use this before deploy_site when the site needs R2, D1, or KV at runtime. Defaults to an R2 MEDIA binding shared by preview and production.",
    parameters: SetSiteBindingInput,
    execute: async (args, signal) => {
      const { toolsToken } = await agentToolsToken(input);
      const result = await setSiteBinding({
        env: input.env,
        toolsToken,
        request: args,
        signal,
      });
      return JSON.stringify(result, null, 2);
    },
  });
}

export async function setSiteBinding(input: {
  env: Env;
  toolsToken: string;
  request: SetSiteBindingInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const response = await (input.fetchImpl || fetch)(siteApiUrl(input.env, input.request.site, "resources"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.toolsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: input.request.type || "r2",
      binding: input.request.binding || "MEDIA",
      environment: input.request.environment || "shared",
    }),
    signal: input.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Site binding failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) as unknown : {};
}
