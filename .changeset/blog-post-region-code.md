---
"awcms": minor
---

feat(blog_content): `regionCode` is now writable and readable through the blog posts API (Issue #1312). `awcms_blog_posts.region_code` (sql/131) and its `region` `site_search` facet already existed but no endpoint could fill or return the column. `POST`/`PATCH /api/v1/blog/posts(/{id})` accept an optional `regionCode` (a dotted `idn_admin_regions` code, validated by the same function as an institution's `regionCode`; `null` clears it, an absent field on `PATCH` leaves it unchanged) and every post projection, including the `?view=full` feed traversal, returns it (`null` when unset). Additive to the frozen `GET /api/v1/blog/posts` consumer contract (ADR-0065). No migration; no existence check against `idn_admin_regions`, by the sql/131 design.
