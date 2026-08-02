---
"awcms": minor
---

feat(blog-content): blog pages can be published (ADR-0057)

`pages.publish`, `pages.archive`, `pages.restore` and `pages.purge` have been
seeded since `sql/036` and enforced by nothing. That was not a spare catalogue
row: `createBlogPage` wrote a literal `'draft'`, `updateBlogPage` never touched
`status`, and the scheduled-publish job reads only posts — so **no code path
could publish a page**, while public page search filtered on
`status = 'published'` and always returned nothing.

Four guarded, audited, `Idempotency-Key`-bearing routes close it:
`POST /api/v1/blog/pages/{id}/publish`, `/archive`, `/restore`, `/purge`.
Publish runs the same content-quality checklist posts do, which the page
preview endpoint has been reporting with nothing to gate.

The page lifecycle is deliberately narrower than posts' — no `review`, no
`scheduled`, since no `pages.schedule` permission was ever seeded. `purge`
reports the ad placements it leaves inert rather than refusing or cascading.

Also adds `bun run access:permissions:enforcement:check`: every declared
permission must have an `authorizeInTransaction` guard or a recorded reason.
It found five further gaps beyond pages, all now recorded and tracked.

No migrations — the columns, CHECK, index and catalogue rows already existed.
