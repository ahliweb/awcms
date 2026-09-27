-- Issue ahliweb/omes#249 (split from #246 part 2, ADR-0030 in the
-- `ahliweb/omes` repository) — AWCMS-side GitHub repository-progress
-- projection for the `/admin/omes/progres-hermes` screen, consuming the
-- vendored `repository-progress-view` v1 contract.
--
-- Two tables, both tenant-scoped with FORCE ROW LEVEL SECURITY, following the
-- exact template sql/154/sql/160/sql/163 already established for every other
-- omes_control table.
--
-- SECURITY / ADR-0030 boundary:
--   * GitHub owns repository/issue/milestone observation state (AGENTS.md
--     Sec. 2). AWCMS polls the GitHub REST API on a schedule
--     (application/repository-progress-poller.ts) and stores only what the
--     vendored, `additionalProperties: false` schema allows: no issue body,
--     no comments, no assignee/author PII.
--   * `awcms_omes_repository_progress_config` is the ADMIN-WRITABLE per-tenant
--     setting of which repository to observe. `secret_ref` NEVER holds a raw
--     token — only a `{"store": "env", "key": "..."}` indirection (or NULL for
--     an unauthenticated/public-repo poll); enforced at the application layer
--     (`domain/repository-progress.ts` validation +
--     `application/repository-progress-config.ts`) and independently by
--     `scan_for_raw_secrets`-equivalent checks wherever this row's `secret_ref`
--     value is handled.
--   * `awcms_omes_repository_progress` is the POLLER-WRITTEN projection: one
--     current row per tenant (a new poll REPLACES the prior one — this is a
--     live snapshot, not an append-only history, matching
--     `hermes-orchestration-tree`'s precedent). `status`/`last_error_class`
--     let the screen render an explicit error state without ever discarding
--     the last successfully observed data (ADR-0030's "AWCMS consumption
--     expectations").
--   * `milestones_etag`/`issues_etag` cache GitHub's conditional-request
--     ETags (first page only — see the poller's header) so an unchanged
--     repository's poll costs no additional GitHub rate-limit quota.

-- 1. Per-tenant repository-progress configuration --------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_repository_progress_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  owner text NOT NULL,
  name text NOT NULL,
  secret_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_repository_progress_config_owner_check
    CHECK (owner ~ '^[A-Za-z0-9._-]{1,100}$'),
  CONSTRAINT awcms_omes_repository_progress_config_name_check
    CHECK (name ~ '^[A-Za-z0-9._-]{1,100}$'),
  -- The only shape this repository's poller resolves for v1 — see
  -- `application/repository-progress-config.ts`'s header for why `store` is
  -- fixed to `"env"` and `key` is fixed to one literal env var name (the same
  -- static-env-scan-friendly convention `TENANT_DOMAIN_CLOUDFLARE_*` already
  -- uses), rather than an arbitrary tenant-chosen env var name.
  CONSTRAINT awcms_omes_repository_progress_config_secret_ref_check
    CHECK (
      secret_ref IS NULL
      OR (
        jsonb_typeof(secret_ref) = 'object'
        AND secret_ref ? 'store' AND secret_ref ? 'key'
        AND secret_ref->>'store' = 'env'
        AND secret_ref->>'key' = 'OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_repository_progress_config_tenant_idx
  ON awcms_omes_repository_progress_config (tenant_id);

-- Composite (tenant_id, created_at) for the generic data-lifecycle engine's
-- retention cursor scan (data-lifecycle:registry:check requires it even
-- though, in practice, at most one row per tenant ever exists here).
CREATE INDEX IF NOT EXISTS awcms_omes_repository_progress_config_tenant_created_idx
  ON awcms_omes_repository_progress_config (tenant_id, created_at);

ALTER TABLE awcms_omes_repository_progress_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_repository_progress_config FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_repository_progress_config_tenant_isolation
  ON awcms_omes_repository_progress_config
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_repository_progress_config TO awcms_app;
-- The poller itself only ever READS the configuration to know which
-- repository to poll; it never writes it. DELETE is granted anyway (never
-- used by the poller's own code) because the generic data-lifecycle
-- retention/purge engine (`data-lifecycle:archive-purge`) also runs as
-- `awcms_worker` and this table's dataLifecycle descriptor (module.ts)
-- declares `deletion.mode: "hard_delete"` — a descriptor the engine cannot
-- actually enforce is a claim, not a retention policy
-- (data-lifecycle:worker-grants:check fails closed on exactly this gap).
GRANT SELECT, DELETE ON awcms_omes_repository_progress_config TO awcms_worker;


-- 2. Current repository-progress projection ---------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_repository_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  owner text NOT NULL,
  name text NOT NULL,
  html_url text NOT NULL,
  observed_at timestamptz,
  source text NOT NULL DEFAULT 'github_rest_poll',
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ok',
  last_error_class text,
  last_error_at timestamptz,
  milestones_etag text,
  issues_etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_repository_progress_source_check
    CHECK (source IN ('github_rest_poll', 'github_webhook')),
  CONSTRAINT awcms_omes_repository_progress_status_check
    CHECK (status IN ('ok', 'error')),
  CONSTRAINT awcms_omes_repository_progress_error_class_check
    CHECK (
      last_error_class IS NULL
      OR last_error_class IN (
        'not_found', 'unauthorized', 'rate_limited', 'network_error',
        'invalid_response', 'blocked_request'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_repository_progress_tenant_idx
  ON awcms_omes_repository_progress (tenant_id);

-- Composite (tenant_id, updated_at) for the generic data-lifecycle engine's
-- retention cursor scan (data-lifecycle:registry:check).
CREATE INDEX IF NOT EXISTS awcms_omes_repository_progress_tenant_updated_idx
  ON awcms_omes_repository_progress (tenant_id, updated_at);

ALTER TABLE awcms_omes_repository_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_repository_progress FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_repository_progress_tenant_isolation
  ON awcms_omes_repository_progress
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_repository_progress TO awcms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_repository_progress TO awcms_worker;
