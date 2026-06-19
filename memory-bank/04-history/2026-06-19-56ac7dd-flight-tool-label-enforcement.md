# 2026-06-19 - `56ac7dd` - Flight Tool Label Enforcement

Commit shipped:

- `56ac7dd` - `feat: enforce Flight tool call labels`

## Summary

Added Flight-side parity with Troublemaker's model-assigned tool labels for
the visible tool rows in the Flight UI. Tool rows now use the top-level
`toolCall.label` as the primary title instead of falling back to function names
like `read`, `upload_site_content`, or `browser_content`; the tool arguments
remain available as the subtitle/detail surface.

Enforcement now happens at the Flue boundary. Flight carries a checked-in patch
script for `@flue/runtime@1.0.0-beta.1` that:

- adds required `label` parameters to Flue tool schemas,
- wraps built-in, adapter, and custom tool execution so missing labels fail
  before tool side effects,
- strips `label` before calling the actual tool implementation, and
- emits top-level `tool_start.label` values for stream/UI consumers.

Flight's stream bridge, awareness parser, web chat reducer, and tool display
components now preserve and prefer top-level labels, with legacy
`arguments.label` support only as a fallback. `send_message` subtitles also
preview Flight's `body` argument and format `email-thread:<id>` as
`Email thread`.

## Verification

- Server `tiny-bat`, `~/code/tinyfatco/flight`:
  - `node scripts/patch-flue-tool-labels.mjs` patched the installed Flue
    runtime bundles.
  - `node --check` passed for the patched Flue runtime bundles.
  - `npx tsx --test test/flue-tool-label-patch.test.ts test/stream-contract.test.ts test/tool-label-ui.test.ts test/prompt-honesty.test.ts`
    passed, 16/16.
  - `npm run typecheck` passed.
  - `npm test` passed, 62/62.
  - `npm run build` passed.
  - Built `dist/flight/index.js` contains the required-label enforcement and
    `tool_start.label` emission.
- Deployed Flight with Workers token:
  - Version: `9c4390f6-6030-4c49-892f-5968cd5ee427`
  - Routes: `https://flight.alexgarcia042.workers.dev`,
    `https://flight.tinyfat.com`

## Manual QA Gaps

- I did not run a fresh live Floopy browser turn after deploy. The unit and
  build artifact checks cover the schema/enforcement path and the UI reducer
  path, but a live model turn would still be useful to observe label wording
  quality in Chrome.
- This is a local runtime patch against `@flue/runtime@1.0.0-beta.1`. A future
  Flue upgrade should either upstream this behavior or update the patch script
  when generated bundle internals change.
