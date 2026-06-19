# 2026-06-19 - Payload Account Lock Docs

Commit:
- `flight` `19c8f150e078bb9ddfbc8850369f28c027b69461` - `Document Payload D1 account lock workaround`

## Summary

Fixed the live `floopy-payload-live` authenticated Payload account page by
redeploying the retained worker artifact with the `users` collection patched to
`lockDocuments: false`. The broken authenticated route was:

```text
https://main-floopy-payload-live.tinyfat.dev/admin/account
```

The failure only reproduced with Alex's logged-in Chrome session. Unauthenticated
loads and `/api/users/me` were already healthy. Browser probes narrowed the
server-side account render to Payload's account view dependencies:

- `/api/users/1?...` returned 200.
- `/api/payload-preferences?...` returned 200.
- `/api/payload-locked-documents?...document.value=1...` returned 500.
- `/api/users/versions?...` also returned 500, but `users` does not enable
  versions in this demo config.

Payload's account view checks document locks by default when the collection does
not explicitly disable locking. For the Cloudflare D1 worker shape, that lock
lookup can break authenticated `/admin/account`. The live fix disables locks on
the admin user collection and keeps the rest of the Payload worker unchanged.

## Live Deploy

Redeployed through TinyFat Sites Publish, not a direct Cloudflare script edit.

- Site: `floopy-payload-live`
- Environment: `preview`
- URL: `https://main-floopy-payload-live.tinyfat.dev/`
- Deployment row: `95735967-d527-472c-ae51-737a479d7fc4`
- Deploy message: `Disable Payload user document locking for admin account route`
- New retained bundle key:
  `sites/f1778a13-b0b3-4532-aa08-0fb2dce79339/preview/1781833863976-b25467d0-656a-4873-8e73-9c1cbea54440.tar.gz`
- Previous broken preview deployment `61b24389-3b2b-4d4f-baad-c4ba75676774`
  was marked `superseded`.

The uploaded bundle was checked before deploy and contained six
`lockDocuments: false` patched `users` collection literals.

## Repo Change

Flight now tells agents to set the admin users collection to
`lockDocuments: false` before building Payload/D1 worker artifacts unless
document locks have been explicitly tested. This was added to:

- `src/agents/tinyfat.md`
- `src/agent/contract.ts`
- `src/tools/deploy-site.ts`

## Verification

- `npm run typecheck` passed on `tiny-bat`.
- `npm test` passed 40/40 tests on `tiny-bat`.
- Terminal no-store fetch for `/admin/account` returned HTTP 200 and Account /
  Payload HTML markers.
- Alex's logged-in Chrome DevTools fetch returned
  `AFTER_LOCKDOCS_OFF_ACCOUNT_STATUS 200`.
- Visible Chrome page rendered `Account - Payload`, with the `alex@tinyfat.com`
  heading, email field, Change Password, Force Unlock, and Payload Settings.

## Gaps

The underlying Payload internal collection queries for `payload-locked-documents`
and `users/versions` still return generic 500s when queried directly. The shipped
fix avoids the bad account-page lock path for the admin user collection; it does
not claim document locking is generally fixed for Payload on D1.
