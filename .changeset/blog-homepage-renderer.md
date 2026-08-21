---
"awcms": minor
---

feat(blog-content): the composed homepage is finally rendered to a reader

`listActiveHomepageSectionsForRendering` has existed since `sql/044` with zero
callers. A tenant could compose a homepage and no reader would ever see it.

`/blog/{tenantCode}` now renders that composition above its chronological
listing, on page 1 only — pages 2..n are the archive, and repeating a curated
front page above each of them would put the same articles on every page.

**The deterministic fallback (PRD §10).** A curated slot whose articles have all
been unpublished would render a heading over nothing, which reads as a broken
site rather than an editorial gap. Such a slot is filled from the most recent
eligible articles instead — from one shared pool, consumed in order, excluding
every article already placed above it, so a fallback can never duplicate an
article the editor curated three sections up. `latest_posts` and `category_grid`
are deliberately NOT rescued: they already query live content, and substituting
unrelated articles would answer a different question than the editor asked.

**A section that resolves to nothing is dropped, heading included** — and if
every section drops out, the page is exactly what a tenant who never opened the
composer sees. A front page cannot come out blank.

**The query count is a constant.** This is an anonymous page, so an unbounded
query count is an expense a stranger chooses. Curated post ids, category slugs
and images are each resolved in ONE bulk query for the whole page; only
per-section list queries remain, capped by `MAX_RENDERED_SECTIONS` and
`MAX_CATEGORY_GROUPS`, both of which log what they dropped rather than
truncating silently.

Part of #594.
