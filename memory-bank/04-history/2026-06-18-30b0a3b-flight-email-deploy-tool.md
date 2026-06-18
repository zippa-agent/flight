# 2026-06-18 - Flight Email Ingress and Static Site Deploy Tool

## Commit

- `30b0a3b` - Add Flight email turn context and site deploy tool

## Summary

Flight email ingress was reaching `/webhooks/email/:agentId`, but the agent did not receive the Flight turn payload when Flue initialized the created agent. The model therefore believed `send_message` was unavailable and completed with internal assistant text instead of sending email.

This commit replaces the webhook path's blind `dispatch()` admission with direct Flue prompt admission plus an R2-backed turn context pointer keyed by Flight instance id. The created-agent initializer now resolves the latest turn context for that scoped instance, so messages-only email turns expose `send_message` correctly. The old unused `dispatchTurn` path was removed to avoid preserving the broken payload contract.

The commit also adds `deploy_site`, a Flight tool that publishes already-built static files from the R2 `/workspace` through the existing TinyFat Sites publish API. It intentionally does not run `npm install`, Astro builds, or Payload builds; unbuilt app directories return a clear tool error.

## Verification

- `npm test` passed: 25 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Deployed Flight Worker version `1c6dc910-dff1-456f-a74c-33d12e7cf553`.
- `https://flight.tinyfat.com/health` returned `{ ok: true, service: "flight" }`.

## Live QA

- Sent internal Gmail test to `floopy@tinyfat.ai` from `alexgarcia042@gmail.com`.
- Crawdad accepted and bridged the email to Flight.
- Flight event stream showed `send_message` tool call succeeded.
- Gmail thread received Floopy's reply: `reply-flight-email-ingress-20260618T012750Z`.
- Prompted Floopy through the Flue agent route to create and deploy a one-file static site.
- `deploy_site` tool succeeded for `flight-floopy-qa-20260618012942` and returned deployment metadata.
- The deployed preview served expected HTML over HTTP at `http://main.flight-floopy-qa-20260618012942.tinyfat.dev/`.

## QA Gaps

- The publish API returned `https://main.<site>.tinyfat.dev/`, but curl hit a TLS handshake failure on that nested preview host. Plain HTTP served the deployed page. This appears to be an existing TinyFat Sites domain/certificate issue, not a Flight tool packaging failure.
- `deploy_site` is static-only. A dedicated build-and-deploy container shuttle is still needed for Astro/Payload projects that require install/build before publishing.
