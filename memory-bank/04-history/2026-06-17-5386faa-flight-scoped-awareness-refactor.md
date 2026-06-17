# 2026-06-17 - Flight Scoped Awareness Refactor

## Commits

- `5386faa` (`flight`) - Refactor Flight runtime around scoped awareness.

## What Changed

- Removed the spike-era Crawdad console compatibility layer from Flight:
  `/api/v2` console routes, console stream mapper, console ledger, email route
  controller-side reply sending, and hard-coded Crawdad UI asset hashes.
- Added native Flight modules:
  - `src/adapters/` for web, email, and generic Flight webhook normalization.
  - `src/awareness/` for scoped SQLite Durable Object awareness persistence.
  - `src/turns/` for inbound turn submission, Flue stream proxying, and
    awareness append behavior.
  - `src/tools/` for registry-driven model-callable tools: `send_message` and
    optional `full_bash`.
  - `src/ui/` for colocated web chat assets.
- Updated TinyFat agent instructions to describe Flight beta truthfully:
  default Flue light bash is not Crawdad, not R2, and not `/data`; unavailable
  tools are not named in the prompt.
- Added `FlightAwareness` Durable Object and Wrangler migration `v3`.

## Verification

- `npm test` - 12 tests passing.
- `npm run typecheck` - passed.
- `npm run build` - passed.
- Browser QA against local Flight UI for Floopy:
  - Authenticated local session loaded the colocated UI assets.
  - Sent `Say exactly: flight local qa 20260617b`.
  - Response streamed through the UI.
  - Awareness API persisted both user and assistant entries.
  - Browser refresh preserved the response.
  - Fixed stale restored-assistant `writing` metadata found during QA.

## Deploy

- Deployed `flight` to Cloudflare Workers after pushing `5386faa`.
- Cloudflare version ID: `5bf4b6f6-8efd-4875-adf3-edb151a3af7d`.
- Production smoke checks:
  - `GET https://flight.tinyfat.com/health` returned `200`.
  - Authenticated `GET /api/agents/d5848746-66d6-44df-908e-7fce86a598d4/session`
    returned Floopy session metadata.

## Gaps

- Production browser message QA after deploy was not run in this session; local
  browser QA covered the new UI and persistence path before deployment.
- `full_bash` still intentionally calls Crawdad's existing `/api/v2` tool
  execution endpoint. That is host-tool integration, not console compatibility.
