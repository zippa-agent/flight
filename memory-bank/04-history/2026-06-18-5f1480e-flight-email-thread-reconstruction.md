# 2026-06-18 - Flight Email Thread Reconstruction

Commit: `5f1480e` (`Fix Flight email thread reconstruction`)

## Summary

- Added a durable Flight email thread ledger under the agent's `tiny-agents` R2 workspace.
- Stored cleaned inbound email bodies and outbound `send_message` deliveries as immutable ledger events.
- Rebuilt email reply quotes from prior ledger turns with Gmail-style dated quote headers.
- Added a channel plus normalized-subject reconstruction fallback for Gmail/bridge cases where `References` and `In-Reply-To` are absent.
- Added email-only `list_channels` and `read_thread` Flight tools so agents can discover and inspect concrete `email-thread:<id>` targets.
- Extended `send_message` with optional `target` support for stored email thread replies.

## Verification

- `npm test -- test/email-ingress.test.ts test/tool-policy.test.ts` passed: 37 tests.
- `npm run typecheck` passed.
- `npm run build` passed. Build still emits the existing `punycode` deprecation warning and the existing Flue plugin timing notice.
- Deployed Flight to Cloudflare Worker version `46cc2b6b-67fd-492d-8f82-69b83c179f62`.

## Live QA

- Sent a real Gmail test thread from `alexgarcia042@gmail.com` to `floopy@tinyfat.ai`.
- Before the fix, Floopy's second reply only quoted the latest inbound message because the bridge delivered follow-up mail without `References` or `In-Reply-To`.
- After deploy, sent `THREAD_QA_C_20260618T114919Z` into the same Gmail thread.
- Floopy replied with `THREAD_QA_REPLY_C_20260618T114919Z` and quoted the full chain:
  - C inbound
  - reply B
  - B inbound
  - reply A
  - A inbound
- The quote headers included concrete dated Gmail-style lines such as `On Thu, Jun 18, 2026 at 11:57 AM, alexgarcia042@gmail.com wrote:`.

## Gaps

- The subject/channel fallback intentionally mirrors Troublemaker behavior, but identical long-lived subjects from the same sender can still collapse together when provider threading headers are missing.
- Flight now has email-thread discovery/read tools, but it does not yet implement the full Troublemaker `list_channels` surface for Slack, phone, Telegram, or Discord.
- The local `sag` command was unavailable in this environment, so no audible completion checkpoint was sent.
