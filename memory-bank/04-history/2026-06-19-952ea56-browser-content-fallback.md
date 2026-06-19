# 2026-06-19 - Browser Content Fallback For TinyFat Content URLs

Commits shipped:

- `bc107c2` - `fix: add TinyFat content fallback to browser tool`
- `952ea56` - `fix: bind browser content fetch in Workers`

## Summary

Fixed Flight's `browser_content` tool for public TinyFat content-store objects
that Cloudflare Browser Rendering refuses to load as a rendered page. The tool
still tries Crawdad's browser endpoint first, but for TinyFat-owned public hosts
it now falls back to a bounded direct text fetch when the browser path fails.
The fallback returns the same content-style shape with
`mode: "direct_text_fallback"`, status, content type, text, empty links, and the
original browser failure reason.

The first deploy of `bc107c2` exposed a Worker-only regression: the refactor
detached Cloudflare's global `fetch`, causing `Illegal invocation`. `952ea56`
binds global fetch correctly and adds a regression test that fails if the fetch
receiver is lost again.

Updated the Flight website-manager skill so agents treat
`direct_text_fallback` as successful public content verification for TinyFat
content-store URLs.

## Verification

- Server `tiny-bat`, `~/code/tinyfatco/flight`:
  - `npm run typecheck` passed.
  - `npx tsx --test test/browser-content.test.ts` passed, 5/5.
  - `npm test` passed, 48/48.
  - `npm run build` passed.
- Deployed Flight with Workers token:
  - Final live version: `bb960606-730f-47a0-8922-0e9cfe68aa48`
  - Routes: `https://flight.alexgarcia042.workers.dev`,
    `https://flight.tinyfat.com`
- Live Chrome/Floopy QA:
  - Asked Floopy to rerun `browser_content` against
    `https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/floopy-dashboard-upload-20260619.txt`.
  - Tool returned `ok: true`, `mode: "direct_text_fallback"`, `status: 200`.
  - Returned text included `DASHBOARD_UPLOAD_MARKER_20260619_FLIGHT`.

## Manual QA Gaps

- Live email attachment QA through `gogfromalex@tinyfat.com` remains blocked by
  unavailable/expired `gog` auth in the current local/server setup. The email
  attachment persistence path remains covered by unit tests.
- The direct fetch fallback is intentionally narrow: TinyFat-owned public hosts
  only, text-like bodies only, and response-size bounded.
