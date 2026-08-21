---
"awcms": minor
---

feat(blog-content): the newsroom can compose its own homepage

`awcms_news_portal_homepage_sections` has existed since `sql/044` with a full
write API, six strictly-typed section shapes and a reference validator that
refuses a stale post id. Nobody could reach any of it: there was no screen, so
`homepage_sections.read` and `.configure` sat on the unscreened-permission
ledger and the homepage could only ever be whatever the frontend hard-coded.

`/admin/blog-homepage` composes it — order, schedule, enable/disable, and the
type-specific configuration of all six section types behind one polymorphic
form. `headline`, `latest_posts` and `category_grid` reference nothing ordered,
so they get real selects; the two curated types and `gallery_block` carry an
ordered id list and are typed one per line, with the eligible articles rendered
beside the field so typing an id is a lookup rather than a memory test.

Only articles a curated slot would really render are offered — published,
publicly visible, not future-dated. A picker that offered drafts would let an
editor curate a slot that silently renders nothing.

The screen adds no permission and no migration: both keys were seeded by
`sql/044` and repointed to `blog_content` by `sql/076`. What it removes is two
lines from `NOT_YET_SCREENED`, which may only shrink.

Part of #594.
