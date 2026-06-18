# 2026-06-18 - Flight Email Threading And Tool Persistence

Commits:

- `65d200c` - Fix Flight email threading and tool persistence

Summary:

- Fixed Flight awareness persistence so final assistant snapshots no longer duplicate tool calls that are already persisted through `tool_start`/`tool` events.
- Added a UI backlog normalizer that hides already-persisted duplicate standalone tool-call entries while preserving carried tool results for older stored rows.
- Added Flight email helpers mirroring the Troublemaker pattern:
  - quote stripping for Gmail/original-message reply bodies before model-visible context
  - normalized `In-Reply-To` / `References` header handling
  - quoted reply-body composition for `send_message`
- Kept default email ingress scoped to the unified `agent/web` context shared with web chat.

Verification:

- `npm test` passed: 32 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

Deploy:

- Pending at log creation; deploy this commit with `npm run deploy` after push.

Manual QA Gaps:

- Need live browser reload check against an existing Flight conversation with older duplicated tool rows.
- Need live email QA from Gmail to verify quote stripping against the actual inbound payload shape and confirm the reply lands with native threading.
