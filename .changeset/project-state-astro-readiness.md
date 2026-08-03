---
"awcms": patch
---

Record the `awcms-astro` readiness analysis and correct two stale counts in
`docs/PROJECT_STATE.md`.

The analysis inverts a reasonable assumption: every content and session
contract `awcms-astro` actually calls is complete (five surfaces, all landed),
so what holds its ADR-0021 containment is not a missing contract. The one real
gap found is closed in the same wave, and the two that remain — a host-based
public content route and the business-scope resolver — each need their own ADR.

Also sharpens the host-resolved route entry from "follow-up" to what the code
shows: `seo_distribution` emits every canonical and `<loc>` under `/blog/{slug}`
while the only content route is `/blog/{tenantCode}/{slug}`, so for a
host-resolved tenant every sitemap and feed URL points at a 404 with no gate
red.
