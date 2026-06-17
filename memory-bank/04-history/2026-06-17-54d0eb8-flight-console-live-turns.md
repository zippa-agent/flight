# 2026-06-17 - 54d0eb8 - Flight console live turns

## Commits

- `54d0eb8` (`flight`): Fix Flight console live turn persistence.
- Related UI commit: `125248c` in `troublemaker` preserves interrupted web chat turns.

## What Changed

- Added a live SSE stream to `FlightConsoleLedger` so `/api/v2/agents/:id/events/stream` can receive durable console ledger rows.
- Changed Flight console history streaming to prefer the durable console ledger.
- Persisted assistant snapshots before `run_complete` when an authoritative `message_end` is available.
- Added a fallback assistant ledger recorder from text/thinking deltas for streams that do not reach an authoritative `message_end`.
- Updated the Flight console shell to load the deployed shared UI bundle `index-DS48d93i.js`.

## Verification

- `npm run typecheck`
- `npm test` - 13 passing tests, including ledger stream and fallback assistant recorder coverage.
- `npm run build`
- Browser QA on Floopy:
  - Loaded `https://flight.tinyfat.com/agents/d5848746-66d6-44df-908e-7fce86a598d4/?tf_host_tools=0`.
  - Confirmed the page used `index-DS48d93i.js`.
  - Sent rapid test markers `floopy visible preserve 20260617h` and `floopy visible followup 20260617h`.
  - Live DOM after second send kept both markers: first count `4`, second count `4`.
  - After refresh, DOM still showed both markers and `/events?limit=120` returned both user and assistant rows for both turns.

## Deploy Status

- Flight deployed to Cloudflare Worker version `0a5ce80e-c52a-4935-99f2-37f61d1b60fc`.
- Shared Crawdad UI assets were deployed separately from `troublemaker` through Crawdad Worker version `d7cfcde0-ca6e-404a-8f1a-a1ab29777e5c`.

## Manual QA Gaps

- The default Floopy web scope contains earlier incomplete exact-phrase test prompts, so some intermediate model responses were stale. The final live and refresh persistence checks used fresh markers and passed.
- Project query params such as `tf_project_slug` do not yet change the Flight console awareness backlog scope; message sends can use scoped payloads, but `/events` still reads the default web instance.
