---
"awcms": minor
---

feat(blog-content): `/admin/blog-pages` — the page console (ADR-0057 step 3)

Completes ADR-0057. The screen drives **all eight** `pages.*` permissions —
`read`/`create`/`update`/`publish`/`archive`/`delete`/`restore`/`purge` — four
of which had no surface at all until the previous change, and so no screen
could have driven them.

Two views, because delete and archive are different axes: the default lists
live pages, `?view=deleted` lists the bin. Control placement follows what each
endpoint accepts — Restore on bin rows, Publish/Archive/Delete on live rows,
Purge on both. `listBlogPagesForAdmin` gains the `deletedOnly` filter that makes
the bin reachable.

`pages.update` is driven through the structure fields this screen owns (title,
slug, page type, menu order), not a body editor. Re-parenting is deliberately
absent: the API performs no cycle detection, and a control that can make a page
its own ancestor is worse than none.

The status filter offers the three states a page can reach, not all five —
there is no `pages.schedule` and no review queue.

Sidebar gains a second `blog_content` entry, gated on `pages.read` rather than
`posts.read`.
