-- ADR-0046 — first runtime schema of the `idn_admin_regions` module: versioned
-- master data for Indonesia's administrative hierarchy (province / regency-city
-- / district / village), sourced from the vendored third-party dataset
-- `data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql` (MIT).
--
-- Two tables:
--
--   1. `awcms_idn_region_datasets` — one row per IMPORTED dataset version, with
--      the upstream provenance (repository, path, commit SHA, licence, file
--      sha256, decree reference) plus lifecycle status and validation summary.
--   2. `awcms_idn_admin_regions` — one row per normalized region, belonging to
--      exactly one dataset. A region's `code` is unique only WITHIN a dataset:
--      importing a new version creates an entirely new set of rows and never
--      overwrites the previous version's rows in place. That is precisely what
--      makes rollback possible without re-importing (ADR-0046 §4).
--
-- ## GLOBAL reference data — no tenant_id, no RLS (ADR-0046 §3)
--
-- Province "Aceh" is the same row for every tenant. Both tables are therefore
-- global, exactly like `awcms_permissions`/`awcms_modules`/
-- `awcms_schema_migrations`: no `tenant_id` column, no RLS, no policy. This is a
-- deliberate exception to this repo's "every tenant-scoped table is RLS FORCE'd"
-- default, and it is registered as such: both tables are keyed in
-- `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (`scripts/security-readiness.ts`), which is
-- the SINGLE structure feeding both `checkRlsEnabled`'s exemption set and
-- `checkRuntimeRoleGrants`' forbidden-privilege map — registering in one without
-- the other is impossible by construction.
--
-- What is global is the ROW, not the permission: every endpoint over this data
-- still runs through session + tenant context + default-deny RBAC/ABAC.
--
-- ## Least-privilege grants, written to match the code paths that exist
--
-- Migration 013's `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE,
-- DELETE ON TABLES TO awcms_app` fires the moment `CREATE TABLE` runs, so both
-- tables start over-granted. This migration narrows them in the same
-- transaction, to exactly what ADR-0046 §5 splits:
--
--   * `awcms_app`  (request path) — SELECT on both tables (lookup API), plus
--     UPDATE on the DATASET table only (activate/rollback flips `status` +
--     `activated_at`/`activated_by`). No INSERT: nothing in a request ever
--     creates a dataset or a region row.
--   * `awcms_worker` (import job)  — SELECT + INSERT on both, UPDATE on the
--     dataset table (row_count/validation_summary after the rows land).
--   * Neither role gets DELETE on either table: a dataset is never deleted, only
--     superseded. Losing 91k rows must not be one wrong query away.
--
-- `awcms_setup` gets nothing: bootstrap does not touch reference data.

CREATE TABLE IF NOT EXISTS awcms_idn_region_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_code text NOT NULL,
  source_type text NOT NULL DEFAULT 'third_party_github_repository',
  source_repository text NOT NULL,
  source_path text NOT NULL,
  source_commit_sha text NOT NULL,
  source_license text NOT NULL DEFAULT 'MIT',
  -- The decree this dataset FILE itself cites in its header (e.g. "Kepmendagri
  -- No 300.2.2-2138 Tahun 2025"). Nullable because upstream does not always
  -- state one, and a guessed decree number in a compliance-facing field is
  -- worse than an absent one.
  source_reference text,
  source_file_sha256 text NOT NULL,
  row_count integer NOT NULL,
  status text NOT NULL,
  validation_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  activated_at timestamptz,
  activated_by uuid,
  CONSTRAINT awcms_idn_region_datasets_dataset_code_key UNIQUE (dataset_code),
  CONSTRAINT awcms_idn_region_datasets_row_count_check CHECK (row_count >= 0),
  -- `validated` = imported, not serving. `active` = serving. `superseded` = was
  -- active, replaced or rolled back away from (its `activated_at`/
  -- `activated_by` stay as historical record; only `status` changes).
  -- `rejected` records an import attempt that failed validation.
  CONSTRAINT awcms_idn_region_datasets_status_check
    CHECK (status IN ('validated', 'active', 'superseded', 'rejected'))
);

COMMENT ON TABLE awcms_idn_region_datasets IS
  'Global reference data (ADR-0046) — one row per imported Indonesia administrative region dataset version (cahyadsn/wilayah, MIT). NOT tenant-scoped, no RLS: see sql/080 header and scripts/security-readiness.ts GLOBAL_TABLE_FORBIDDEN_PRIVILEGES.';

-- "Only one dataset can be active at a time" (ADR-0046 §4) enforced BY THE
-- DATABASE, not by an application read-then-write two concurrent activations
-- could interleave through: a partial unique index over the rows matching
-- `status = 'active'`, indexed on `status` itself. Every indexed row necessarily
-- holds the same value, so a second one collides. The same index is also the
-- fastest possible lookup for the API's default "the active dataset" query.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_idn_region_datasets_single_active
  ON awcms_idn_region_datasets (status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS awcms_idn_admin_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES awcms_idn_region_datasets (id),
  -- Dotted upstream code, e.g. '11', '11.01', '11.01.01', '11.01.01.2001'.
  code text NOT NULL,
  -- Same code without separators ('11010120 01') — the form external systems and
  -- pasted spreadsheets usually carry.
  code_compact text NOT NULL,
  parent_code text,
  level smallint NOT NULL,
  region_type text NOT NULL,
  -- Indonesian term carried by the row itself: 'Provinsi', 'Kabupaten', 'Kota',
  -- 'Kecamatan', 'Desa', 'Kelurahan', and the DKI/administrative variants.
  local_term text,
  -- Name exactly as upstream spells it, prefix and all ('Kabupaten Aceh Selatan').
  official_name text NOT NULL,
  -- Case/spacing-folded name for lookup ('kabupaten aceh selatan').
  normalized_name text NOT NULL,
  full_path_code text,
  full_path_name text,
  province_code text,
  regency_code text,
  district_code text,
  village_code text,
  source_row_hash text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Four-tier hierarchy. `level` mirrors `region_type` numerically (1=province
  -- .. 4=village) so ORDER BY/range comparisons need no CASE over the text
  -- column; both are written together by the importer, since the mapping is a
  -- stable domain fact rather than a computation over other columns of the row.
  CONSTRAINT awcms_idn_admin_regions_level_check CHECK (level BETWEEN 1 AND 4),
  CONSTRAINT awcms_idn_admin_regions_region_type_check
    CHECK (region_type IN ('province', 'regency', 'district', 'village'))
);

COMMENT ON TABLE awcms_idn_admin_regions IS
  'Global reference data (ADR-0046) — normalized Indonesia administrative regions for ONE dataset version. NOT tenant-scoped, no RLS: see sql/080 header. Public government facts only, no personal data.';

-- A code is unique only within its own dataset; two versions may legitimately
-- both contain '11.01'.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_code_key
  ON awcms_idn_admin_regions (dataset_id, code);

-- "children of this region" — the hierarchy-browsing path of the lookup API and
-- the admin screen.
CREATE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_parent_idx
  ON awcms_idn_admin_regions (dataset_id, parent_code);

-- Name search. Dataset-scoped first because every real query is dataset-scoped
-- (the API defaults to the active dataset), then `normalized_name` with
-- `text_pattern_ops` so prefix matching (`normalized_name LIKE 'aceh%'`) uses
-- the index even under a non-C collation — a plain btree here would only serve
-- equality, which is not what a region picker does.
CREATE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_name_idx
  ON awcms_idn_admin_regions (dataset_id, normalized_name text_pattern_ops);

-- Level-filtered listing ("all provinces of the active dataset").
CREATE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_level_idx
  ON awcms_idn_admin_regions (dataset_id, level);

-- Least-privilege: see this file's header for why each grant exists.
REVOKE ALL ON awcms_idn_region_datasets FROM awcms_app;
REVOKE ALL ON awcms_idn_admin_regions FROM awcms_app;
GRANT SELECT, UPDATE ON awcms_idn_region_datasets TO awcms_app;
GRANT SELECT ON awcms_idn_admin_regions TO awcms_app;
GRANT SELECT, INSERT, UPDATE ON awcms_idn_region_datasets TO awcms_worker;
GRANT SELECT, INSERT ON awcms_idn_admin_regions TO awcms_worker;
