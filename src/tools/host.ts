import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { parentAgentIdFromInstanceId } from "../webhooks/flight-input";

export interface HostToolOptions {
  env: Env;
  instanceId: string;
}

const BashInput = v.object({
  label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
  command: v.pipe(v.string(), v.minLength(1), v.maxLength(12000)),
  timeout: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(600)), 120),
});

export function createHostTools(options: HostToolOptions): ToolDefinition[] {
  if (!options.env.CRAWDAD_API_BASE || !options.env.CRAWDAD_API_TOKEN) return [];

  return [
    defineTool({
      name: "host_bash",
      description:
        "Execute a bash command in the TinyFat host container for this scoped agent. Use only when edge-native tools cannot answer.",
      parameters: BashInput,
      execute: async ({ command, timeout }, signal) => {
        const agentId = parentAgentIdFromInstanceId(options.instanceId);
        if (!agentId) throw new Error("Cannot resolve parent TinyFat agent id for this Flight scope.");

        const base = options.env.CRAWDAD_API_BASE!.replace(/\/+$/g, "");
        const response = await fetch(`${base}/api/v2/agents/${encodeURIComponent(agentId)}/tools/execute`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${options.env.CRAWDAD_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool: "bash",
            args: { command, timeout },
          }),
          signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || `Crawdad host tool returned ${response.status}`);
        }
        return text || "(no output)";
      },
    }),
  ];
}
