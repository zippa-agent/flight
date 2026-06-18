# 2026-06-18 - Flight Email Astro Build and Deploy

## Commits

- `flight` `4d29415` - Ship Flight email deploy flow.
- Related platform fix: `fat-platform` `8d61dab` - Use TLS-safe site preview labels.

## Summary

Flight email turns now use the default agent/web scope, so first-party email and the default web chat land in one shared awareness context. Email ingress drives the Flue stream inline instead of relying on a post-response `waitUntil` mirror, which lets long tool runs such as container builds reach terminal completion before the webhook returns.

`deploy_site` now builds unbuilt npm/Astro workspaces in the TinyFat/Crawdad container, reads the built artifact back, and publishes the static output through TinyFat Sites. The Flight prompt, tool contract, and tinyfat agent notes now describe that behavior. Large tool results and awareness tails are clipped before being stored or injected so a verbose build log cannot poison the next turn.

## Verification

- `npm test` passed: 26 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Flight deployed to Cloudflare Worker version `caf3115e-2331-4eac-b247-e57837ecd9cf`.

## Live QA

- Sent real Gmail mail from `alexgarcia042@gmail.com` to `floopy@tinyfat.ai`.
- Crawdad accepted the email, authorized Alex as the owner, and bridged it to Flight.
- Flight durable stream for Floopy showed:
  - `write` calls creating an Astro project under `/workspace/astro-host-qa`.
  - `deploy_site` called with `build: true`.
  - container build completed with `npm install` and `astro build`.
  - `send_message` called successfully.
- Final deployed site returned HTTP/2 200 over HTTPS with normal TLS:
  `https://main-flight-floopy-astro-host-20260618023644.tinyfat.dev/`.
- The served page contained the requested marker text:
  `Flight Astro host-match deploy QA 20260618T023644Z`.
- Resend confirmed the Floopy reply was delivered to `alexgarcia042@gmail.com`
  with id `bebd2990-d9ac-4a98-aec9-f886e6af313c`.

## Notes

- Gmail CLI did not list the final reply as a separate mailbox row, but the
  Flight stream, `emails_outbound` log, and Resend API all confirmed the
  outbound reply as sent/delivered.
- The build artifact shuttle currently reads a base64 tarball back through the
  Crawdad console file route. This is adequate for the small Astro proof, but
  larger sites should get a direct artifact transfer path.
