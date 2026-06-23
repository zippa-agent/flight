import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { writeGoalState } from "../agent/goal-state";
import { workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";

export function createSetGoalTool(input: { env: Env; instanceId: string }) {
  return defineTool({
    name: "set_goal",
    description:
      "Set or replace the active goal for this agent. The goal persists in R2 and is surfaced at the start of every subsequent turn.",
    parameters: v.object({
      label: v.pipe(v.string(), v.minLength(1)),
      goal: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
    }),
    execute: async ({ goal }) => {
      if (!input.env.FLIGHT_WORKSPACE) throw new Error("FLIGHT_WORKSPACE not available.");
      const agentId = workspaceOwnerIdFromInstanceId(input.instanceId);
      const state = {
        goal: goal.trim(),
        setAt: new Date().toISOString(),
        status: "active" as const,
      };
      await writeGoalState(input.env.FLIGHT_WORKSPACE, agentId, state);
      return { ok: true, goal: state.goal, setAt: state.setAt, status: state.status };
    },
  });
}
