import { workspaceRootPrefix } from "../sandboxes/r2-workspace";

export type GoalStatus = "active" | "completed" | "abandoned";

export interface GoalState {
  goal: string;
  setAt: string;
  status: GoalStatus;
  completedAt?: string;
  reason?: string;
}

const GOAL_KEY = "goal.json";

export async function readGoalState(
  bucket: R2Bucket,
  agentId: string,
): Promise<GoalState | null> {
  const prefix = workspaceRootPrefix(agentId);
  const obj = await bucket.get(`${prefix}${GOAL_KEY}`);
  if (!obj) return null;
  try {
    const raw = await obj.json<unknown>();
    return parseGoalState(raw);
  } catch {
    return null;
  }
}

export async function writeGoalState(
  bucket: R2Bucket,
  agentId: string,
  state: GoalState,
): Promise<void> {
  const prefix = workspaceRootPrefix(agentId);
  await bucket.put(`${prefix}${GOAL_KEY}`, JSON.stringify(state, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

export function renderGoalContext(state: GoalState | null): string {
  if (!state) return "";
  const label =
    state.status === "active" ? "ACTIVE" :
    state.status === "completed" ? "COMPLETED" : "ABANDONED";
  const lines = [
    `Current goal [${label}]: ${state.goal}`,
    `Set at: ${state.setAt}`,
  ];
  if (state.completedAt) lines.push(`Closed at: ${state.completedAt}`);
  if (state.reason) lines.push(`Reason: ${state.reason}`);
  return lines.join("
");
}

function parseGoalState(raw: unknown): GoalState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.goal !== "string" || !r.goal.trim()) return null;
  if (r.status !== "active" && r.status !== "completed" && r.status !== "abandoned") return null;
  if (typeof r.setAt !== "string") return null;
  return {
    goal: r.goal.trim(),
    setAt: r.setAt,
    status: r.status,
    ...(typeof r.completedAt === "string" ? { completedAt: r.completedAt } : {}),
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
  };
}
