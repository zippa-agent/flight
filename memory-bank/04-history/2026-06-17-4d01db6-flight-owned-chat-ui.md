# 2026-06-17 - Flight Owned Chat UI

Commit: `4d01db63fc95f4fa9efcd4e9d2842bfe3bb8c6f8`

## Summary

Flight now owns its web chat UI source instead of approximating the Troublemaker UI by hand or loading remote Crawdad assets. The copied UI lives under `ui/src`, is built with Vite, and is embedded into `src/ui/assets.ts` by `scripts/build-ui-assets.mjs`.

The Flight web chat stream now speaks the Troublemaker renderer contract: text and thinking deltas use `delta`, tool calls use `toolcall_start` plus `toolResult`, final assistant content uses `assistant_snapshot`, and terminal completion uses `run_complete`. The copied web chat hook also generates a deterministic `deliveryId` and optimistic user entry id, so the durable inbound event replaces the pending user message instead of briefly duplicating it.

## Verification

- `npm run build:ui` passed and regenerated the embedded UI asset.
- `npm run typecheck` passed for both Worker and UI TypeScript.
- `npm test` passed: 15 tests.
- `npm run build` passed and produced `dist/flight`.
- Browser QA used a localhost-only mock Flight API against the built `ui/dist` bundle:
  - sent `qa hello exact ui`
  - verified one rendered user entry, no duplicate
  - verified Troublemaker-style thinking block rendering
  - verified `Full bash` tool row rendering
  - verified assistant markdown response rendering
  - screenshot: `/tmp/screenshot-2026-06-17T17-28-01-511Z.png`

## Deploy

Deployed with `CLOUDFLARE_API_TOKEN=$(cat ~/.config/cloudflare/workers-token) npm run deploy`.

Cloudflare Worker version: `cacc5dd4-d57b-470c-b4a4-c17a83421ef9`

Production smoke:

- `GET https://flight.tinyfat.com/health` returned 200 with `{"ok":true,"service":"flight"}`.
- `GET https://flight.tinyfat.com/agents/d5848746-66d6-44df-908e-7fce86a598d4/assets/app.js` included `toolcall_start`, `toolResult`, `thinking_delta`, `assistant_snapshot`, and `run_complete`.
- Unauthenticated `GET /agents/d5848746-66d6-44df-908e-7fce86a598d4/` returned 401, expected without TinyFat auth cookies.

## Gaps

The `floopy@tinyfat.ai` email delivery miss was not fixed in this commit. The likely next step is to inspect the inbound email routing/domain mapping and point the relevant alias/runtime path at Flight.
