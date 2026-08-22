-- Finding C1 of the 17 August 2026 audit round — an index for the ordering the
-- blog lists actually use.
--
-- ## What was measured, not derived
--
-- `sql/035` gives `awcms_blog_posts` seven indexes. Not one of them leads with
-- `updated_at` or `created_at`, and four list queries order by one of those:
--
--   * `listBlogPosts`            ORDER BY updated_at DESC          (/admin/blog)
--   * `listBlogPostsPage`        ORDER BY p.updated_at DESC        (term-filtered)
--   * `listBlogPostsFullPage`    ORDER BY created_at DESC, id DESC (GET /api/v1/blog/posts)
--   * `listBlogPages`            ORDER BY updated_at DESC          (/admin/pages)
--
-- The audit could only derive the consequence from btree prefix rules. It has
-- now been measured, against 24,000 seeded posts on PostgreSQL 18:
--
--   | query                              | before                        | after            |
--   | ---------------------------------- | ----------------------------- | ---------------- |
--   | /admin/blog list, LIMIT 50          | Seq Scan 24,000 + top-N sort — 7.4 ms | Index Scan 50 rows — 0.057 ms |
--   | same, with the status filter        | Seq Scan 20,572 + top-N sort — 4.8 ms | Index Scan 50 rows — 0.050 ms |
--   | keyset page, LIMIT 50               | Seq Scan 24,000 + top-N sort — 5.1 ms | Index Scan 50 rows — 0.110 ms |
--
-- The number that matters is not the milliseconds — it is `24,000` becoming
-- `50`. The cost was O(tenant posts) and is now O(page size), so the page that
-- is fast on a demo tenant stays fast on the 23,906-article archive Issue #599
-- exists to import.
--
-- ## One correction to the finding
--
-- C1 also says "plus a second full scan for `count(*)`". That is NOT what
-- happens: the count beside the list already plans as an Index Only Scan on
-- `awcms_blog_posts_tenant_deleted_idx` (measured: 1.8 ms, unchanged by this
-- migration). It reads every row of the index, which is why it does not get
-- faster here — but it is not a heap scan, and no index added here would help
-- it. A genuinely cheap count needs a different answer (an estimate, or a
-- maintained counter), and that is a separate decision with its own trade-off.
--
-- ## Why PARTIAL on posts and PLAIN on pages
--
-- The post queries write `deleted_at IS NULL` as a literal, so the partial index
-- is provably applicable and skips soft-deleted rows entirely.
--
-- `listBlogPages` does not: it writes
-- `CASE WHEN $deletedOnly THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END`,
-- so whether a partial index applies depends on the planner knowing the
-- parameter — true for a custom plan, not guaranteed for a generic one. A plain
-- index is usable under both branches and under either plan. Pages are
-- low-cardinality, so the extra entries cost little; a partial index that the
-- planner sometimes cannot prove costs the scan it was added to remove.
--
-- ## Why `DESC` in the index
--
-- PostgreSQL can walk an ASC index backwards, so it is not strictly required.
-- It is written anyway, matching `awcms_blog_posts_tenant_status_published_idx`
-- one file over: the direction the reader wants is part of what the index is
-- FOR, and a reader comparing the two should not have to work out that they are
-- the same shape written two ways.
--
-- No `CONCURRENTLY`: this repo's migration runner wraps each file in a
-- transaction (`CREATE INDEX CONCURRENTLY` cannot run inside one), and every
-- index here is on a table whose largest known deployment is a few tens of
-- thousands of rows — seconds of lock, not minutes. A future table where that
-- stops being true needs a different runner, not a different index.

BEGIN;

-- `/admin/blog`, and the term-filtered list behind it. Also the ordering
-- `listBlogPostsByStatus` inherits, since it is a thin wrapper.
CREATE INDEX IF NOT EXISTS awcms_blog_posts_tenant_updated_idx
  ON awcms_blog_posts (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX awcms_blog_posts_tenant_updated_idx IS
  'Finding C1. The ordering /admin/blog and the term-filtered post list actually use. Without it both were a tenant-wide Seq Scan plus a top-N heapsort: measured 24,000 rows scanned to return 50, 7.4 ms, on a 24,000-post tenant. Partial on deleted_at IS NULL because both queries write that predicate as a literal.';

-- `GET /api/v1/blog/posts` — the keyset traversal a static build walks. The
-- tiebreaker column is part of the ordering, so it is part of the index: a
-- cursor that resumes on `(created_at, id)` cannot be answered in order by an
-- index that stops at `created_at`.
CREATE INDEX IF NOT EXISTS awcms_blog_posts_tenant_created_keyset_idx
  ON awcms_blog_posts (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX awcms_blog_posts_tenant_created_keyset_idx IS
  'Finding C1. The keyset ordering of GET /api/v1/blog/posts (created_at DESC, id DESC). Carries the id tiebreaker because the cursor resumes on the PAIR — an index stopping at created_at would still need a sort. Measured: Seq Scan 24,000 + top-N sort at 5.1 ms becomes an Index Scan of 50 rows at 0.11 ms.';

-- `/admin/pages`. Plain rather than partial: see this file's header — the query
-- decides `deleted_at` with a CASE over a parameter, and an index the planner
-- can only sometimes prove applicable is an index that sometimes is not there.
CREATE INDEX IF NOT EXISTS awcms_blog_pages_tenant_updated_idx
  ON awcms_blog_pages (tenant_id, updated_at DESC);

COMMENT ON INDEX awcms_blog_pages_tenant_updated_idx IS
  'Finding C1. The ordering /admin/pages uses. NOT partial on deleted_at: listBlogPages selects deleted vs live with a CASE over a bound parameter, so a partial index is provable under a custom plan and not under a generic one. Pages are low-cardinality; the extra entries cost less than a scan the planner falls back to.';

COMMIT;
