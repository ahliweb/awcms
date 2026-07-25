-- ADR-0042 — durable invalidation queue for the Varnish edge cache.
--
-- ## Why a table and not a direct HTTP call
--
-- The obvious implementation is "on publish, POST a BAN to Varnish". It is also
-- wrong in three ways that this table fixes:
--
-- 1. **It puts a network call inside a database transaction.** Publishing a post
--    would block on Varnish being reachable, and a slow edge would become a slow
--    editor experience — or worse, a transaction held open across a timeout.
--    ADR-0006's outbox reasoning applies unchanged: enqueue in the same commit,
--    deliver out of band.
-- 2. **It loses invalidations.** If Varnish is restarting when the BAN fires,
--    the content is stale until its TTL expires and nothing ever retries. A
--    queue with attempts and a lease turns that into a retry.
-- 3. **It cannot be reasoned about.** With a table, "is my edit live yet?" is a
--    query, and a stuck invalidation is visible instead of silent.
--
-- Enqueue happens in the writer's OWN transaction (same commit as the content
-- change), so an invalidation can never be recorded for a change that rolled
-- back, and a committed change can never be missing its invalidation.
--
-- ## Tenant scoping
--
-- Every row is tenant-scoped with ENABLE + FORCE RLS like every other tenant
-- table in this codebase. FORCE is load-bearing: the application connects as the
-- table owner, and ENABLE alone does not apply the policy to the owner, so
-- ENABLE-without-FORCE would leave this queue readable across tenants. A purge
-- row names a tenant's surrogate key, which is a (mild) information leak, and a
-- cross-tenant UPDATE could cancel another tenant's invalidation and pin their
-- stale content — so this is a real boundary, not a formality.

CREATE TABLE IF NOT EXISTS awcms_edge_cache_purges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The exact `Surrogate-Key` token to ban, as produced by
  -- `buildSurrogateKey()`. Stored verbatim; the worker escapes it into a ban
  -- regex at send time (never trusted as a regex here).
  surrogate_key text NOT NULL,
  -- Free-text provenance for operators ("blog_post.published", "theme.published").
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  -- Held by one worker while it sends. A crashed worker's lease simply expires
  -- and the row becomes claimable again — no manual recovery step.
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT awcms_edge_cache_purges_status_check
    CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
  CONSTRAINT awcms_edge_cache_purges_attempts_check
    CHECK (attempts >= 0),
  -- A key is a bounded, sanitized token (see `surrogate-keys.ts`); the bound
  -- here is a second line of defence against an unbounded value reaching the
  -- ban expression.
  CONSTRAINT awcms_edge_cache_purges_key_length_check
    CHECK (char_length(surrogate_key) BETWEEN 1 AND 512)
);

-- The worker's claim query: pending rows, oldest first. Partial index so the
-- (eventually much larger) completed history costs nothing to skip.
CREATE INDEX IF NOT EXISTS awcms_edge_cache_purges_claimable_idx
  ON awcms_edge_cache_purges (created_at)
  WHERE status IN ('pending', 'in_progress');

-- Tenant-first, matching the RLS predicate and the operator's "what is stuck for
-- this tenant?" query.
CREATE INDEX IF NOT EXISTS awcms_edge_cache_purges_tenant_status_idx
  ON awcms_edge_cache_purges (tenant_id, status, created_at DESC);

ALTER TABLE awcms_edge_cache_purges ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_edge_cache_purges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS awcms_edge_cache_purges_tenant_isolation
  ON awcms_edge_cache_purges;

CREATE POLICY awcms_edge_cache_purges_tenant_isolation
  ON awcms_edge_cache_purges
  USING (tenant_id = current_setting('awcms.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('awcms.tenant_id', true)::uuid);

-- Worker grants, deliberately minimal (see `WORKER_ROLE_GRANTS` in
-- `scripts/security-readiness.ts`, which a drift test compares against this
-- file — adding a verb here without adding it there fails CI):
--   SELECT — find claimable rows.
--   UPDATE — take the lease, then record done/failed.
--   DELETE — prune rows that completed outside the retention window. Granted
--            because `bun run edge-cache:purge` actually performs that prune;
--            it is not a speculative grant.
-- No INSERT: enqueueing is the application's job, in the content transaction.
GRANT SELECT, UPDATE, DELETE ON awcms_edge_cache_purges TO awcms_worker;
