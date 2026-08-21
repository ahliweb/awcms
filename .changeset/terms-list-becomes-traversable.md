---
"awcms": patch
---

feat(blog-content): the tag vocabulary can finally be read past its hundredth entry

`GET /api/v1/blog/terms` ended in a bounded `LIMIT`, ordered by name, and
returned a bare array. Nothing in that answer distinguishes "this tenant has
ninety tags" from "this tenant has three thousand tags and you are holding the
alphabetically-first hundred". There was no cursor, no total, no flag — the
only honest reading of a full page was "there may or may not be more, ask
somebody".

For `category` and `channel` the bound was right and stays right: a newsroom
has a dozen of each, and the endpoint's own comment called terms
"low-cardinality config". For `tag` it was never right. A tag vocabulary grown
over the 23,906-article archive of Issue #599 runs to thousands of entries, and
a static build generating one archive page per tag would build a hundred pages,
green, with every article filed under a later tag linking into a page nobody
generated. The failure is invisible from both ends: the server answered every
question it was asked, and the client got well-formed data.

`?order=created_at` now selects a stable keyset traversal and the response
carries `nextCursor`; follow it until it is null. `?limit=` is accepted (default
100, max 200). `?cursor=` without `?order=created_at` is refused with `400`
rather than quietly honoured, because `name` is editable: renaming a term moves
it across a page boundary, so a cursor over the alphabetical ordering skips or
repeats terms and neither side can tell. That is the same refusal, for the same
reason, that `GET /api/v1/blog/posts` already makes about `updated_at`.

The default list is deliberately unchanged — the admin taxonomy screen wants
names in alphabetical order, and a screen showing a page is not lying about
anything. What changed is that a caller which needs the whole vocabulary now has
a way to say so, and a way to know when it has it.

`tests/integration/blog-term-cursor.integration.test.ts` asserts the traversal
against a real PostgreSQL over rows inserted by a single statement — sharing a
`created_at` to the microsecond, the shape that reduced page two to zero rows
before Issue #158 — and also asserts the default list's truncation head-on,
because that behaviour is still there and is the reason any of this was needed.
