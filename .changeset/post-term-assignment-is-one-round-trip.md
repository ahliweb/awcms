---
"awcms": patch
---

perf(blog): filing a post costs two queries instead of one per term, and a write path finally has a budget

`syncPostTermAssignments` issued one `INSERT` PER TERM. Per save that is a small
constant — an article carries a handful of terms — which is why it stood for as
long as it did. It stopped being a small constant when a bulk importer became
the caller: `blog:legacy:import` now files every article it inserts, so a
23,906-row archive turned this into roughly 24,000 `DELETE`s and 48,000
`INSERT`s inside batched transactions, where two statements per article will do.

Now one `DELETE` and one `INSERT ... unnest`, the shape `comment-retention.ts`
and `announcement-directory.ts` already use.

**Deliberately NOT deduplicated on the way in.** `awcms_blog_post_terms_unique`
refused a repeated `(post, term)` pair before this change and still does. A
caller passing the same term twice has a bug, and swallowing it here would turn
a loud constraint error into a silent difference between what was asked for and
what was stored.

**The finding behind it is worth more than the fix.** This repo has four query
budget suites — public reads, admin reads, the sitemap builder, the middleware —
and all four measure READS. Every N+1 a full scan of `src/` turns up is on a
write path or in a job. That is not an oversight so much as where attention
goes: a read path is hit constantly so its cost is felt, and a write path is hit
once per save so a per-item query inside it looks like nothing.

So this adds `tests/integration/post-term-assignment-budget.integration.test.ts`
— the first query budget on a write path. The budget is EXACT (2), not a
ceiling, because the property being pinned is that the number does not move with
the number of terms; a `toBeLessThanOrEqual` would pass a per-term regression as
long as the fixture stayed small. The fixture assigns twelve, so the old shape
cannot pass by accident, and every case asserts the rows that actually landed
beside the count — a budget on its own is satisfied by a function that writes
nothing.

The remaining findings from the same scan (nine lower-amplification write paths,
a per-post fetch inside the scheduled-publish sweep, and a low-cardinality index
on `awcms_blog_post_terms`) are recorded in `PROJECT_STATE.md` §4 rather than
changed here, so they do not have to be re-derived.
