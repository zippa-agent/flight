# 2026-06-19 - `49b30df` - Email Attachment CamelCase Payloads

Commit shipped:

- `49b30df` - `fix: accept camelCase email attachments`

## Summary

Fixed Flight email attachment persistence so webhook payloads can use either
snake_case (`content_type`, `content_base64`) or camelCase (`contentType`,
`contentBase64`) attachment fields. This keeps dashboard/webhook simulations
and provider-shaped payloads aligned with the same workspace upload path.

The email adapter type now declares both forms, and the attachment persistence
helper reads either shape before writing files into the parent agent's
R2-backed `/workspace`.

## Verification

- Server `tiny-bat`, `~/code/tinyfatco/flight`:
  - `npx tsx --test test/email-ingress.test.ts test/prompt-honesty.test.ts`
    passed.
  - `npm run typecheck` passed.
  - `npm test` passed, 53/53.
  - `npm run build` passed.
- Deployed Flight with Workers token:
  - Version: `c62fc816-9834-40e1-9c33-5d51993191fd`
- Live email-shaped webhook QA:
  - Sent a webhook from `Alex <alex@tinyfat.com>` to Floopy with a camelCase
    attachment named `qa/floopy-email-attachment-camel-20260619.txt`.
  - The resulting public content URL returned 200:
    `https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/floopy-email-attachment-camel-20260619.txt`
  - The response body contained
    `EMAIL_ATTACHMENT_CAMEL_MARKER_20260619_FLIGHT`.
  - Floopy read the attachment, uploaded it with `upload_site_content`, and
    verified it with `browser_content` using `mode: "direct_text_fallback"`.

## Manual QA Gaps

- The live webhook admission returned 202, but the async mirror status timed
  out while the agent turn continued. This was already expected after the
  bounded email mirror change.
- The final model turn hit the provider length stop after completing the read,
  upload, and browser verification steps. Alex later confirmed the
  `send_message` path should not be the focus of this follow-up.
