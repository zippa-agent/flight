# 2026-06-19 - Browser and Domain Tool Catalog (`1bcf3de`)

## Commits

- `1bcf3de` (`flight`) - `feat: add searchable browser and domain tools`

## What Changed

- Added a first-class searchable Flight tool catalog with always-available
  `search_tools`.
- Expanded browser capability beyond `browser_content` with
  `browser_evaluate`, `browser_screenshot`, `browser_pdf`, and
  `browser_session`.
- Added Flight-native domain and DNS tools that broker through the agent's
  TinyFat tools token:
  `domain_list`, `domain_onboard_prepare`, `domain_onboard_status`,
  `dns_records_list`, `dns_snapshot_create`, `dns_change_plan`,
  `dns_change_apply`, and `domain_export`.
- Updated the Flight website-manager skill and runtime contract so agents use
  `search_tools`, include required tool labels, and never pick/onboard domains
  without explicit user confirmation.

## Verification

- Local `npm test`: passed, 76/76 at the time of the commit.
- Local `npm run typecheck`: passed.
- Local `npm run build`: passed.
- Server `npm test`: passed, 76/76 at the time of the commit.
- Server `npm run typecheck`: passed.
- Server `npm run build`: passed.
- Deployed Flight through Wrangler. Current version ID:
  `f040be93-41fe-493f-bd9b-901c59f6c496`.

## Live QA

- Tested through Floopy's live Flight web chat at
  `d5848746-66d6-44df-908e-7fce86a598d4`.
- `search_tools` discovered browser tools and rendered the model-assigned tool
  labels in the UI.
- `browser_evaluate` succeeded against `https://example.com/`, returning title,
  H1, URL, and text length.
- `browser_screenshot` succeeded against `https://example.com/` and saved
  `/workspace/browser-artifacts/2026-06-19T05-46-18-044Z-screenshot-example-com.png`
  as a PNG artifact.
- `search_tools` discovered the domain/DNS tools.
- `domain_list` succeeded and returned an empty managed-domain list for Floopy.

## Domain Onboarding Status

- Read-only Namecheap API inventory found 39 domains.
- Candidate recommendation was `tinyfat.blog` for Floopy's
  `flight-floopy-payload-blog-20260618` site.
- At this commit's original QA point, no Namecheap nameserver or DNS changes
  were made and the task was waiting for Alex to confirm the exact pairing.
- Follow-up work after Alex's confirmation is tracked in the later DNS approval
  and `tinyfat.blog` onboarding logs.

## Manual QA Gaps

- `browser_pdf` and the multi-step `browser_session` path were not exercised in
  live chat during this pass.
- Full domain onboarding required a later explicit approval tool because apex
  and mail DNS records are intentionally high-risk in the broker policy.
