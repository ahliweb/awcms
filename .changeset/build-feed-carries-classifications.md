---
"awcms": patch
---

feat(blog-content): the build feed finally says which category an article is in

`GET /api/v1/blog/posts?view=full` is the traversal a static site is generated
from — every column of a post, walked to the end with a cursor. It carried
everything except the one thing an archive is built out of: `termIds`. The
comment explaining why was honest and its conclusion did not follow —
`fetchPostTermIds` takes one post, so attaching it per row would have been one
extra query each, and the answer taken was to leave the field out entirely
rather than to fetch a page's worth at once.

What that cost was not performance. Every write path has accepted `termIds`
since Issue #539, the detail endpoint has returned them the whole time, and the
OpenAPI `BlogPost` schema declared them — so a newsroom files an article under
a category, the CMS stores it, the contract says the field is there, and the
feed is silent. `awcms-astro` therefore has no category or tag archive at all,
which is the first item Issue #597 lists.

The page now fetches both classifications for the whole page in one query each
(`fetchPostTermIdsForPosts`, `fetchPostInstitutionIdsForPosts`): three round
trips per page, not one per post. `institutionIds` (Issue #595) rides along for
the same reason — it is the same shape, filled in by the same editors, and
leaving it out would have repeated the defect one dimension over.

A post with no assignments gets `[]`, never `undefined`. Those read identically
to a consumer writing `post.termIds?.length`, and the difference decides whether
an unfiled article is reported or silently dropped from every archive. That is
also why the feed's row is its own type (`BlogPostFeedView`) rather than two
optional fields on `BlogPostView`: optional would let a caller read `undefined`
from one of the several functions that do not fetch them and conclude the
article has no categories.

**Also fixed, found in the same file:** `PATCH /api/v1/blog/posts/{id}` accepted
`institutionIds`, synced them, and then returned a body without them. A client
that re-renders from what it got back — which is what the admin screen does —
watched the institutions it had just saved disappear, and a second PATCH built
from that render would have unassigned them for real.
