---
"awcms": patch
---

fix(blog-content): publishing an article from /admin/blog now purges the edge cache (#623)

ADR-0042 §Rule 21 requires every handler that changes content to enqueue a purge
inside the same transaction. For `blog_content`, five post lifecycle routes never
called `enqueueModuleContentPurge` at all — including `publish.ts`, which is the
endpoint the Publish button on `/admin/blog` calls.

With `EDGE_CACHE_MODE` active — and it has been on in staging since 26 July 2026
— publishing an article emitted no purge. `/blog/{code}` has a 120-second TTL and
`blog-post` 300, so it healed itself and the symptom was "the new article takes a
while to show up" rather than a hard failure. `archive` is the direction that
matters: a withdrawn article kept being served from the edge until its TTL
expired, which is the withdrawal not having happened.

Purges added to `publish`, `archive`, `restore`, `purge`, and
`revisions/{revisionId}/restore` — the last one was not in the issue's list (it
lives a directory deeper) but rewrites the body of a post that may be published
right now.

`schedule.ts` deliberately did NOT get one, against the issue's enumeration:
`ALLOWED_STATUS_TRANSITIONS` lets only `draft` and `review` become `scheduled`,
so nothing it commits is ever visible publicly, and the sweep that does publish
it already purges. Adding one would append a ban matching no cached object while
the queue reported success — the "ceremony that reads as coverage" this repo
already refuses for surfaceless module keys.

### Why no gate caught it

`edge-cache:surfaces:check` asks whether the MODULE purges somewhere, and
`blog_content` did. `tests/edge-cache-content-purge.test.ts` pinned a per-file
count for an enumerated list, and a list cannot report the file it does not
contain — its own comment said so.

The obligation is now derived: every mutating API route owned by a module that
owns a cacheable surface must either purge or carry a checkable reason it cannot
change what a reader sees. Six routes are exempt with reasons. Twenty-eight more
are recorded on a shrink-only ledger — several of them, ads and homepage sections
in particular, look like the same defect and are tracked for a follow-up rather
than buried inside a five-route fix. A new mutating handler is on neither list,
so it fails on arrival; proven by planting one, not merely observed green.
