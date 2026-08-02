---
"awcms": patch
---

fix(blog-content): `/admin/blog`'s Restore control could never work

`listBlogPostsForAdmin` hard-filtered `deleted_at IS NULL`, so a soft-deleted
post was never on screen, and the console offered no way to see the bin. The
Restore control was therefore hung off `status === "archived"` — a different
axis. An archived post is not soft-deleted, and `POST .../restore` requires
`canRestorePost` (`deleted_at IS NOT NULL`), so the button was rendered exactly
where it must answer 404, and never where it would succeed.

The delete confirmation already promised the opposite ("It is soft-deleted —
recoverable until it is purged"), a promise the UI could not keep.

`listBlogPostsForAdmin` gains a `deletedOnly` filter and the screen gains a
`?view=deleted` bin. Restore now belongs to bin rows; the lifecycle controls
belong to live rows, because `transitionBlogPostStatus` also matches
`deleted_at IS NULL`; Purge appears in both, because `canPurgePost` accepts
archived or soft-deleted.

No schema change.
