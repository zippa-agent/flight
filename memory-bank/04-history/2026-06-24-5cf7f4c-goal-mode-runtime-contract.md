# Goal Mode Runtime Contract Fix

Commit: `5cf7f4c` (`Fix goal mode runtime contract`)

## Summary

- Repaired malformed multiline string literals in goal-state rendering, prompt assembly, runtime contract text, and tool catalog scoring.
- Changed live goal injection so only active goals are surfaced in agent instructions; completed and abandoned goals remain persisted but do not keep steering future turns.
- Updated `set_goal`, `complete_goal`, and `abandon_goal` to return string tool results that satisfy the Flight tool runtime contract.
- Added direct tests for setting, completing, and abandoning goals through the actual tools.
- Updated tool availability expectations for workspace-backed goal tools.
- Tightened `/goal` UI copy to describe setting the active goal, not viewing one.

## Verification

- `node scripts/patch-flue-tool-labels.mjs && npx tsx --test test/goal-state.test.ts test/goal-tools.test.ts test/tool-policy.test.ts test/tool-catalog.test.ts test/prompt-honesty.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Deploy Status

Not deployed. This commit is intended for PR #6 (`feat/goal-mode`).

## Manual QA Gaps

- Did not manually exercise `/goal <text>` through the web UI.
- Did not run a live agent turn to confirm the model chooses `set_goal` from the `/goal <text>` prompt.
