---
"awcms": patch
---

perf(blog): the scheduled publish/unpublish sweeps cost a constant, not a constant per post

The previous round left this named rather than fixed: "`blog-scheduled-publish`
calls the per-post `fetchPostTermIds` inside its sweep loop. Bounded by how many
posts are due in one sweep — which at a cutover is not small."

It was worse than a term fetch. Per due post the sweep issued a term fetch, a
managed-media enforcement read PER checklist evaluation (and it evaluates
twice), a media resolve per evaluation, an `UPDATE`, an edge-cache purge enqueue
and an audit `INSERT`. Measured against the previous implementation with twelve
due posts:

| Sweep (12 due posts)     | Before | After |
| ------------------------ | ------ | ----- |
| publish, enforcement off |     40 |     6 |
| publish, enforcement on  |     52 |     7 |
| unpublish                |     27 |     4 |

The slope is what matters: `4 + 3N`, `4 + 4N` and `3 + 2N` against a flat 6, 7
and 4. At the batch bound of 200 due posts that is 604, 804 and 403 round trips
— per tenant, on the ONE reserved `maintenance` connection the job holds, in a
job that visits every active tenant in sequence.

**Nothing in the sweep was per-post except the verdict.** Two of the three reads
are not per-post facts at all: managed-media enforcement is a property of the
tenant, and media resolution is keyed by media object id, which is tenant-wide.
Resolving the union of a batch's references in one `id = ANY(...)` returns
byte-identical rows to resolving each post's separately.

**The TOCTOU re-check got smaller, not weaker.** The sweep re-evaluates the
checklist immediately before it writes, because the referenced media objects are
not locked by the batch's `FOR UPDATE`. Batching keeps that window at one query
round trip and stops it growing with how far into the batch a post sits.
Reusing the first pass's verdicts would have removed the mitigation entirely
while looking like a tidy-up, so the second pass is still a second pass — it
just costs two queries for the whole batch instead of two per post.

**`recordAuditEvents`** is the reusable half: N audit rows in one statement,
built from a single `jsonb` parameter rather than one array per column. Bun's
array binding cannot carry a NULL — it writes the literal string `null` without
throwing — so an `unnest` over this table's eight nullable columns would have
been eight chances to be silently wrong. `recordAuditEvent` is now a batch of
one, so the two forms cannot drift.

`evaluateContentQualityChecklistForContent` is likewise a batch of one over the
new `evaluateContentQualityChecklistForBatch`, so the interactive
publish/schedule endpoints and the sweep cannot come to disagree about what the
checklist says.

**And the audit writer's two ADR-0091 columns are now asserted where they are
decided.** `tests/two-sided-attribution.test.ts` guards them by reading the
source as text, which proves a spelling rather than a row — it failed on this
change while the behaviour was intact. It stays (it is cheap and needs no
database) but is no longer the only witness:
`tests/integration/audit-log-writer.integration.test.ts` reads both columns back
out of the table, along with NULL handling, `jsonb_typeof(attributes)`,
per-row redaction, the one-statement budget, and the RLS refusal of a batch
carrying a foreign tenant's row.

**The third open item from that round is now measured, and the answer is no
change.** The hypothesis was that `awcms_blog_post_terms_tenant_idx` is a
redundant single low-cardinality column and a `(tenant_id, term_id)` composite
would serve both it and the category archive. Against 24,000 posts: the archive
uses neither index for a wide category (it drives from
`awcms_blog_posts_tenant_status_published_idx` and probes the
`(post_id, term_id)` unique index), and for a narrow one the planner flips to a
term-driven plan using `(term_id)` — 27 buffers instead of 48,832. A composite
serves that plan identically and is slightly wider per entry; dropping
`(term_id)` in its favour would leave `awcms_blog_terms` parent deletes scanning
the join table, exactly the residual `db:fk-index:check` documents. Recorded in
`PROJECT_STATE.md` §4 so it is not re-derived.
