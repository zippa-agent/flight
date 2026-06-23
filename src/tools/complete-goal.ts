import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { readGoalState, writeGoalState } from "../agent/goal-state";
import { workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";

export function createCompleteGoalTool(input: { env: Env; instanceId: string }) {
  return defineTool({
    name: "complete_goal",
    description: "Mark the current active goal as completed.",
    parameters: v.object({
      label: v.pipe(v.string(), v.minLength(1)),
    }),
    execute: async () => {
      if (!input.env.FLIGHT_WORKSPACE) throw new Error("FLIGHT_WORKSPACE not available.");
      const agentId = workspaceOwnerIdFromInstanceId(input.instanceId);
      const current = await readGoalState(input.env.FLIGHT_WORKSPACE, agentId);
      if (!current) return { ok: false, message: "No active goal found." };
      if (current.status !== "active") return { ok: false, message: `Goal is already ${current.status}.` };
      const completedAt = new Date().toISOString();
      await writeGoalState(input.env.FLIGHT_WORKSPACE, agentId, {
        ...current,
        status: "completed",
        completedAt,
      });
      return { ok: true, goal: current.goal, completedAt };
    },
  });
}
