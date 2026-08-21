---
"awcms": minor
---

feat(blog-content): a static page can finally be read by a reader

`awcms_blog_pages` has had full CRUD, lifecycle, revisions, a quality checklist
and an admin screen for months, and no route ever served one. Redaksi, the
Pedoman Media Siber, the disclaimer and the privacy policy — the pages a news
site is required to keep reachable, and the ones Dewan Pers expects to find —
were writable and unservable.

`GET /blog/{tenantCode}/pages/{slug}` serves them, under a reserved segment
because posts and pages have separate slug uniqueness and one segment could not
break the tie. They are listed in `sitemap-blog.xml`, declared as the cacheable
`blog-page` surface, and locale-prefixed like every other page a human reads.

Every handler that changes a page now enqueues an edge-cache purge in its own
transaction — the two CRUD routes and all four lifecycle routes. `publish` and
`archive` matter most: they are how a page becomes reachable and how it stops
being, and neither goes through the PATCH path.

An unpublished page cannot be reached through this route by construction, and
the predicate is pinned by a test that reads the SQL rather than the rows.

Part of #594.
