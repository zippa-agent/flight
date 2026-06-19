# 2026-06-19 - `2dc627a` - Slack Context Cleanup and Ambient Turns

Commits shipped:

- `2dc627a` (`flight`) - `feat: clean Slack context and ambient turns`

## Summary

Updated Flight's Slack turn presentation so delivery metadata no longer appears
inline in the user message. Slack inbound messages now keep the visible text
clean while preserving the model-only delivery context as expandable UI metadata.

- Slack app mentions render only the human message body in the main chat entry.
- Model-only Slack channel/user/thread/addressing context is stored on the
  awareness entry and shown behind a collapsed `context` expander.
- Slack channel badges use readable channel labels when Crawdad supplies them,
  for example `slack:#social` instead of a raw channel id.
- Slack user names use readable Slack display/user names when supplied.
- Passive Slack channel messages now use Troublemaker-style `[AMBIENT]`
  message formatting so the Flight UI renders compact ambient entries.
- Added `yield_no_action` for passive/ambient turns where the model has nothing
  useful to add.

## Verification / Deploy Status

- Local Mac:
  - `npm test` passed: 69/69.
  - `npm run typecheck` passed.
  - `npm run build` passed and regenerated `src/ui/assets.ts`.
- On `tiny-bat`:
  - `git pull --ff-only` updated Flight to `2dc627a`.
  - `npm test` passed: 69/69.
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `CLOUDFLARE_API_TOKEN=$(cat ~/.config/cloudflare/workers-token) npm run deploy`
    succeeded.
- Deployed Flight version:
  - `c6c6b6a7-0057-401b-a0f3-7a18ed864652`
- Live Slack QA:
  - Posted a fresh `#social` app mention to Floopy as Alex from the Slack Mac
    app.
  - Flight rendered the user message body without inline Slack delivery context.
  - Flight rendered readable labels: channel `#social` and user
    `alexgarcia042`.
  - The collapsed `context` expander opened to show Slack channel, Slack user,
    raw Slack thread target, addressing, and the clean message body.
  - Floopy replied once in the Slack thread.

## Manual QA Gaps

- Ambient engagement is now represented in Flight with compact ambient prompts
  and `yield_no_action`; full Troublemaker-style deferred pulse batching is not
  yet backed by a Durable Object alarm scheduler.
