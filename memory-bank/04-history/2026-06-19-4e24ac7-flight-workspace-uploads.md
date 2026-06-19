# 2026-06-19 - Flight Workspace Uploads and Content Tools

Commits:

- `flight` `4e24ac7` - added dashboard workspace uploads, email attachment persistence, prompt/tool honesty updates, the `browser_content` tool, and a Flight website-manager skill.
- `fat-skills` `f98286f` - documented Flight runtime website/content-store practices in `tinyfat-project-builder`.

Verification:

- `npm run typecheck` passed on `tiny-bat`.
- `npm test` passed on `tiny-bat`: 43/43 tests.
- `npm run build` passed on `tiny-bat`.
- Deployed Flight to `flight.tinyfat.com`; Cloudflare version `88ba1653-e7ff-445e-8a63-d4912d0efc90`.

Live QA:

- Chrome dashboard upload succeeded for `floopy-dashboard-upload-20260619.txt`.
- Floopy read `/workspace/uploads/2026-06-19/floopy-dashboard-upload-20260619.txt` and saw `DASHBOARD_UPLOAD_MARKER_20260619_FLIGHT`.
- Floopy used `set_site_binding`, deployed the existing Astro test project to `floopy-payload-live`, then uploaded the marker file through `upload_site_content`.
- Direct public verification passed for `https://main-floopy-payload-live.tinyfat.dev/__tinyfat/content/qa/floopy-dashboard-upload-20260619.txt`.

Gaps:

- Floopy's `browser_content` verification errored on the plain content URL even though direct `curl` returned the marker. Follow-up: make the browser/rendering content path handle plain text or surface a clearer fallback.
- Live `gog` email attachment QA could not be sent: local `gog` returned `invalid_grant` for `alex@tinyfat.com`, and `tiny-bat` noninteractive `gog` needs `GOG_KEYRING_PASSWORD`. Unit coverage verifies attachment persistence and model-visible workspace paths.
