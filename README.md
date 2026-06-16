# Flight

Flight is the Flue-native TinyFat orchestrator. It treats a TinyFat agent as a
durable Flue agent instance, stores conversation state in Flue's durable stream
and Durable Object SQLite machinery, and wakes container infrastructure only
through explicit tool surfaces.

Flight is source-available under BUSL-1.1. Each release changes to MIT on the
license change date in `LICENSE`.

## Goals

- Represent TinyFat agents and relationship scopes as durable Flue instances.
- Accept Flight-shaped webhooks instead of Crawdad-shaped webhooks.
- Use Flue streams as the UI protocol for web, embeds, docs widgets, and admin
  consoles.
- Keep the container as a configurable tool backend, not the primary agent
  runtime.
- Make scoped subagents first-class: group chats, landing-page widgets, docs
  pages, support inboxes, and email threads should each get the right context
  without bleeding into unrelated relationships.

## First HTTP Surface

Custom Flight webhooks:

```bash
curl -X POST "$FLIGHT_URL/webhooks/flight/$AGENT_ID" \
  -H "Authorization: Bearer $FLIGHT_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "surface": "embed",
    "scope": { "kind": "embed-session", "id": "site:docs:visitor-123" },
    "actor": { "id": "visitor-123", "displayName": "Visitor" },
    "message": { "text": "How do I deploy this?" },
    "delivery": { "id": "evt_123" }
  }'
```

The response includes the Flue agent name, deterministic scoped instance ID,
dispatch receipt, and stream URL:

```json
{
  "ok": true,
  "runtime": "flight",
  "agent": "tinyfat",
  "instanceId": "...",
  "streamUrl": "/agents/tinyfat/...",
  "dispatchId": "..."
}
```

Direct Flue prompts and stream reads are mounted at the normal Flue routes:

- `POST /agents/tinyfat/:instanceId`
- `GET /agents/tinyfat/:instanceId`

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Local dev:

```bash
npm run dev
```

Do not expose the dev server publicly. Bind only to localhost and use SSH
tunnels when needed.
