-- 070 — repair the edge-cache purge queue's tenant-isolation policy.
--
-- `sql/068` created the policy against the GUC `awcms.tenant_id`. Nothing in
-- this codebase ever sets that name. `withTenant()` issues
-- `SET LOCAL app.current_tenant_id = ...` (src/lib/database/tenant-context.ts),
-- and all 108 other tenant policies read `app.current_tenant_id`. `sql/068` was
-- the single outlier.
--
-- ## Why this was worse than a stale cache
--
-- `current_setting('awcms.tenant_id', true)` returns NULL, so the WITH CHECK
-- expression evaluates to NULL — never true. Every INSERT was therefore rejected
-- with `new row violates row-level security policy`.
--
-- `enqueueModuleContentPurge` is awaited **inside the content transaction**
-- (ADR-0042 §9 / ADR-0006), unguarded, so that rejection aborted the publish
-- itself. With `EDGE_CACHE_MODE` set to `auto` or `on`, every blog create,
-- update, delete, and scheduled publish returned a 500. The write path was down,
-- not merely uncached.
--
-- It stayed invisible because the subsystem defaults to `off`: with the cache
-- disabled `enqueueModuleContentPurge` returns before touching the database, so
-- CI, the integration suite, and every deployment to date exercised the guarded
-- path only. The fault appeared the moment the feature was switched on in
-- staging — the first time this table was ever written to.
--
-- The USING side was equally broken and failed quietly in the other direction:
-- the worker's `claimEdgeCachePurges` matched zero rows for every tenant and
-- reported `sent=0`, which is indistinguishable from an empty queue.
--
-- ## Shape of the fix
--
-- `CREATE POLICY` is not idempotent and the policy already exists, so this drops
-- and recreates rather than altering — the same DROP-then-CREATE the original
-- migration used. Editing `sql/068` in place is not an option: it is already
-- applied in staging, and a checksum change would block `db:migrate` on any
-- running deployment.
--
-- No DML, no data to migrate: the table is empty everywhere precisely because
-- nothing could ever insert into it.

DROP POLICY IF EXISTS awcms_edge_cache_purges_tenant_isolation
  ON awcms_edge_cache_purges;

CREATE POLICY awcms_edge_cache_purges_tenant_isolation
  ON awcms_edge_cache_purges
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
