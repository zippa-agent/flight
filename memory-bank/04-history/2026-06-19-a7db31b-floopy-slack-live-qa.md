# 2026-06-19 - `a7db31b` - Floopy Slack Live QA

Commits shipped:

- `cdd2f96` (`flight`) - `feat: add Flight Slack events adapter`
- `bb66d45` (`crawdad-cf`) - `feat: bridge Slack events to Flight`
- `a7db31b` (`flight`) - `fix: dedupe Slack app mention messages`

## Summary

Completed the live Slack setup for Floopy and verified real Slack Events API
traffic into Flight.

- Created and installed the `floopy` Slack app in the TinyFat workspace.
- Connected Floopy's Slack bot token and signing secret through the TinyFat
  dashboard, leaving the dashboard showing Slack as connected.
- Joined Floopy to `#social` and sent a real Slack app mention.
- Verified the mention appeared in the Flight web chat stream with Slack channel
  metadata and a Slack thread target.
- Verified `send_message` tool-label enforcement on the real Slack turn: the
  first unlabeled call failed, then the model retried with the label
  `Slack reply to thread`.
- Verified Floopy posted a visible Slack thread reply.
- After deploying the duplicate guard, sent a second real Slack app mention and
  verified Slack showed exactly one Floopy thread reply while Flight showed the
  matching Slack stream entry and labeled `send_message` tool call.

The first live test also showed Slack can deliver both `app_mention` and normal
channel `message` events for the same mention when both event subscriptions are
enabled. `a7db31b` makes Flight skip the duplicate non-DM `message` event when
it contains the bot mention, keeping `app_mention` as the canonical direct
mention path.

## Verification / Deploy Status

- Local Mac:
  - `npm test` passed: 67/67.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- On `tiny-bat`:
  - `git pull --ff-only` updated Flight to `a7db31b`.
  - `npm test` passed: 67/67.
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `CLOUDFLARE_API_TOKEN=$(cat ~/.config/cloudflare/workers-token) npm run deploy`
    succeeded.
- Deployed Flight version:
  - `11330cba-78fc-48a4-8cbb-537e150b3567`

## Manual QA Gaps

- None for the Slack app-mention path. The only observed noise was from
  Computer Use interacting with Slack's rich-text composer during test-message
  entry; that affected one pre-fix test message's wording, not the Slack runtime
  behavior.
