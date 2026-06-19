---
name: flight-website-manager
description: Manage TinyFat website content from Flight web chat and email using workspace files, dashboard uploads, email attachments, browser inspection, and site deploy/content tools.
---

# Flight Website Manager

Use this skill when a user asks you to create, edit, deploy, inspect, or place
website content through a Flight-managed TinyFat site.

## Runtime Ground Truth

Flight's durable workspace is `/workspace`. Files uploaded through the dashboard
and email attachments are written into that same workspace. Use only tools that
the current Flight capability contract lists for the turn.

If a tool is not listed, do not claim to have used it. Explain the missing
capability and continue with the closest honest workflow.

## Uploaded Files And Email Attachments

When the current message includes workspace paths under `/workspace/uploads/` or
`/workspace/attachments/email/`, treat those as real files already available in
the workspace. Do not ask the user to resend them before inspecting or uploading
them.

To publish a file into a site's content store:

1. Identify the target site slug and desired content key.
2. Ensure the site has an R2 content binding with `set_site_binding` when the
   binding is not already known.
3. Call `upload_site_content` with `source_path` set to the uploaded workspace
   path, `key` set to the object path the site should read, and `binding`
   normally set to `MEDIA`.
4. Tell the user the content URL shape:
   `/__tinyfat/content/<key>`.

For text snippets that arrive in chat or email without a file, call
`upload_site_content` with inline `content` instead.

## Website Placement

Uploading content does not automatically place it on a page. If the user asks to
position a file in a specific place, update the site's source in `/workspace`
using the normal file tools, reference the content URL from the relevant page or
component, then call `deploy_site`.

For Payload or other Worker-based apps, preserve the Worker deploy shape. Do not
flatten a framework runtime into static files unless the app is actually static.

## Browser Inspection

Use `search_tools` when you need the exact current browser or domain tool name.

Use `browser_content` when you need public-page visible text and links. Use
`browser_evaluate` when you need structured DOM metadata, forms, scripts,
canonical URLs, or computed page state. Use `browser_screenshot` or
`browser_pdf` when the user needs a visual artifact; those tools save binary
artifacts under `/workspace/browser-artifacts/` and return the workspace path.
Use `browser_session` for multi-step public-page inspection where navigation
state matters.

All Flight browser tools use TinyFat's remote browser rendering API. They cannot
access private URLs, localhost, or a user's logged-in Chrome session. If
`browser_content` returns `mode: "direct_text_fallback"` for a TinyFat
content-store URL, treat the returned `text` as successful public content
verification.

## Domains And DNS

Domain tools are available only when the current capability contract lists them.
Use `search_tools` with category `domain` to discover exact names. Never pick,
prepare, or onboard a domain unless the user has explicitly confirmed the exact
domain first. Prefer this flow:

1. Use `domain_list` or user-provided registrar context to identify candidates.
2. Ask the user to confirm the exact domain.
3. Call `domain_onboard_prepare` only for the confirmed domain.
4. Share the returned nameserver instructions.
5. Use `domain_onboard_status` after delegation.
6. Use `dns_records_list`, `dns_snapshot_create`, `dns_change_plan`,
   `dns_change_approve`, and `dns_change_apply` for managed DNS changes.
   Call `dns_change_approve` only after explicit user confirmation of the
   exact high-risk change set.

## Replies

On web chat, ordinary assistant text is visible to the user. On email and other
messages-only surfaces, use `send_message` when it is listed; otherwise ordinary
assistant text is internal only.
