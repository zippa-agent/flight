import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";

const YieldNoActionInput = v.object({
  reason: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000)),
});

export function createYieldNoActionTool(): ToolDefinition {
  return defineTool({
    name: "yield_no_action",
    description:
      "End this ambient/passive turn without sending a user-visible message. Only use this when the user did not directly address you and you have nothing useful to add.",
    parameters: YieldNoActionInput,
    execute: async ({ reason }) => `Yielded without user-visible action: ${reason}`,
  });
}
