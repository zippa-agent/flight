# 2026-06-19 - Flight listener contact book

## Commits

- `e28800a` (`flight`) - Add Flight listener contact book.

## Summary

Implemented a small R2-backed contact book at `.flight/contacts.json` for each
agent workspace. Added the `remember_contact` tool so an agent can store
admin-confirmed or trusted CRM-confirmed labels for phone numbers, email
addresses, Slack identities, or other identities.

`list_channels` and `read_thread` now hydrate email, phone, and Slack
participants from that contact book without mutating the append-only listener
ledgers. Phone transcripts also show the participant list for group MMS
records, so remembered contacts can make group threads readable.

Updated the Flight listener CRM prototype doc and tests for the new contact
book path and tool availability.

## Verification

- `npm run typecheck`
- `npm test` (83 passing)
- `npm run build`
- Deployed from `tiny-bat` with `CLOUDFLARE_API_TOKEN=$(cat ~/.config/cloudflare/workers-token) npm run deploy`
- Cloudflare Worker version: `413403dc-4e0d-4dfd-b718-37562990ba8a`
- Smoke check: `https://flight.tinyfat.com/health` returned `200` and `{"ok":true,"service":"flight"}`

## Manual QA Gaps

- Did not yet perform a live Floopy tool-call smoke test where the agent calls
  `remember_contact` and rereads the actual Twilio group MMS thread. That is the
  next practical check for the product slice.
