# 2026-06-19 - Flight DNS Approval Tool (`d3ceaa1`)

## Commits

- `d3ceaa1` (`flight`) - `feat: add explicit DNS approval tool`

## What Changed

- Added the `dns_change_approve` Flight tool so agents can approve high-risk
  DNS change sets after explicit user confirmation.
- Updated `dns_change_apply` wording, the searchable tool catalog, the runtime
  contract, and the Flight website-manager skill to describe approval as a
  first-class domain workflow step.
- Added tests covering the approval request shape and the registry/catalog
  exposure for the new tool.

## Verification

- Local `npm test`: passed, 77/77.
- Local `npm run typecheck`: passed.
- Local `npm run build`: passed.
- Server `npm test`: passed, 77/77.
- Server `npm run typecheck`: passed.
- Server `npm run build`: passed.
- Deployed Flight through Wrangler. Version ID:
  `c694aebb-d0a7-4af1-9238-b75f37d0af92`.

## Live QA

- In Floopy's live Flight web chat
  (`d5848746-66d6-44df-908e-7fce86a598d4`), the agent used
  `dns_change_approve` and `dns_change_apply` successfully for
  `tinyfat.blog`.
- Change set `47aec6b4-a24e-46b8-8703-a00219314e2a` created the initial DNS
  alias and mail-preservation records.
- Follow-up change set `0846a7c6-e28a-41b5-a246-df951a3bdc3f` corrected the
  web CNAME target to the live TinyFat dev deployment:
  `main-flight-floopy-payload-blog-20260618.tinyfat.dev`.
- `dns_records_list` verified the final CNAME, MX, and TXT records in TinyFat
  DNS.

## Manual QA Gaps

- Public recursive DNS still showed the old Namecheap nameservers immediately
  after registrar update; this is propagation delay.
- Cloudflare zone status remained `pending_nameservers` until registry and
  recursive DNS delegation catches up.
