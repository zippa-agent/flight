import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";
import type { Env } from "./env";
import { handleEmailWebhook, handleFlightWebhook, handleSlackWebhook } from "./adapters/routes";
import {
  handleUiAsset,
  handleUiAwareness,
  handleUiAwarenessStream,
  handleUiMessage,
  handleUiFileUpload,
  handleUiSession,
  handleUiShell,
} from "./ui/routes";

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

app.get("/health", (c) => c.json({ ok: true, service: "flight" }));

app.get("/agents/:agentId", (c) => c.redirect(`/agents/${c.req.param("agentId")}/`));
app.get("/agents/:agentId/", handleUiShell);
app.get("/agents/:agentId/assets/:asset", handleUiAsset);

app.get("/api/agents/:agentId/session", handleUiSession);
app.get("/api/agents/:agentId/awareness", handleUiAwareness);
app.get("/api/agents/:agentId/awareness/stream", handleUiAwarenessStream);
app.post("/api/agents/:agentId/messages", handleUiMessage);
app.post("/api/agents/:agentId/files", handleUiFileUpload);

app.post("/webhooks/email/:agentId", handleEmailWebhook);
app.post("/webhooks/slack/:agentId", handleSlackWebhook);
app.post("/webhooks/flight/:agentId", handleFlightWebhook);
app.post("/flight/webhooks/:agentId", handleFlightWebhook);

app.route("/", flue());

export default app;
