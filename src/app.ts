import { dispatch } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";
import type { Context } from "hono";
import tinyfatAgent from "./agents/tinyfat";
import type { Env } from "./env";
import { handleEmailWebhook } from "./email/routes";
import {
  handleConsoleAsset,
  handleConsoleDescribe,
  handleConsoleEvents,
  handleConsoleEventsStream,
  handleConsoleMessage,
  handleConsoleShell,
  handleConsoleStatus,
  handleConsoleStop,
} from "./console/routes";
import { jsonError, requireBearer } from "./shared/http";
import {
  flightInstanceId,
  normalizeFlightWebhook,
  renderFlightPrompt,
} from "./webhooks/flight-input";

type Bindings = { Bindings: Env };
type AppContext = Context<Bindings>;

const app = new Hono<Bindings>();

app.get("/health", (c) => c.json({ ok: true, service: "flight" }));

app.get("/agents/:agentId", (c) => c.redirect(`/agents/${c.req.param("agentId")}/`));
app.get("/agents/:agentId/", handleConsoleShell);
app.get("/agents/:agentId/assets/:asset", handleConsoleAsset);

app.get("/api/v2/agents/:agentId/status", handleConsoleStatus);
app.post("/api/v2/agents/:agentId/describe", handleConsoleDescribe);
app.get("/api/v2/agents/:agentId/events", handleConsoleEvents);
app.get("/api/v2/agents/:agentId/events/stream", handleConsoleEventsStream);
app.post("/api/v2/agents/:agentId/messages", handleConsoleMessage);
app.post("/api/v2/agents/:agentId/messages/stop", handleConsoleStop);

async function handleFlightWebhook(c: AppContext): Promise<Response> {
  const unauthorized = requireBearer(c, c.env.FLIGHT_WEBHOOK_TOKEN || c.env.FLIGHT_API_TOKEN);
  if (unauthorized) return unauthorized;

  const agentId = c.req.param("agentId");
  if (!agentId) return jsonError("Missing agent id", 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError("Expected JSON body", 400);
  }

  try {
    const input = normalizeFlightWebhook(body, { agentId });
    const instanceId = flightInstanceId(input);
    const receipt = await dispatch(tinyfatAgent, {
      id: instanceId,
      input: {
        ...input,
        prompt: renderFlightPrompt(input),
      },
    });

    return c.json({
      ok: true,
      runtime: "flight",
      agent: "tinyfat",
      agentId: input.agentId,
      instanceId,
      streamUrl: `/agents/tinyfat/${encodeURIComponent(instanceId)}`,
      ...receipt,
    }, 202);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

app.post("/webhooks/flight/:agentId", handleFlightWebhook);
app.post("/flight/webhooks/:agentId", handleFlightWebhook);
app.post("/webhooks/email/:agentId", handleEmailWebhook);

app.route("/", flue());

export default app;
