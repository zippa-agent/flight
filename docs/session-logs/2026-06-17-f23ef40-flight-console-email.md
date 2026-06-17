# 2026-06-17 f23ef40 - Flight Console And Email Runtime

Purpose: make Flight usable by the existing TinyFat web chat UI and email
surface for the first `runtime=flight` agent, Floopy.

Flight commit being shipped:

- `f23ef40db93973d83992535ec1ed8e4ded9f17b0` - Add Flight console and email runtime paths.

What changed:

- Added Supabase cookie auth and ownership checks for Flight console routes.
- Added `/agents/:id/` shell and `/api/v2/agents/:id/*` console-compatible
  status, describe, events, stream, message, and stop routes.
- Reused the existing web chat assets while translating Flue events into the
  current console stream contract.
- Replaced Worker loopback prompt fetches with in-process `flue()` routing to
  the generated Durable Object, avoiding Cloudflare 522 self-fetch failures.
- Added per-agent TinyFat Fireworks proxy registration using each agent's
  `tools_token`.
- Added normalized Flight email webhook handling that prompts the scoped agent
  and sends replies through the TinyFat email send API.

Verification before and after deploy:

- `npm run typecheck`
- `npm test`
- `npm run build`
- Live browser API smoke for Floopy returned `200`, streamed final text
  `floopy final smoke ok`, and emitted one `run_complete`.
- Live visible UI test sent through the textarea and rendered
  `floopy visible ui ok`.
- Direct Flight email webhook returned `200` and Resend message id
  `be33ba0f-8b71-4bee-91e1-160fa232e56b`.
- End-to-end Gmail to `floopy@tinyfat.ai` replied with
  `floopy inbound email ok`.

Deploy status:

- Deployed Flight Worker to Cloudflare.
- Current Version ID: `9706d973-0c9f-4252-bf75-3fee33934982`.
- Routes: `https://flight.alexgarcia042.workers.dev` and
  `https://flight.tinyfat.com`.

Manual QA gaps:

- Existing failed early test events remain in Floopy's Flight SQLite history.
- The console UI still uses the current Crawdad-built asset filenames; this is
  a compatibility bridge, not a rebuilt Flue-native frontend.
