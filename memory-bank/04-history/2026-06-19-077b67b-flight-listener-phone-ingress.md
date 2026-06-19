# 2026-06-19 - 077b67b - Flight Listener Phone Ingress

Code commit: `077b67bb7bafa930015e9896776bd14c2b5ddfb7`

## Summary

Implemented the first Flight listener shape for inbound email and phone threads.
Inbound listener messages are stored in durable R2 ledgers before any agent turn,
and `prompt_on_delivery` now controls whether delivery immediately prompts the
agent. Added phone normalization, phone thread ledger/listing helpers, a generic
listener read-state sidecar, read/unread display in `list_channels`, optional
`read_thread({ mark })`, and an authenticated `/agents/:id/listener` viewer.

## Verification

- `npm run typecheck`
- `npm test -- --test-reporter=spec test/listener-phone.test.ts test/email-ingress.test.ts test/slack-ingress.test.ts test/tool-policy.test.ts test/tool-catalog.test.ts`
- `npm run build`

## Deploy Status

Flight build succeeded locally. Deploy/push still pending at the time this note
was written.

## Manual QA Gaps

- Need live Twilio inbound smoke test after Crawdad deploy.
- Need browser QA of `/agents/:id/listener` against a real Flight agent with
  captured listener data.
