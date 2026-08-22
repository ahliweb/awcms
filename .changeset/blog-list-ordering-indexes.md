---
"awcms": patch
---

perf(blog-content): the blog lists sorted the whole tenant to return fifty rows

`sql/035` gives `awcms_blog_posts` seven indexes, and not one of them leads with
`updated_at` or `created_at` — the two columns every list in the module orders
by. `/admin/blog`, `/admin/pages`, the term-filtered post list, and the keyset
traversal `GET /api/v1/blog/posts` that a static build walks were each a
tenant-wide sequential scan followed by a top-N sort.

**Measured rather than derived.** The audit could only reason from btree prefix
rules; this was run against 24,000 seeded posts on PostgreSQL 18:

| query | before | after |
| --- | --- | --- |
| `/admin/blog`, `LIMIT 50` | Seq Scan 24,000 rows + top-N heapsort, 7.4 ms | Index Scan, 50 rows, 0.057 ms |
| same with the status filter | Seq Scan 20,572 rows + sort, 4.8 ms | Index Scan, 50 rows, 0.050 ms |
| keyset first page | Seq Scan 24,000 rows + sort, 5.1 ms | Index Scan, 50 rows, 0.110 ms |
| keyset page resumed at row 10,000 | — | Index Scan, 50 rows, 0.060 ms |

The number that matters is not the milliseconds. It is **24,000 becoming 50**:
the cost was O(tenant posts) and is now O(page size), so a page that is fast on a
demo tenant stays fast on the 23,906-article archive Issue #599 exists to import.
The resumed deep page is the case a first-page measurement cannot see, and the
one a static build spends nearly all its time in.

**One correction to the finding.** C1 also says "plus a second full scan for
`count(*)`". That is not what happens: the count beside the list already plans as
an Index Only Scan on `awcms_blog_posts_tenant_deleted_idx` (1.8 ms, unchanged by
this migration). It reads every index entry, which is why it does not get faster
— but it is not a heap scan, and no index added here would help it. A cheap count
needs a different answer entirely, with its own trade-off.

The posts indexes are **partial** on `deleted_at IS NULL`, which those queries
write as a literal. The pages index is **not**: `listBlogPages` decides deleted
versus live with a `CASE` over a bound parameter, so a partial index is provable
under a custom plan and not under a generic one — and an index the planner can
only sometimes prove applicable is an index that sometimes is not there.

Held by `tests/integration/blog-list-ordering-plan.integration.test.ts`, which
asserts the PLAN rather than a duration: the named index is the access path,
there is no `Seq Scan`, there is no sort node, and no more than 50 rows are read.
A timing threshold on shared CI hardware is a coin flip; `EXPLAIN` states the
structural property directly. Its last case drops the index inside a rolled-back
transaction and asserts the scan comes back — without that, every other
assertion would also pass on a table too small to distinguish the plans.
