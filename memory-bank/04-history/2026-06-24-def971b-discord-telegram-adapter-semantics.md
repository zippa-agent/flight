# Discord/Telegram Adapter Semantics Fix

Commit: `def971b` (`Fix Discord and Telegram adapter semantics`)

## Summary

- Fixed Discord inbound normalization to use `adapter: "discord"` instead of `slack`.
- Added Discord and Telegram to listener thread state typing, normalization, and inference.
- Moved Discord and Telegram inbound events onto the shared default `agent:web` Flight scope, matching web chat, email, and Slack.
- Changed top-level Discord/Telegram ledger grouping to use a stable channel/chat root instead of each message id, preventing outbound sends from splitting into a new listing.
- Clarified Discord target semantics: `discord:<channel_id>` posts to that channel or Discord thread channel; `discord:<channel_id>:<message_id>` creates a Discord message reply.
- Updated Telegram sends to use `reply_parameters` for explicit reply targets.
- Updated tool/prompt descriptions and tests for the corrected target grammar.

## Verification

- `node scripts/patch-flue-tool-labels.mjs && npx tsx --test test/discord-ingress.test.ts test/telegram-ingress.test.ts test/listener-phone.test.ts test/adapter-contract.test.ts test/tool-policy.test.ts test/tool-catalog.test.ts test/prompt-honesty.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Deploy Status

Not deployed. This commit is intended for PR #1 (`feat/discord-telegram-adapters`).

## Manual QA Gaps

- Did not send live Discord or Telegram messages with real bot credentials.
- Did not test a real Discord thread-channel event from the bridge; code assumes the channel id used for delivery is the channel/thread channel id to post into.
