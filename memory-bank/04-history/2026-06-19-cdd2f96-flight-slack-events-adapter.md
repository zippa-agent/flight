# 2026-06-19 - `cdd2f96` - Flight Slack Events Adapter

Commit shipped:

- `cdd2f96` - `feat: add Flight Slack events adapter`

## Summary

Implemented Slack Events API ingress in Flight as a messages-only surface, modeled
after the email adapter and Troublemaker Slack target semantics.

- Added `/webhooks/slack/:agentId` as a private Flight webhook protected by the
  existing Flight bearer token.
- Added Slack normalization for `event_callback` messages and mentions.
- Kept Slack in Floopy's unified default Flight scope shared with web/email,
  while preserving explicit Slack delivery targets.
- Added durable R2 Slack thread ledger events under `.flight/slack-thread-events`.
- Added `slack:<channel_id>:<thread_ts>` and top-level `slack:<channel_id>` /
  raw `C/D/G...` target support in `send_message`.
- Expanded `list_channels` and `read_thread` to include Slack targets alongside
  email threads.
- Added Slack mrkdwn conversion for outgoing Slack messages.
- Updated the UI channel formatter so `slack:` channels keep Slack styling.

## Verification / Deploy Status

- On `tiny-bat`:
  - Focused tests for Slack/adapter/tool/prompt paths passed.
  - `npm run typecheck` passed.
  - Full `npm test` passed: 66/66.
  - `npm run build` passed.
- Deployed Flight to Cloudflare:
  - Version ID: `c2bb047e-afd4-4406-959c-2c8cdc45838c`

## Manual QA Gaps

- Live Slack app setup was not completed in Chrome during this session because
  the active Chrome profile was `Profile 6`, which does not have the Codex
  Chrome Extension installed/enabled. The extension was present in the Chrome
  `Default` profile.
- The existing TinyFat dashboard Slack manifest URL still targets Crawdad's
  public `/agents/:id/slack/events` route. That is intentional: Crawdad verifies
  Slack signatures and bridges Flight-runtime agents into Flight privately.
