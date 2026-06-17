# 2026-06-17 - Flight R2 Workspace

## Commits

- `a97e373cd0ed040faf7de15d5a8e11fb4e8ab0f5` (`flight`) - Add R2-backed Flight workspace.

## Summary

- Created the Cloudflare R2 bucket `tiny-agents`.
- Added the `FLIGHT_WORKSPACE` R2 binding to Flight's Worker config.
- Replaced Flight's default in-memory Flue sandbox with an R2-backed sandbox adapter.
- Mapped `/workspace/...` to `tiny-agents/tiny-agents-data/<tinyfat-agent-uuid>/...`.
- Scoped workspace files by parent TinyFat agent UUID rather than relationship scope.
- Kept relationship awareness scoped separately from shared agent files.
- Made generic bash explicitly unavailable in the R2 workspace until a dedicated platform build/deploy tool exists.
- Updated Flight runtime honesty prompts and architecture docs to describe the new storage contract.

## Verification

- `npm test` passed: 20 tests.
- `npm run typecheck` passed.
- `npm run build` passed and regenerated the Worker/UI bundle.
- Verified `dist/flight/wrangler.json` includes `r2_buckets: [{ binding: "FLIGHT_WORKSPACE", bucket_name: "tiny-agents" }]`.
- Added tests for UUID owner derivation, exact R2 key layout, cross-session workspace persistence, outside-`/workspace` rejection, unsupported bash, and recursive directory deletion.

## Deploy

- Deployed Flight to Cloudflare with `CLOUDFLARE_API_TOKEN=$(cat ~/.config/cloudflare/workers-token) npm run deploy`.
- Worker binding output confirmed `env.FLIGHT_WORKSPACE (tiny-agents)`.
- Cloudflare Worker version: `9e6362ad-85e1-44bf-9556-8763b2f4a271`.
- Routes: `https://flight.alexgarcia042.workers.dev`, `https://flight.tinyfat.com`.

## QA Gaps

- Live web-chat QA against Floopy was not run in this session after deploy.
- The Flue default tool surface may still expose a `bash` tool, but the R2 sandbox returns a clear unsupported result. A future pass should decide whether to replace Flue's default sandbox tools to remove generic bash entirely.
- The dedicated `deploy_site` platform tool remains future work.
