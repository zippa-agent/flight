# 2026-06-19 7e0f997 Email Mirror And Alex Allowlist

## Commits

- `7e0f9973f2b2a28a7c2b071f43f5ac3525d692b4` (`flight`) - `fix: tolerate email webhook mirror failures`

## Summary

- Added bounded inline mirroring for Flight email webhooks. Email webhook turns now wait up to 50s for Flue stream mirroring, then return `202` with `mirrorStatus: "timed_out"` and continue the mirror in `waitUntil`.
- Tolerated mirror failures after prompt admission so useful admitted email work no longer turns into a false webhook-level failure such as `Network connection lost`.
- Updated the Flight capability contract so `browser_content` honestly describes the TinyFat public content-store direct text fallback.
- Added focused tests for detached mirror completion, timeout/background continuation, tolerated failures, and strict failure behavior.
- Added `alex@tinyfat.com` as an exact-match contact for Floopy (`d5848746-66d6-44df-908e-7fce86a598d4`) in both `allowed_senders` and `allowed_recipients`.

## Verification

- Server `tiny-bat`, `flight`:
  - `npx tsx --test test/detached-mirror.test.ts test/prompt-honesty.test.ts` passed.
  - `npm run typecheck` passed.
  - `npm test` passed: 52 tests.
  - `npm run build` passed.
- Deployed Flight with `npm run deploy` from `tiny-bat`.
  - Cloudflare version: `8b5d87ea-7900-436f-a0d8-ac1586fda99f`.
- Live email-shaped webhook from `alex@tinyfat.com` to Floopy returned `202` with `mirrorStatus.status="timed_out"` instead of surfacing a network-loss error.
- Floopy contact readback through `GET /api/agent/contacts` returned `alex@tinyfat.com` with `inbound: true` and `outbound: true`.
- Direct `/api/email/send` with Floopy's real `tools_token` to `alex@tinyfat.com` returned `200` with Resend message id `8219a41d-a992-4395-9545-f9ad3318fd38`.

## Manual QA Gaps

- `gog` local OAuth for `alex@tinyfat.com` is still revoked (`invalid_grant`), so a real Gmail-originated `gog gmail send --account alex@tinyfat.com` test still needs reauthorization.
- The live email-shaped webhook turn hit the mirror timeout and did not complete the requested content upload before timeout; the immediate send gate is fixed, but long email turns still need follow-up so they do not spiral on delivery/tool errors.
