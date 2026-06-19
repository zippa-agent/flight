# Domain Route Preflight Tool

Date: 2026-06-19

Commits:

- `a3d2dbf` (`flight`) - `feat: add domain route preflight tool`

## Summary

Added `domain_route_preflight` to Flight so Floopy can check TinyFat's
Cloudflare for SaaS provider readiness before attempting a mutating
custom-hostname route preparation.

Updated:

- Flight domain tools request contract.
- Tool catalog discovery metadata.
- Website-manager skill instructions.
- Domain tool tests and registry expectations.

## Verification

Local:

- `npm test` passed: 80 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

Server (`tiny-bat`):

- `npm test` passed: 80 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

Deploy:

- Flight deployed at Worker version `85fcb61e-585c-4bad-8382-ef57b792e932`.
- `https://flight.tinyfat.com/health` returned `{"ok":true,"service":"flight"}`.

## Live QA

With Floopy's real tools token, the corresponding broker preflight endpoint for
`tinyfat.blog` returns `ready: false`, `reason: "quota_unallocated"`, and
`nextAction: "Enable or allocate Cloudflare for SaaS Custom Hostnames for the
provider zone before route preparation."`

No secrets were committed. Tests use fake service-role/tools-token values.
