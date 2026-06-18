# 2026-06-18 9122de4 Flight Site Binding and Content Tools

## Commits

- `flight` `9122de4` - Add Flight site binding and content tools.
- Related platform commit: `fat-platform` `eee4ab5` - Add site R2 content API.

## Summary

Added first-class Flight tools for site runtime resources and R2-backed content:

- `set_site_binding` provisions or reuses TinyFat Sites D1/KV/R2 bindings.
- `upload_site_content` uploads inline text or `/workspace` files into a
  deployed site's R2 content binding.
- `deploy_site` now shares the site API/token helper with the new tools.
- The Flight prompt and capability contract now describe the intended order:
  set bindings, deploy, then upload site content.

## Verification

- `npm test` passed: 39 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Deployed Flight Worker version `c43e3ce2-d680-49eb-86bb-da9fe35e5e00`.

## Live QA

- Invoked Floopy (`d5848746-66d6-44df-908e-7fce86a598d4`) through the Flight
  webhook route with the live Flight token.
- Floopy created two Astro blog workspaces, set `MEDIA` R2 bindings, deployed
  both sites, uploaded `posts.json`, patched client-side fetching, and redeployed:
  - `https://main-flight-floopy-mdash-blog-20260618.tinyfat.dev/`
  - `https://main-flight-floopy-payload-blog-20260618.tinyfat.dev/`
- Content endpoints returned HTTP 200 with three posts each:
  - `/__tinyfat/content/posts.json` on the mdash demo.
  - `/__tinyfat/content/posts.json` on the Payload-shaped demo.
- Playwright browser QA rendered three `.post` cards and zero `.error` blocks on
  both deployed pages.

## Notes

- The Payload demo is Payload-shaped JSON consumed by an Astro static frontend.
  It is not a full Payload CMS server runtime; the current TinyFat Sites publish
  path still deploys static assets plus the generated tenant Worker wrapper.
- The first Floopy attempt started two `deploy_site` calls in parallel. They
  eventually completed, but the follow-up run was explicitly sequential and is
  the better operating pattern for now.
