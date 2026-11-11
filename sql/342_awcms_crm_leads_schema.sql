-- crm_leads -- the reusable lead/prospect pipeline (Issue #1166, ADR-0153).
--
-- A PRE-CUSTOMER context. This module owns the lead, its contact points, its
-- source touches, the tenant's versioned stage catalog, the append-only
-- transition history, owner assignments, merge records and conversion records.
-- It owns NO customer (ADR-0153 N1: the link is an opaque
-- `external_customer_ref`, written only by a conversion), NO identity (N2: no
-- `profile_identity` row is created or written), NO consent (N3), NO message,
-- NO inbox and NO workflow engine (N4, N5). It imports nothing from a
-- downstream product (N6).
--
-- ## Product vocabulary stays out (ADR-0153 L2, test T-L1)
--
-- Stage names, stage keys and pipeline codes are TENANT DATA. There is no
-- program, cohort or re-registration column, seed or default anywhere in this
-- schema; reports use the closed platform CATEGORY of a stage (`new`,
-- `working`, `qualified`, `converted`, `lost`, `disqualified`), so a tenant may
-- rename every stage without changing what "converted" means.
--
-- ## Versioned stage catalog
--
-- A pipeline has REVISIONS. A revision, its stages and its allowed edges are
-- IMMUTABLE once written (sql/344 triggers). Changing a pipeline publishes a new
-- revision; every transition row records the revision it happened under. A
-- guard on an edge is a CLOSED set of declarative predicates, never an
-- expression, script or callback (L3).
--
-- ## Contact points (ADR-0137 shape)
--
-- Ciphertext (AES-256-GCM through the shared field-encryption helper, AAD bound
-- to purpose, tenant and row id) + a keyed hash PER TENANT AND KIND + a masked
-- display form. The hash never leaves the tenant: candidate detection compares
-- hashes inside one tenant only (L5). Erasure nulls all three.
--
-- ## History is appended, never edited (L7)
--
-- Source touches and assignments are append-only; the transition history is
-- append-only except that erasure may null a free-text reason; a conversion is
-- reversed by stamping reversal facts once, never by editing what was recorded.
--
-- ## RLS / GRANT
--
-- Every table is FORCE ROW LEVEL SECURITY with the standard tenant_isolation
-- policy and composite (tenant_id, id) foreign keys, so a row can never point
-- at another tenant's row even though RI checks bypass RLS. `awcms_app` may not
-- DELETE or TRUNCATE anything here (a lead is soft-deleted or anonymised, never
-- removed by the runtime), and may not UPDATE the append-only tables.
-- `awcms_worker` holds nothing: no job reads or writes this module.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- ---------------------------------------------------------------------------
-- Tenant switch. A tenant that never wrote a row is OFF (ADR-0153 section 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_leads_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  enabled boolean NOT NULL DEFAULT false,
  -- ADR-0153 O4: the merge-undo window. A starting point the maintainer
  -- confirms; the tenant sets it within the platform bounds below.
  merge_undo_hours integer NOT NULL DEFAULT 168,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_crm_leads_settings_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_leads_settings_merge_undo_hours_check
    CHECK (merge_undo_hours BETWEEN 1 AND 720)
);

CREATE INDEX IF NOT EXISTS awcms_crm_leads_settings_updated_by_idx
  ON awcms_crm_leads_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pipelines and their immutable revisions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  -- An OPAQUE business-scope reference (ADR-0153 section 3, ADR-0148 I1). There
  -- is no base scope-definition table to point at (sql/027), so this is a
  -- generic (type, id) pair, exactly like awcms_business_scope_assignments.
  scope_type text,
  scope_id uuid,
  -- The IANA zone report buckets use (ADR-0153 section 4, L10). Validated by
  -- the application against the runtime's zone database.
  time_zone text NOT NULL DEFAULT 'UTC',
  current_revision_number integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_crm_pipelines_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_pipelines_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_pipelines_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_pipelines_code_check
    CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  CONSTRAINT awcms_crm_pipelines_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT awcms_crm_pipelines_scope_check
    CHECK (
      (scope_type IS NULL AND scope_id IS NULL)
      OR (scope_type ~ '^[a-z][a-z0-9_]{0,39}$' AND scope_id IS NOT NULL)
    ),
  CONSTRAINT awcms_crm_pipelines_time_zone_check
    CHECK (time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),
  CONSTRAINT awcms_crm_pipelines_revision_number_check
    CHECK (current_revision_number >= 0),
  CONSTRAINT awcms_crm_pipelines_version_check CHECK (version >= 1),
  CONSTRAINT awcms_crm_pipelines_status_check
    CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_pipelines_code_key
  ON awcms_crm_pipelines (tenant_id, code);

CREATE INDEX IF NOT EXISTS awcms_crm_pipelines_created_by_idx
  ON awcms_crm_pipelines (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_pipelines_updated_by_idx
  ON awcms_crm_pipelines (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_pipeline_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  pipeline_id uuid NOT NULL,
  revision_number integer NOT NULL,
  initial_stage_key text NOT NULL,
  -- SHA-256 hex of the canonical definition (stages + edges), so two
  -- revisions can be compared and a published one proven unchanged.
  definition_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NOT NULL,
  CONSTRAINT awcms_crm_pipeline_revisions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_pipeline_revisions_pipeline_id_key
    UNIQUE (tenant_id, pipeline_id, id),
  CONSTRAINT awcms_crm_pipeline_revisions_number_key
    UNIQUE (tenant_id, pipeline_id, revision_number),
  CONSTRAINT awcms_crm_pipeline_revisions_pipeline_fk
    FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES awcms_crm_pipelines (tenant_id, id),
  CONSTRAINT awcms_crm_pipeline_revisions_published_by_fk
    FOREIGN KEY (tenant_id, published_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_pipeline_revisions_number_check
    CHECK (revision_number >= 1),
  CONSTRAINT awcms_crm_pipeline_revisions_hash_check
    CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS awcms_crm_pipeline_revisions_published_by_idx
  ON awcms_crm_pipeline_revisions (tenant_id, published_by);

CREATE TABLE IF NOT EXISTS awcms_crm_pipeline_stages (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  revision_id uuid NOT NULL,
  -- Stable across revisions: the same key in two revisions is the same stage.
  stage_key text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  category text NOT NULL,
  CONSTRAINT awcms_crm_pipeline_stages_pkey
    PRIMARY KEY (tenant_id, revision_id, stage_key),
  CONSTRAINT awcms_crm_pipeline_stages_position_key
    UNIQUE (tenant_id, revision_id, position),
  CONSTRAINT awcms_crm_pipeline_stages_revision_fk
    FOREIGN KEY (tenant_id, revision_id)
    REFERENCES awcms_crm_pipeline_revisions (tenant_id, id),
  CONSTRAINT awcms_crm_pipeline_stages_key_check
    CHECK (stage_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT awcms_crm_pipeline_stages_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  CONSTRAINT awcms_crm_pipeline_stages_position_check
    CHECK (position BETWEEN 1 AND 50),
  CONSTRAINT awcms_crm_pipeline_stages_category_check
    CHECK (category IN (
      'new', 'working', 'qualified', 'converted', 'lost', 'disqualified'))
);

-- The initial stage must be a stage OF THAT revision. Deferred: the revision
-- row is written before its stages in the same transaction.
ALTER TABLE awcms_crm_pipeline_revisions
  ADD CONSTRAINT awcms_crm_pipeline_revisions_initial_stage_fk
    FOREIGN KEY (tenant_id, id, initial_stage_key)
    REFERENCES awcms_crm_pipeline_stages (tenant_id, revision_id, stage_key)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS awcms_crm_pipeline_transitions (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  revision_id uuid NOT NULL,
  from_stage_key text NOT NULL,
  to_stage_key text NOT NULL,
  -- ADR-0153 L3: a CLOSED set of declarative predicates. No expression
  -- language, no script, no callback.
  guards text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT awcms_crm_pipeline_transitions_pkey
    PRIMARY KEY (tenant_id, revision_id, from_stage_key, to_stage_key),
  CONSTRAINT awcms_crm_pipeline_transitions_from_fk
    FOREIGN KEY (tenant_id, revision_id, from_stage_key)
    REFERENCES awcms_crm_pipeline_stages (tenant_id, revision_id, stage_key),
  CONSTRAINT awcms_crm_pipeline_transitions_to_fk
    FOREIGN KEY (tenant_id, revision_id, to_stage_key)
    REFERENCES awcms_crm_pipeline_stages (tenant_id, revision_id, stage_key),
  CONSTRAINT awcms_crm_pipeline_transitions_distinct_check
    CHECK (from_stage_key <> to_stage_key),
  CONSTRAINT awcms_crm_pipeline_transitions_guards_check
    CHECK (
      guards <@ ARRAY['owner_assigned', 'contact_point_present', 'reason_required']::text[]
      AND cardinality(guards) <= 3
    )
);

CREATE INDEX IF NOT EXISTS awcms_crm_pipeline_transitions_to_idx
  ON awcms_crm_pipeline_transitions (tenant_id, revision_id, to_stage_key);

-- ---------------------------------------------------------------------------
-- Leads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  pipeline_id uuid NOT NULL,
  -- The revision under which the CURRENT stage was entered.
  revision_id uuid NOT NULL,
  stage_key text NOT NULL,
  -- Denormalised from the stage for lists and the funnel; always the category
  -- of (revision_id, stage_key) (sql/344 guard).
  stage_category text NOT NULL,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  -- The only free personal field of the standard shape (ADR-0153 section 7).
  -- Never in an event, an audit row or a log. NULL once anonymised.
  display_name text,
  owner_tenant_user_id uuid,
  status text NOT NULL DEFAULT 'open',
  merged_into_lead_id uuid,
  -- ADR-0153 N1: an OPAQUE reference to the downstream authority's customer,
  -- written only by a conversion confirmation, cleared by its reversal.
  external_customer_ref text,
  -- Optimistic concurrency token (ADR-0153 section 7).
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  anonymized_at timestamptz,
  CONSTRAINT awcms_crm_leads_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_leads_pipeline_fk
    FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES awcms_crm_pipelines (tenant_id, id),
  CONSTRAINT awcms_crm_leads_revision_fk
    FOREIGN KEY (tenant_id, pipeline_id, revision_id)
    REFERENCES awcms_crm_pipeline_revisions (tenant_id, pipeline_id, id),
  CONSTRAINT awcms_crm_leads_stage_fk
    FOREIGN KEY (tenant_id, revision_id, stage_key)
    REFERENCES awcms_crm_pipeline_stages (tenant_id, revision_id, stage_key),
  CONSTRAINT awcms_crm_leads_owner_fk
    FOREIGN KEY (tenant_id, owner_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_leads_merged_into_fk
    FOREIGN KEY (tenant_id, merged_into_lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_leads_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_leads_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_leads_deleted_by_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_leads_stage_category_check
    CHECK (stage_category IN (
      'new', 'working', 'qualified', 'converted', 'lost', 'disqualified')),
  CONSTRAINT awcms_crm_leads_display_name_check
    CHECK (display_name IS NULL OR (btrim(display_name) <> '' AND char_length(display_name) <= 120)),
  CONSTRAINT awcms_crm_leads_status_check
    CHECK (status IN ('open', 'merged', 'anonymized')),
  CONSTRAINT awcms_crm_leads_merged_check
    CHECK ((status = 'merged') = (merged_into_lead_id IS NOT NULL)),
  CONSTRAINT awcms_crm_leads_merged_self_check
    CHECK (merged_into_lead_id IS NULL OR merged_into_lead_id <> id),
  CONSTRAINT awcms_crm_leads_anonymized_check
    CHECK (
      (status = 'anonymized') = (anonymized_at IS NOT NULL)
      AND (anonymized_at IS NULL OR display_name IS NULL)
    ),
  CONSTRAINT awcms_crm_leads_customer_ref_check
    CHECK (external_customer_ref IS NULL OR external_customer_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT awcms_crm_leads_version_check CHECK (version >= 1),
  CONSTRAINT awcms_crm_leads_deleted_check
    CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL)
);

-- The admin list and the funnel: keyset on (created_at, id) per pipeline and
-- category, live rows only (ADR-0153 T-Q1).
CREATE INDEX IF NOT EXISTS awcms_crm_leads_list_idx
  ON awcms_crm_leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_pipeline_category_idx
  ON awcms_crm_leads (tenant_id, pipeline_id, stage_category, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_revision_stage_idx
  ON awcms_crm_leads (tenant_id, revision_id, stage_key);

CREATE INDEX IF NOT EXISTS awcms_crm_leads_owner_idx
  ON awcms_crm_leads (tenant_id, owner_tenant_user_id)
  WHERE owner_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_merged_into_idx
  ON awcms_crm_leads (tenant_id, merged_into_lead_id)
  WHERE merged_into_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_created_by_idx
  ON awcms_crm_leads (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_updated_by_idx
  ON awcms_crm_leads (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_leads_deleted_by_idx
  ON awcms_crm_leads (tenant_id, deleted_by)
  WHERE deleted_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_lead_contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  kind text NOT NULL,
  -- For `platform_id` only: which platform the id is scoped to. A platform id
  -- is never compared with an email (ADR-0148 I7).
  platform text,
  value_encrypted text,
  value_hash text,
  value_masked text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  revoked_at timestamptz,
  erased_at timestamptz,
  CONSTRAINT awcms_crm_lead_contact_points_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_lead_contact_points_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_contact_points_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_contact_points_kind_check
    CHECK (kind IN ('email', 'phone', 'platform_id')),
  CONSTRAINT awcms_crm_lead_contact_points_platform_check
    CHECK (
      (kind = 'platform_id' AND platform ~ '^[a-z][a-z0-9_]{1,31}$')
      OR (kind <> 'platform_id' AND platform IS NULL)
    ),
  CONSTRAINT awcms_crm_lead_contact_points_hash_check
    CHECK (value_hash IS NULL OR value_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$'),
  CONSTRAINT awcms_crm_lead_contact_points_masked_check
    CHECK (value_masked IS NULL OR char_length(value_masked) <= 200),
  -- Live: all three present. Erased: all three gone.
  CONSTRAINT awcms_crm_lead_contact_points_erasure_check
    CHECK (
      (erased_at IS NULL
        AND value_encrypted IS NOT NULL
        AND value_hash IS NOT NULL
        AND value_masked IS NOT NULL)
      OR
      (erased_at IS NOT NULL
        AND value_encrypted IS NULL
        AND value_hash IS NULL
        AND value_masked IS NULL)
    )
);

-- Candidate detection: exact keyed-hash match inside one tenant (T-Q1, T-I1).
CREATE INDEX IF NOT EXISTS awcms_crm_lead_contact_points_hash_idx
  ON awcms_crm_lead_contact_points (tenant_id, value_hash)
  WHERE value_hash IS NOT NULL AND revoked_at IS NULL;

-- One live copy of a value per lead.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_lead_contact_points_lead_value_key
  ON awcms_crm_lead_contact_points (tenant_id, lead_id, value_hash)
  WHERE value_hash IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_contact_points_lead_idx
  ON awcms_crm_lead_contact_points (tenant_id, lead_id);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_contact_points_created_by_idx
  ON awcms_crm_lead_contact_points (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_lead_source_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  -- 1 is the FIRST touch: immutable (ADR-0153 L4).
  touch_number integer NOT NULL,
  source_kind text NOT NULL,
  -- Opaque reference to a channel_accounts account (#1140). Not a foreign
  -- key: the lead module must work with that module off (L12).
  channel_account_id uuid,
  -- The source's own event id. With the source kind and the account it is the
  -- INTAKE key: a replayed webhook, a double-submitted form or a re-uploaded
  -- row yields the same lead, never two.
  external_event_id text,
  campaign_ref text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  referrer_host text,
  -- The lawful basis the controller stated for this source (ADR-0153 section
  -- 7). Recorded, never decided, and never a consent grant (N3).
  legal_basis text NOT NULL DEFAULT 'not_stated',
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  CONSTRAINT awcms_crm_lead_source_touches_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_lead_source_touches_number_key
    UNIQUE (tenant_id, lead_id, touch_number),
  CONSTRAINT awcms_crm_lead_source_touches_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_source_touches_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_source_touches_number_check
    CHECK (touch_number >= 1),
  CONSTRAINT awcms_crm_lead_source_touches_kind_check
    CHECK (source_kind IN ('website_form', 'inbound_message', 'import', 'manual', 'api')),
  CONSTRAINT awcms_crm_lead_source_touches_event_id_check
    CHECK (external_event_id IS NULL OR external_event_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT awcms_crm_lead_source_touches_campaign_check
    CHECK (campaign_ref IS NULL OR campaign_ref ~ '^[A-Za-z0-9._:-]{1,64}$'),
  CONSTRAINT awcms_crm_lead_source_touches_utm_check
    CHECK (
      (utm_source IS NULL OR utm_source ~ '^[A-Za-z0-9._~+-]{1,100}$')
      AND (utm_medium IS NULL OR utm_medium ~ '^[A-Za-z0-9._~+-]{1,100}$')
      AND (utm_campaign IS NULL OR utm_campaign ~ '^[A-Za-z0-9._~+-]{1,100}$')
    ),
  CONSTRAINT awcms_crm_lead_source_touches_path_check
    CHECK (landing_path IS NULL OR (landing_path ~ '^/[^?#%@[:space:]]*$' AND char_length(landing_path) <= 200)),
  CONSTRAINT awcms_crm_lead_source_touches_referrer_check
    CHECK (referrer_host IS NULL OR referrer_host ~ '^[a-z0-9.-]{1,253}$'),
  CONSTRAINT awcms_crm_lead_source_touches_legal_basis_check
    CHECK (legal_basis IN ('consent', 'contract_steps', 'legitimate_interest', 'not_stated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_lead_source_touches_intake_key
  ON awcms_crm_lead_source_touches (
    tenant_id,
    source_kind,
    COALESCE(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    external_event_id
  )
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_source_touches_kind_idx
  ON awcms_crm_lead_source_touches (tenant_id, source_kind, occurred_at);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_source_touches_recorded_by_idx
  ON awcms_crm_lead_source_touches (tenant_id, recorded_by)
  WHERE recorded_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_lead_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  sequence integer NOT NULL,
  kind text NOT NULL,
  pipeline_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  from_stage_key text,
  to_stage_key text NOT NULL,
  from_category text,
  to_category text NOT NULL,
  -- Bounded free text. Never in an event or an audit row; erasure nulls it.
  reason text,
  actor_tenant_user_id uuid,
  -- Effective time from the source, and when we learned it (ADR-0153 section 4).
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  -- A correction is a NEW row that references the row it corrects.
  corrects_transition_id uuid,
  CONSTRAINT awcms_crm_lead_transitions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_lead_transitions_sequence_key
    UNIQUE (tenant_id, lead_id, sequence),
  CONSTRAINT awcms_crm_lead_transitions_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_transitions_revision_fk
    FOREIGN KEY (tenant_id, pipeline_id, revision_id)
    REFERENCES awcms_crm_pipeline_revisions (tenant_id, pipeline_id, id),
  CONSTRAINT awcms_crm_lead_transitions_to_stage_fk
    FOREIGN KEY (tenant_id, revision_id, to_stage_key)
    REFERENCES awcms_crm_pipeline_stages (tenant_id, revision_id, stage_key),
  CONSTRAINT awcms_crm_lead_transitions_actor_fk
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_transitions_corrects_fk
    FOREIGN KEY (tenant_id, corrects_transition_id)
    REFERENCES awcms_crm_lead_transitions (tenant_id, id),
  CONSTRAINT awcms_crm_lead_transitions_sequence_check CHECK (sequence >= 1),
  CONSTRAINT awcms_crm_lead_transitions_kind_check
    CHECK (kind IN (
      'created', 'moved', 'stage_migrated', 'converted',
      'conversion_reversed', 'merged_away', 'merge_reverted')),
  CONSTRAINT awcms_crm_lead_transitions_category_check
    CHECK (
      to_category IN ('new', 'working', 'qualified', 'converted', 'lost', 'disqualified')
      AND (from_category IS NULL
        OR from_category IN ('new', 'working', 'qualified', 'converted', 'lost', 'disqualified'))
    ),
  CONSTRAINT awcms_crm_lead_transitions_created_check
    CHECK ((kind = 'created') = (from_stage_key IS NULL AND from_category IS NULL)),
  CONSTRAINT awcms_crm_lead_transitions_reason_check
    CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500)),
  CONSTRAINT awcms_crm_lead_transitions_idempotency_key_check
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 255)
);

-- The funnel: transitions INTO a category over time, per pipeline (L10).
CREATE INDEX IF NOT EXISTS awcms_crm_lead_transitions_funnel_idx
  ON awcms_crm_lead_transitions (tenant_id, pipeline_id, to_category, occurred_at);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_transitions_revision_stage_idx
  ON awcms_crm_lead_transitions (tenant_id, revision_id, to_stage_key);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_transitions_actor_idx
  ON awcms_crm_lead_transitions (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_transitions_corrects_idx
  ON awcms_crm_lead_transitions (tenant_id, corrects_transition_id)
  WHERE corrects_transition_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  from_owner_tenant_user_id uuid,
  to_owner_tenant_user_id uuid,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_crm_lead_assignments_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_assignments_from_fk
    FOREIGN KEY (tenant_id, from_owner_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_assignments_to_fk
    FOREIGN KEY (tenant_id, to_owner_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_assignments_by_fk
    FOREIGN KEY (tenant_id, assigned_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_assignments_change_check
    CHECK (from_owner_tenant_user_id IS DISTINCT FROM to_owner_tenant_user_id)
);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_assignments_lead_idx
  ON awcms_crm_lead_assignments (tenant_id, lead_id, assigned_at);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_assignments_from_idx
  ON awcms_crm_lead_assignments (tenant_id, from_owner_tenant_user_id)
  WHERE from_owner_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_assignments_to_idx
  ON awcms_crm_lead_assignments (tenant_id, to_owner_tenant_user_id)
  WHERE to_owner_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_assignments_by_idx
  ON awcms_crm_lead_assignments (tenant_id, assigned_by);

CREATE TABLE IF NOT EXISTS awcms_crm_lead_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  lead_id uuid NOT NULL,
  -- `authority_confirmed`: the downstream authority confirmed it (ADR-0153
  -- section 6). `authority_unconfirmed`: a flagged manual conversion by staff,
  -- reported separately (O13).
  mode text NOT NULL,
  external_customer_ref text,
  -- The replay key: a replayed confirmation is a no-op.
  evidence_ref text NOT NULL,
  -- Bounded free text, required by the application for a manual conversion.
  -- Never in an event or an audit row; erasure nulls it.
  note text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  reversed_at timestamptz,
  reversal_evidence_ref text,
  reversal_occurred_at timestamptz,
  reversed_by uuid,
  CONSTRAINT awcms_crm_lead_conversions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_lead_conversions_evidence_key
    UNIQUE (tenant_id, evidence_ref),
  CONSTRAINT awcms_crm_lead_conversions_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_conversions_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_conversions_reversed_by_fk
    FOREIGN KEY (tenant_id, reversed_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_conversions_mode_check
    CHECK (mode IN ('authority_confirmed', 'authority_unconfirmed')),
  CONSTRAINT awcms_crm_lead_conversions_customer_ref_check
    CHECK (
      (mode = 'authority_confirmed' AND external_customer_ref ~ '^[A-Za-z0-9._:-]{1,128}$')
      OR (mode = 'authority_unconfirmed'
        AND (external_customer_ref IS NULL OR external_customer_ref ~ '^[A-Za-z0-9._:-]{1,128}$'))
    ),
  CONSTRAINT awcms_crm_lead_conversions_evidence_check
    CHECK (evidence_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT awcms_crm_lead_conversions_note_check
    CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 1000)),
  CONSTRAINT awcms_crm_lead_conversions_reversal_check
    CHECK (
      (reversed_at IS NULL AND reversal_evidence_ref IS NULL
        AND reversal_occurred_at IS NULL AND reversed_by IS NULL)
      OR
      (reversed_at IS NOT NULL
        AND reversal_evidence_ref ~ '^[A-Za-z0-9._:-]{1,128}$'
        AND reversal_occurred_at IS NOT NULL AND reversed_by IS NOT NULL)
    )
);

-- At most one live conversion per lead.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_lead_conversions_live_key
  ON awcms_crm_lead_conversions (tenant_id, lead_id)
  WHERE reversed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_lead_conversions_reversal_evidence_key
  ON awcms_crm_lead_conversions (tenant_id, reversal_evidence_ref)
  WHERE reversal_evidence_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_conversions_lead_idx
  ON awcms_crm_lead_conversions (tenant_id, lead_id, recorded_at);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_conversions_recorded_by_idx
  ON awcms_crm_lead_conversions (tenant_id, recorded_by);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_conversions_reversed_by_idx
  ON awcms_crm_lead_conversions (tenant_id, reversed_by)
  WHERE reversed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS awcms_crm_lead_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  survivor_lead_id uuid NOT NULL,
  absorbed_lead_id uuid NOT NULL,
  -- Non-personal snapshot of the absorbed lead (ids, stage, version, the child
  -- rows that now answer under the survivor BY REFERENCE). Never a name or a
  -- contact value.
  snapshot jsonb NOT NULL,
  -- The reviewer's note, required by the application. Erasure nulls it.
  note text,
  merged_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  undo_until timestamptz NOT NULL,
  reverted_at timestamptz,
  reverted_by uuid,
  CONSTRAINT awcms_crm_lead_merges_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_crm_lead_merges_survivor_fk
    FOREIGN KEY (tenant_id, survivor_lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_merges_absorbed_fk
    FOREIGN KEY (tenant_id, absorbed_lead_id)
    REFERENCES awcms_crm_leads (tenant_id, id),
  CONSTRAINT awcms_crm_lead_merges_merged_by_fk
    FOREIGN KEY (tenant_id, merged_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_merges_reverted_by_fk
    FOREIGN KEY (tenant_id, reverted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_crm_lead_merges_distinct_check
    CHECK (survivor_lead_id <> absorbed_lead_id),
  CONSTRAINT awcms_crm_lead_merges_snapshot_check
    CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 8192),
  CONSTRAINT awcms_crm_lead_merges_note_check
    CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 1000)),
  CONSTRAINT awcms_crm_lead_merges_window_check
    CHECK (undo_until > merged_at),
  CONSTRAINT awcms_crm_lead_merges_reverted_check
    CHECK ((reverted_at IS NULL) = (reverted_by IS NULL))
);

-- An absorbed lead is absorbed by at most one live merge.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_crm_lead_merges_absorbed_live_key
  ON awcms_crm_lead_merges (tenant_id, absorbed_lead_id)
  WHERE reverted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_crm_lead_merges_survivor_idx
  ON awcms_crm_lead_merges (tenant_id, survivor_lead_id);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_merges_absorbed_idx
  ON awcms_crm_lead_merges (tenant_id, absorbed_lead_id);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_merges_merged_by_idx
  ON awcms_crm_lead_merges (tenant_id, merged_by);

CREATE INDEX IF NOT EXISTS awcms_crm_lead_merges_reverted_by_idx
  ON awcms_crm_lead_merges (tenant_id, reverted_by)
  WHERE reverted_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS FORCE on every table, standard tenant isolation.
-- ---------------------------------------------------------------------------
ALTER TABLE awcms_crm_leads_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_leads_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_leads_settings_tenant_isolation
  ON awcms_crm_leads_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_leads_settings FROM awcms_app;
REVOKE ALL ON awcms_crm_leads_settings FROM awcms_worker;

ALTER TABLE awcms_crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_pipelines FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_pipelines_tenant_isolation
  ON awcms_crm_pipelines
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_pipelines FROM awcms_app;
REVOKE ALL ON awcms_crm_pipelines FROM awcms_worker;

ALTER TABLE awcms_crm_pipeline_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_pipeline_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_pipeline_revisions_tenant_isolation
  ON awcms_crm_pipeline_revisions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_pipeline_revisions FROM awcms_app;
REVOKE ALL ON awcms_crm_pipeline_revisions FROM awcms_worker;

ALTER TABLE awcms_crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_pipeline_stages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_pipeline_stages_tenant_isolation
  ON awcms_crm_pipeline_stages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_pipeline_stages FROM awcms_app;
REVOKE ALL ON awcms_crm_pipeline_stages FROM awcms_worker;

ALTER TABLE awcms_crm_pipeline_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_pipeline_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_pipeline_transitions_tenant_isolation
  ON awcms_crm_pipeline_transitions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_pipeline_transitions FROM awcms_app;
REVOKE ALL ON awcms_crm_pipeline_transitions FROM awcms_worker;

ALTER TABLE awcms_crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_leads FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_leads_tenant_isolation
  ON awcms_crm_leads
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_leads FROM awcms_app;
REVOKE ALL ON awcms_crm_leads FROM awcms_worker;

ALTER TABLE awcms_crm_lead_contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_contact_points FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_contact_points_tenant_isolation
  ON awcms_crm_lead_contact_points
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_contact_points FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_contact_points FROM awcms_worker;

ALTER TABLE awcms_crm_lead_source_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_source_touches FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_source_touches_tenant_isolation
  ON awcms_crm_lead_source_touches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_source_touches FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_source_touches FROM awcms_worker;

ALTER TABLE awcms_crm_lead_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_transitions_tenant_isolation
  ON awcms_crm_lead_transitions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_transitions FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_transitions FROM awcms_worker;

ALTER TABLE awcms_crm_lead_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_assignments_tenant_isolation
  ON awcms_crm_lead_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_assignments FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_assignments FROM awcms_worker;

ALTER TABLE awcms_crm_lead_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_conversions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_conversions_tenant_isolation
  ON awcms_crm_lead_conversions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_conversions FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_conversions FROM awcms_worker;

ALTER TABLE awcms_crm_lead_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_crm_lead_merges FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_crm_lead_merges_tenant_isolation
  ON awcms_crm_lead_merges
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_crm_lead_merges FROM awcms_app;
REVOKE ALL ON awcms_crm_lead_merges FROM awcms_worker;

-- Append-only and immutable tables: the runtime may add rows, never change them.
REVOKE UPDATE ON awcms_crm_pipeline_revisions FROM awcms_app;
REVOKE UPDATE ON awcms_crm_pipeline_stages FROM awcms_app;
REVOKE UPDATE ON awcms_crm_pipeline_transitions FROM awcms_app;
REVOKE UPDATE ON awcms_crm_lead_source_touches FROM awcms_app;
REVOKE UPDATE ON awcms_crm_lead_assignments FROM awcms_app;

COMMENT ON TABLE awcms_crm_leads IS
  'Issue #1166 / ADR-0153 -- a pre-customer lead: owner, current stage (and the revision it was entered under), status and an opaque external_customer_ref written only by a conversion. Never a customer, a profile or a consent. Soft-deleted or anonymised, never hard-deleted by the runtime.';

COMMENT ON TABLE awcms_crm_lead_contact_points IS
  'Issue #1166 / ADR-0153 section 5 -- an email, phone or platform-scoped id of a lead as ciphertext + a per-tenant, per-kind keyed hash + a masked form (ADR-0137 shape). Candidate detection is an exact hash match inside one tenant.';

COMMENT ON TABLE awcms_crm_lead_transitions IS
  'Issue #1166 / ADR-0153 L7, L10 -- the append-only stage history. Every row names the revision it happened under; a correction is a new row referencing the one it corrects. Funnel counts are reproducible from these rows.';

COMMENT ON TABLE awcms_crm_pipeline_revisions IS
  'Issue #1166 / ADR-0153 section 3 -- an immutable published version of a pipeline''s stage catalog and allowed edges.';
