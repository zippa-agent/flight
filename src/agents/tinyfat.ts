import {
  createAgent,
  defineAgentProfile,
  type AgentRouteHandler,
} from "@flue/runtime";
import type { Env } from "../env";
import { requireBearer } from "../shared/http";
import { createHostTools } from "../tools/host";
import instructions from "./tinyfat.md" with { type: "markdown" };

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
    "Review the proposed response. Flag cross-scope leakage, unsupported claims, accidental secrets, and provider-delivery assumptions.",
});

export default createAgent<unknown, Env>(({ id, env }) => ({
  model: env.TINYFAT_MODEL || "openai/gpt-5.5",
  instructions,
  tools: createHostTools({ env, instanceId: id }),
  subagents: [relationshipContext, supportClassifier, responseReviewer],
  durability: {
    maxAttempts: 5,
    timeoutMs: 60 * 60 * 1000,
  },
  compaction: {
    reserveTokens: 16000,
    keepRecentTokens: 12000,
  },
}));
