---
"awcms": minor
---

feat(admin-ui): an article can finally be given a category, channel and topic

`POST`/`PATCH /api/v1/blog/posts` have accepted `termIds` since Issue #539, and
no screen had ever sent one. So every article published with no category, no
channel and no topic — and `sql/131` had just split those into four real
vocabularies that nothing could assign.

Both article forms now carry a term picker.

### The recorded blocker had an answer that cost nothing

`/admin/blog`'s header stated the obstacle plainly:

> a picker needs the taxonomy catalogue, and reading it under this screen's
> `posts.*` gates would be a read with no permission of its own

That is true of a **server-side** read, which is why the screen was pinned to
eleven permission keys. It is not true of a browser fetch against
`GET /api/v1/blog/terms`, which enforces `blog_content.taxonomies.read` itself —
the same resolution the media picker reached in #612.

So the eleven-key contract stands, unborrowed. A test asserts no `taxonomies`
gate appears on the page.

### Two load-bearing details

**`termIds` is sent only when the vocabulary actually loaded.** Absent means
"leave the assignments alone"; `[]` means "remove them all". A failed fetch that
sent `[]` would **silently strip every category the post already had** on the
next save, with no error anywhere. The picker marks its host `data-failed` and
the payload omits the field entirely in that case.

**All four vocabularies render, including empty ones.** An absent group reads as
"this build has no channel picker" — a different and wrong conclusion from "no
channels defined yet".

### Prefill costs one query, not N

`fetchPostTermIds` already existed. It runs once, for the single post being
edited, awaited sequentially inside the screen's existing transaction — not in
the list, where per-post terms are the N+1 `listBlogPostsForAdmin` avoids on
purpose.

### A term whose vocabulary this build does not know is dropped

Rather than rendered under an unlabelled heading. `TAXONOMY_TYPES` is the shared
runtime constant, so a fifth type added server-side surfaces as an omission
somebody notices, not as a mystery group — the same failure mode
`CONTENT_BLOCK_TYPES` exists to prevent.
