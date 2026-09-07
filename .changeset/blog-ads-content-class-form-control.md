---
"awcms": patch
---

fix(blog-content): add the `contentClass` selector to `/admin/blog-ads` (Issue #789)

Issue #783/PR #788 added editorial-disclosure classification (`contentClass`: `standard | advertorial | sponsored`) to ad placements, but `/admin/blog-ads` — the only operator-facing tool that creates/edits `awcms_news_portal_ad_placements` — never gained a form control for it, so newsroom/compliance staff could not actually mark a placement `advertorial`/`sponsored` without a raw authenticated API call.

The create/edit form now has a `contentClass` `<select>` (mirroring the existing `rotationMode`/`targetType` selects), defaulting to `standard` for a new placement and pre-populating with the placement's current value when editing; the placement list now shows each row's content class. UI-only — no new endpoint, permission, or schema change; reuses the existing `blog_content.ad_placements.configure` guard already enforced server-side.
