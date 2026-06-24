import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { readGoalState, writeGoalState } from "../agent/goal-state";
import { workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";

export function createAbandonGoalTool(input: { env: Env; instanceId: string }) {
  return defineTool({
    name: "abandon_goal",
    description: "Mark the current active goal as abandoned, with an optional reason.",
    parameters: v.object({
      label: v.pipe(v.string(), v.minLength(1)),
      reason: v.optional(v.pipe(v.string(), v.maxLength(200))),
    }),
    execute: async ({ reason }) => {
      if (!input.env.FLIGHT_WORKSPACE) throw new Error("FLIGHT_WORKSPACE not available.");
      const agentId = workspaceOwnerIdFromInstanceId(input.instanceId);
      const current = await readGoalState(input.env.FLIGHT_WORKSPACE, agentId);
      if (!current) return "No active goal found.";
      if (current.status !== "active") return `Goal is already ${current.status}.`;
      const completedAt = new Date().toISOString();
      await writeGoalState(input.env.FLIGHT_WORKSPACE, agentId, {
        ...current,
        status: "abandoned",
        completedAt,
        ...(reason ? { reason } : {}),
      });
      return `Abandoned goal: ${current.goal}${reason ? ` (${reason})` : ""}`;
    },
  });
}
