# 2026-06-19 - `60e04e9` - Flight Workspace Identity Context

Commit shipped:

- `60e04e9` - `feat: load Flight workspace identity context`

## Summary

Ported Troublemaker's workspace identity-context loading shape into Flight's
edge runtime. Before each turn, Flight now loads available parent-agent
`/workspace` files from the R2 workspace:

- `BOOTSTRAP.md`
- `AGENTS.md`
- `IDENTITY.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `BRIEF.md`
- `memory/<today>.md`
- `memory/<yesterday>.md`

`BOOTSTRAP.md` short-circuits the broader identity stack, matching
Troublemaker's behavior. Without bootstrap, Flight renders the same labeled
identity, memory, brief, and recent-memory sections into the agent
instructions. The capability contract now states that these files are loaded
when present instead of claiming the beta runtime cannot load them.

## Verification

- Server `tiny-bat`, `~/code/tinyfatco/flight`:
  - `npx tsx --test test/workspace-context.test.ts test/prompt-honesty.test.ts`
    passed, 7/7.
  - `npm run typecheck` passed.
  - `npm test` passed, 56/56.
  - `npm run build` passed.
- Deployed Flight with Workers token:
  - Version: `6a87b7b2-4ddd-4907-887d-d0a81a34654e`
  - Routes: `https://flight.alexgarcia042.workers.dev`,
    `https://flight.tinyfat.com`

## Manual QA Gaps

- Unit tests verify R2 key loading, prompt injection, bootstrap precedence, and
  the empty-memory fallback. I did not mutate Floopy's live identity files just
  to prove the prompt path in production.
- The local Mac checkout still cannot run Flight tests until the existing
  `package-lock.json` drift is resolved; `npm ci` reports missing optional
  Rolldown package entries. Server verification remains the source of truth for
  this deploy.
