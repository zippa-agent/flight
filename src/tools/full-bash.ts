import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { parentAgentIdFromInstanceId } from "../awareness/id";

const FullBashInput = v.object({
  command: v.pipe(v.string(), v.minLength(1), v.maxLength(12_000)),
  timeout: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(600)), 120),
});

export function createFullBashTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "full_bash",
    description:
      "Execute bash in the configured Crawdad-backed TinyFat host container for this agent. Use only when the light Flue sandbox is insufficient and a real container filesystem/toolchain is required.",
    parameters: FullBashInput,
    execute: async ({ command, timeout }, signal) => {
      const agentId = parentAgentIdFromInstanceId(input.instanceId);
      if (!agentId) throw new Error("Cannot resolve parent TinyFat agent id for this Flight scope.");
      if (!input.env.CRAWDAD_API_BASE || !input.env.CRAWDAD_API_TOKEN) {
        throw new Error("full_bash is not configured.");
      }

      const base = input.env.CRAWDAD_API_BASE.replace(/\/+$/g, "");
      const response = await fetch(`${base}/api/v2/agents/${encodeURIComponent(agentId)}/tools/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.env.CRAWDAD_API_TOKEN}`,
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
  });
}
