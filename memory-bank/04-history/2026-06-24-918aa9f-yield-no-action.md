# 2026-06-24 - yield_no_action availability

Commit: `918aa9f` (`Make yield_no_action available on all turns`)

## Summary

Made `yield_no_action` a general per-turn tool instead of gating it through
the Slack-only `slackDirectlyAddressed === false` policy path.

Changes:

- `src/turns/submit.ts` now emits `allowYieldNoAction: true` for turn payloads.
- `src/tools/catalog.ts` exposes `yield_no_action` for any actual turn.
- `src/agent/contract.ts` documents the tool whenever it is available, while
  still instructing the agent to use it only when no user-visible response is
  appropriate.
- `test/tool-policy.test.ts` expectations were updated for general availability.

## Verification

Passed:

```bash
node scripts/patch-flue-tool-labels.mjs && npx tsx --test test/tool-policy.test.ts test/tool-catalog.test.ts test/prompt-honesty.test.ts
```

Known pre-existing PR #1 blockers still present after this focused change:

- `npm test` fails the Discord adapter label test and Telegram ledger grouping
  test.
- `npm run typecheck` fails because listener adapter types do not include
  `discord` and `telegram`.

## Deploy Status

Not deployed. This is a focused PR branch fix only.

## Manual QA Gaps

No live Discord or Telegram adapter QA was run. This only verifies tool
catalog/prompt policy behavior locally.
