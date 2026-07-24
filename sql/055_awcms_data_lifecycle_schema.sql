-- data_lifecycle — System Foundation module (ADR-0037, ported from awcms-micro
-- Issue #745 migration 057; rename `awcms_micro_` -> `awcms_`,
-- `awcms_micro_tenants` -> `awcms_tenants`, `awcms_micro_worker` ->
-- `awcms_worker`). Four tenant-scoped tables, all `ENABLE`+`FORCE ROW LEVEL
-- SECURITY` — this module NEVER owns another module's high-volume table; it
-- owns only its OWN policy/execution-state tables. Per ADR-0013 §6, the actual
-- high-volume table DESCRIPTORS (table/cursor/retention/archive/legal-hold/purge
-- metadata) live in CODE (`ModuleDescriptor.dataLifecycle`,
-- `src/modules/_shared/module-contract.ts`) declared by each OWNING module's own
-- `module.ts` — never mirrored into a database table here.
--
-- 1. `awcms_data_lifecycle_legal_holds` — the one genuine runtime/tenant
--    override this system needs: a legal hold record with scope, reason,
--    authority/reference metadata, start/end, approval, and default-deny
--    release. Overrides ordinary retention/purge for any matching descriptor
--    (`descriptor_key IS NULL` = applies to every registered descriptor for this
--    tenant).
-- 2. `awcms_data_lifecycle_cursors` — bounded-job pause/resume state per
--    (tenant, descriptor, phase) — a genuinely mutable execution-state fact.
-- 3. `awcms_data_lifecycle_archive_manifests` — archive artifact evidence:
--    location, cursor range, checksum, schema/version, restore procedure ref.
-- 4. `awcms_data_lifecycle_runs` — dry-run/archive/purge execution history with
--    categorized, AGGREGATE counts only — never row contents, never raw
--    identifiers beyond opaque UUIDs already scoped by RLS. This table is ITSELF
--    registered as a `data_lifecycle`-owned high-volume descriptor with
--    `executionMode: "generic"` (see `module.ts`).
--
-- Non-destructive: every statement is `IF NOT EXISTS`, no soft-delete columns,
-- no composite/cross-tenant FK, no destructive DML.
CREATE TABLE IF NOT EXISTS awcms_data_lifecycle_legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  descriptor_key text,
  scope_description text NOT NULL,
  reason text NOT NULL,
  authority_reference text NOT NULL,
  authority_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_data_lifecycle_legal_holds_status_check
    CHECK (status IN ('active', 'released')),
  CONSTRAINT awcms_data_lifecycle_legal_holds_release_consistency_check
    CHECK (
      (status = 'active' AND released_at IS NULL AND released_by IS NULL)
      OR
      (status = 'released' AND released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL)
    ),
  CONSTRAINT awcms_data_lifecycle_legal_holds_ends_after_starts_check
    CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT awcms_data_lifecycle_legal_holds_descriptor_key_format_check
    CHECK (descriptor_key IS NULL OR descriptor_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

-- Planner hot path: "which active holds apply to (tenant, descriptor)?" —
-- partial index on status='active' keeps this small and fast regardless of how
-- much released history accumulates.
CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_legal_holds_active_idx
  ON awcms_data_lifecycle_legal_holds (tenant_id, descriptor_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_legal_holds_tenant_status_idx
  ON awcms_data_lifecycle_legal_holds (tenant_id, status, created_at DESC);

ALTER TABLE awcms_data_lifecycle_legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_data_lifecycle_legal_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_data_lifecycle_legal_holds_tenant_isolation
  ON awcms_data_lifecycle_legal_holds
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Bounded-job pause/resume cursor, one row per (tenant, descriptor, phase).
-- `cursor_value` is the last-processed value of the descriptor's own
-- `cursorColumn` (always a timestamptz in this repo's convention, doc 04 §Tipe
-- data) — the next run resumes strictly after this value.
CREATE TABLE IF NOT EXISTS awcms_data_lifecycle_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  descriptor_key text NOT NULL,
  phase text NOT NULL,
  cursor_value timestamptz,
  status text NOT NULL DEFAULT 'idle',
  last_run_id uuid,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_data_lifecycle_cursors_phase_check
    CHECK (phase IN ('archive', 'purge')),
  CONSTRAINT awcms_data_lifecycle_cursors_status_check
    CHECK (status IN ('idle', 'in_progress', 'completed', 'error')),
  CONSTRAINT awcms_data_lifecycle_cursors_descriptor_key_format_check
    CHECK (descriptor_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_data_lifecycle_cursors_identity_key
  ON awcms_data_lifecycle_cursors (tenant_id, descriptor_key, phase);

ALTER TABLE awcms_data_lifecycle_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_data_lifecycle_cursors FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_data_lifecycle_cursors_tenant_isolation
  ON awcms_data_lifecycle_cursors
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Archive artifact evidence. `artifact_location` is a path/URI ONLY — never a
-- credential ("archive and logs contain no credentials"); the local/offline
-- adapter writes a filesystem path under `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`
-- (doc 18), a future external object-storage adapter would write an object
-- key/URI, same "reference, not secret" convention.
CREATE TABLE IF NOT EXISTS awcms_data_lifecycle_archive_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  descriptor_key text NOT NULL,
  archive_port text NOT NULL,
  artifact_location text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  cursor_range_start timestamptz,
  cursor_range_end timestamptz,
  checksum_algorithm text NOT NULL DEFAULT 'sha256',
  checksum_hex text NOT NULL,
  schema_version text NOT NULL,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'written',
  restore_procedure_ref text NOT NULL,
  job_run_id uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  verified_at timestamptz,
  CONSTRAINT awcms_data_lifecycle_archive_manifests_port_check
    CHECK (archive_port IN ('local_offline', 'external_object_storage')),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_format_check
    CHECK (format IN ('jsonl', 'csv')),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_status_check
    CHECK (status IN ('written', 'verified', 'restored', 'deleted')),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_row_count_check
    CHECK (row_count >= 0),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_checksum_algorithm_check
    CHECK (checksum_algorithm = 'sha256'),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_checksum_hex_check
    CHECK (checksum_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_range_check
    CHECK (cursor_range_start IS NULL OR cursor_range_end IS NULL OR cursor_range_end >= cursor_range_start),
  CONSTRAINT awcms_data_lifecycle_archive_manifests_descriptor_key_format_check
    CHECK (descriptor_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

-- Planner's "already archived through cursor X?" lookup — MAX(cursor_range_end)
-- per (tenant, descriptor) among non-deleted manifests.
CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_archive_manifests_coverage_idx
  ON awcms_data_lifecycle_archive_manifests (tenant_id, descriptor_key, cursor_range_end DESC)
  WHERE status <> 'deleted';

CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_archive_manifests_status_idx
  ON awcms_data_lifecycle_archive_manifests (tenant_id, status);

ALTER TABLE awcms_data_lifecycle_archive_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_data_lifecycle_archive_manifests FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_data_lifecycle_archive_manifests_tenant_isolation
  ON awcms_data_lifecycle_archive_manifests
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Dry-run/archive/purge run history — categorized AGGREGATE counts only.
-- `triggered_by` is NULL for a scheduled/system job run, a `tenant_user_id` for
-- an on-demand API-triggered run.
CREATE TABLE IF NOT EXISTS awcms_data_lifecycle_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  descriptor_key text NOT NULL,
  run_type text NOT NULL,
  status text NOT NULL,
  eligible_count integer NOT NULL DEFAULT 0,
  held_count integer NOT NULL DEFAULT 0,
  archived_count integer NOT NULL DEFAULT 0,
  purgeable_count integer NOT NULL DEFAULT 0,
  purged_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  cutoff_at timestamptz,
  job_run_id uuid,
  correlation_id text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_data_lifecycle_runs_run_type_check
    CHECK (run_type IN ('dry_run', 'archive', 'purge')),
  CONSTRAINT awcms_data_lifecycle_runs_status_check
    CHECK (status IN ('completed', 'partial', 'failed')),
  CONSTRAINT awcms_data_lifecycle_runs_counts_check
    CHECK (
      eligible_count >= 0 AND held_count >= 0 AND archived_count >= 0 AND
      purgeable_count >= 0 AND purged_count >= 0 AND blocked_count >= 0 AND
      error_count >= 0
    ),
  CONSTRAINT awcms_data_lifecycle_runs_finished_after_started_check
    CHECK (finished_at >= started_at),
  CONSTRAINT awcms_data_lifecycle_runs_descriptor_key_format_check
    CHECK (descriptor_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_runs_descriptor_idx
  ON awcms_data_lifecycle_runs (tenant_id, descriptor_key, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_data_lifecycle_runs_type_idx
  ON awcms_data_lifecycle_runs (tenant_id, run_type, created_at DESC);

ALTER TABLE awcms_data_lifecycle_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_data_lifecycle_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_data_lifecycle_runs_tenant_isolation
  ON awcms_data_lifecycle_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` (sql/022) grants — exactly the tables the scheduled `bun run
-- data-lifecycle:archive-purge` job touches
-- (`scripts/data-lifecycle-archive-purge.ts`), mirroring the per-script grant
-- precedent (sql/050 visitor-analytics). `awcms_app` needs no explicit grant
-- here: all four tables above are tenant-scoped (RLS FORCE'd), so the existing
-- `ALTER DEFAULT PRIVILEGES` blanket grant from sql/019 already covers them.
--
-- Legal holds are SELECT-ONLY for the worker: it reads holds to decide whether
-- to skip a descriptor's purge, but never creates or releases them — that stays
-- an admin/API action via `awcms_app`. The worker is NOBYPASSRLS, so these
-- tenant-scoped tables still enforce their `tenant_isolation` policy on top of
-- these table privileges — every job opens `withTenant(...)` per tenant.
GRANT SELECT ON awcms_data_lifecycle_legal_holds TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_data_lifecycle_cursors TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_data_lifecycle_archive_manifests TO awcms_worker;
GRANT SELECT, INSERT, DELETE ON awcms_data_lifecycle_runs TO awcms_worker;
