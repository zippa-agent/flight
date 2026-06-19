# 2026-06-19 - Worker Artifact Deploys

Commits:
- `flight` `9651a6ea8e8d73e601595fb611b1a395f0de268f` - `Teach deploy_site worker artifact deploys`
- `fat-platform` `687008e983bba858ff8fb4af7996a5ab63f4969a` - `Add worker artifact deploys for TinyFat Sites`

## Summary

Updated Flight's `deploy_site` tool contract so agents can deploy real
Cloudflare Worker framework runtimes instead of forcing everything through a
static site shape.

Changes:
- Added `mode: "worker"` to `deploy_site`.
- Worker mode posts to Sites Publish `POST /api/sites/:slug/deploy-worker`.
- Static deploys still require `index.html`; worker deploys do not.
- Build-backed deploy results can now report `mode: "worker"`.
- Increased `build_command` length to support framework build/deploy pipelines.
- Updated the TinyFat agent contract and prompt with explicit EmDash and
  Payload/OpenNext packaging instructions.
- Added a test proving worker-mode deploys call `/deploy-worker` and return the
  Worker deploy result.

## Verification

- `flight`: `npm run typecheck` passed.
- `flight`: `npm test` passed 40/40 tests.
- `flight`: `npm run build` passed. The build emitted only the existing
  `punycode` deprecation and plugin timing notices from the toolchain.
- Deployed Flight with version `c6e8f6a1-01ef-48d3-9aeb-6b89fdd5b241`.
- `https://flight.tinyfat.com/health` returned 200 with `{ "ok": true }`.

Live framework QA:
- EmDash: `https://main-floopy-emdash-live.tinyfat.dev/blog/` returned 200 and
  listed seeded posts.
- Payload: `https://main-floopy-payload-live.tinyfat.dev/` returned 200,
  `/api/posts?limit=10` returned three posts, `/admin` returned 200, and direct
  `_next/static` CSS/JS/media URLs returned 200.

## Notes

The successful Payload path uses the official Payload Cloudflare/D1 template,
OpenNext Cloudflare build output, a Wrangler dry-run bundle, D1 binding `D1`, R2
binding `R2`, and a non-empty `PAYLOAD_SECRET` var in the artifact
`wrangler.json`.

Flight still delegates actual framework build work to its configured build
surface. The important contract is now explicit: once a Worker artifact exists
under `/workspace`, `deploy_site` can ship it without flattening it into a
static site.
