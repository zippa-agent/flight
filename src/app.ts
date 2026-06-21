import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";
import type { Env } from "./env";
import { handleEmailWebhook, handleFlightWebhook, handlePhoneWebhook, handleSlackWebhook, handleDiscordWebhook, handleTelegramWebhook } from "./adapters/routes";
import {
  handleUiAsset,
  handleUiAwareness,
  handleUiAwarenessStream,
  handleUiMessage,
  handleUiFileUpload,
  handleUiListenerShell,
  handleUiListenerThread,
  handleUiListenerThreads,
  handleUiSession,
  handleUiShell,
} from "./ui/routes";

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

app.get("/health", (c) => c.json({ ok: true, service: "flight" }));

app.get("/agents/:agentId", (c) => c.redirect(`/agents/${c.req.param("agentId")}/`));
app.get("/agents/:agentId/", handleUiShell);
app.get("/agents/:agentId/listener", handleUiListenerShell);
app.get("/agents/:agentId/assets/:asset", handleUiAsset);

app.get("/api/agents/:agentId/session", handleUiSession);
app.get("/api/agents/:agentId/awareness", handleUiAwareness);
app.get("/api/agents/:agentId/awareness/stream", handleUiAwarenessStream);
app.get("/api/agents/:agentId/listener/threads", handleUiListenerThreads);
app.get("/api/agents/:agentId/listener/thread", handleUiListenerThread);
app.post("/api/agents/:agentId/messages", handleUiMessage);
app.post("/api/agents/:agentId/files", handleUiFileUpload);

app.post("/webhooks/email/:agentId", handleEmailWebhook);
app.post("/webhooks/phone/:agentId", handlePhoneWebhook);
app.post("/webhooks/slack/:agentId", handleSlackWebhook);
app.post("/webhooks/discord/:agentId", handleDiscordWebhook);
app.post("/webhooks/telegram/:agentId", handleTelegramWebhook);
app.post("/webhooks/flight/:agentId", handleFlightWebhook);
app.post("/flight/webhooks/:agentId", handleFlightWebhook);

app.route("/", flue());

export default app;
