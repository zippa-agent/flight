import {
  createAgent,
  defineAgentProfile,
  type AgentRouteHandler,
} from "@flue/runtime";
import type { Env } from "../env";
import { buildAgentInstructions } from "../agent/prompt";
import { toolPolicyForTurn } from "../agent/contract";
import { resolveTinyFatModel } from "../platform/model";
import { requireBearer } from "../shared/http";
import { parseFlightTurnPayload } from "../adapters/types";
import { r2Workspace, workspaceOwnerIdFromInstanceId } from "../sandboxes/r2-workspace";
import { availableToolNames, resolveTurnTools } from "../tools/registry";
import { resolveTurnContext } from "../turns/context";
import baseInstructions from "./tinyfat.md" with { type: "markdown" };
import flightWebsiteManager from "../skills/flight-website-manager/SKILL.md" with { type: "skill" };

export const description = "TinyFat Flight scoped relationship agent.";

export const route: AgentRouteHandler = async (c, next) => {
  const env = c.env as Env;
  const unauthorized = requireBearer(c as never, env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;
  await next();
};

const relationshipContext = defineAgentProfile({
  name: "relationship_context",
  description: "Reviews scoped relationship context and identifies what is safe to use in this relationship.",
  instructions:
    "Given a Flight scoped request, summarize only context that belongs to this scope. Call out missing information instead of importing assumptions from other scopes.",
});

const supportClassifier = defineAgentProfile({
  name: "support_classifier",
  description: "Classifies support and docs questions by product area, urgency, and likely next action.",
  instructions:
    "Classify the user's support request. Return concise routing guidance, urgency, and what information is still needed.",
});

const responseReviewer = defineAgentProfile({
  name: "response_reviewer",
  description: "Checks an outbound response for scope leaks, unsupported claims, and unsafe delivery details.",
  instructions:
    "Review the proposed response. Flag cross-scope leakage, unsupported claims, accidental secrets, and unsafe delivery details.",
});

export default createAgent<unknown, Env>(async ({ id, env, payload }) => {
  const turn = await resolveTurnContext({ env, instanceId: id, payload })
    || parseFlightTurnPayload(payload);
  const policy = toolPolicyForTurn(turn);
  if (!env.FLIGHT_WORKSPACE) {
    throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");
  }

  const workspaceOwnerId = workspaceOwnerIdFromInstanceId(id);
  const toolNames = availableToolNames({ env, turn });

  return {
    model: await resolveTinyFatModel(env, id),
    instructions: buildAgentInstructions({
      instanceId: id,
      turn,
      policy,
      toolNames,
      baseInstructions,
    }),
    tools: resolveTurnTools({ env, instanceId: id, turn }),
    skills: [flightWebsiteManager],
    subagents: [relationshipContext, supportClassifier, responseReviewer],
    sandbox: r2Workspace({
      bucket: env.FLIGHT_WORKSPACE,
      ownerId: workspaceOwnerId,
    }),
    cwd: "/workspace",
    durability: {
      maxAttempts: 5,
      timeoutMs: 60 * 60 * 1000,
    },
    compaction: {
      reserveTokens: 16000,
      keepRecentTokens: 12000,
    },
  };
});
