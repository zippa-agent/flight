# 2026-06-17 - Flight console persistence

Commits:
- `b92995e` (`flight`) - Persist Flight console web turns.

Summary:
- Added `FlightConsoleLedger`, an application-owned Cloudflare SQLite Durable Object exported via `src/cloudflare.ts`.
- Persisted web console user messages after successful Flight prompt admission.
- Persisted assistant `message_end` snapshots from the POST stream into the same ledger.
- Merged ledger-backed console lines with Flue assistant history for `/api/v2/agents/:id/events`, with stable ids and timestamp ordering.
- Suppressed active POST submissions from the live history SSE path so the current response is not rendered twice.

Verification:
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run build` passed.
- Deployed to `flight.tinyfat.com`, Worker version `b91609a5-11cc-4ea1-b570-8696c7acb502`.
- Browser-tested Floopy (`d5848746-66d6-44df-908e-7fce86a598d4`) through the web UI.
- Confirmed `/events` persisted both roles for `floopy ledger assistant ok`.
- Refreshed the web UI and confirmed the new turn rendered once as one user row and one assistant row.

Manual QA gaps:
- Historical turns before this ledger existed remain incomplete if Flue did not expose their user or assistant entries.
- Email and non-web scoped surfaces were not re-tested in this pass.
