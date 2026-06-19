# Flight SaaS Domain Route Tools

Date: 2026-06-19

Commits:

- `364bab9` (`flight`) - `feat: add SaaS domain route tools`

## Summary

Added first-class Flight tools for the Cloudflare-for-SaaS production domain
workflow:

- `domain_route_prepare` calls the domain broker route preparation endpoint
  with a managed domain, site tenant, optional hostnames, and primary hostname.
- `domain_route_status` refreshes and reads route/TLS/DNS state for managed
  domain hostnames.
- Tool catalog metadata now exposes the route tools through `search_tools`.
- The website-manager skill now tells Floopy to use SaaS custom-hostname routing
  instead of creating proxied cross-account CNAMEs to preview hosts.

## Verification

Local:

- `npm test` passed: 79 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

Server (`tiny-bat`):

- `npm test` passed: 79 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

Deploy:

- Flight deployed at Worker version `f9f328a0-84b0-4e3a-86c8-756b81b07b8c`.
- `https://flight.tinyfat.com/health` returned `{"ok":true,"service":"flight"}`.

## QA Notes

The live broker route flow is reachable from Floopy's real tools token. The
route prepare call now reaches Cloudflare and fails on the upstream entitlement:
Cloudflare returns `1404 No quota has been allocated for this zone or for this
account` for `tinyfat.dev` custom hostnames. This confirms the remaining blocker
is Cloudflare for SaaS allocation/enrollment, not Flight tool wiring.

No secrets were committed. Test fixtures contain fake tokens only.
