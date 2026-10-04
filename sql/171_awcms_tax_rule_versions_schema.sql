-- Issue #889 / ADR-0127 — versioned, jurisdiction-neutral tax rule versions.
--
-- One table. A "profile" is a code (`profile_code`) shared by the versions that
-- replace one another over time, not a row of its own: a profile row would carry
-- nothing a version does not already carry, and every extra table is a retention
-- question that `data-lifecycle:table-coverage:check` makes somebody answer. A
-- version's categories, rules and components live in `definition` (jsonb) and are
-- validated by the application before they get here; the table's job is the
-- invariants a database can enforce that the application can only promise.
--
-- ## A published version is immutable
--
-- `awcms_tax_rule_versions_guard` refuses to change or delete a published row —
-- with ONE exception: a version that is open-ended (`effective_to IS NULL`) may
-- have its end date set, once, when its successor is published. That is the only
-- way a version ever ends, and the guard permits nothing else: every other column
-- must be byte-identical. A snapshot that cites a version therefore cites a body
-- that cannot have moved, and "updating a rule never changes a historical
-- document" is a property of the table, not a convention of the code.
--
-- ## Published windows never overlap
--
-- Per (tenant, profile). Enforced by a trigger that takes a transaction-scoped
-- advisory lock on the profile before it looks, so two concurrent publishes
-- serialise and the second sees the first's committed row. The alternative — an
-- exclusion constraint — needs the `btree_gist` extension, which needs a
-- privileged `CREATE EXTENSION` that no other migration in this repo asks for
-- and that a managed-database operator may not grant to the migration role. The
-- trigger gives the same guarantee for every writer that goes through SQL.
--
-- ## Half-open windows
--
-- `effective_from` inclusive, `effective_to` EXCLUSIVE, `NULL` = open-ended. A
-- version ending 2027-01-01 and its successor starting 2027-01-01 share no day
-- and leave no gap.

CREATE TABLE IF NOT EXISTS awcms_tax_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),

  -- The profile this is a version OF. Free-form within a tenant on purpose: a
  -- tenant names its own profiles ("retail", "export", "services-regional").
  profile_code text NOT NULL,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',

  name text NOT NULL,

  -- The jurisdiction/scope this profile answers for. Opaque, tenant-defined
  -- codes: the core ships no country list and no country's law.
  jurisdiction_code text NOT NULL,
  country_code char(2),
  region_code text,

  currency_code char(3) NOT NULL,
  pricing_mode text NOT NULL,
  rounding_mode text NOT NULL,
  rounding_scale smallint NOT NULL,
  rounding_level text NOT NULL,

  effective_from date NOT NULL,
  -- Exclusive. NULL = open-ended.
  effective_to date,

  notes text,

  -- {categories: [...], rules: [...]} — see `tax-types.ts`.
  definition jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid,

  CONSTRAINT awcms_tax_rule_versions_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT awcms_tax_rule_versions_number_unique
    UNIQUE (tenant_id, profile_code, version_no),
  CONSTRAINT awcms_tax_rule_versions_status_check
    CHECK (status IN ('draft', 'published')),
  CONSTRAINT awcms_tax_rule_versions_profile_code_check
    CHECK (profile_code ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_tax_rule_versions_pricing_mode_check
    CHECK (pricing_mode IN ('exclusive', 'inclusive')),
  CONSTRAINT awcms_tax_rule_versions_rounding_mode_check
    CHECK (rounding_mode IN (
      'half_up', 'half_down', 'half_even', 'up', 'down', 'ceiling', 'floor'
    )),
  CONSTRAINT awcms_tax_rule_versions_rounding_level_check
    CHECK (rounding_level IN ('line', 'document')),
  -- 6 is the widest scale the snapshot's numeric(24,6) columns can store.
  CONSTRAINT awcms_tax_rule_versions_rounding_scale_check
    CHECK (rounding_scale BETWEEN 0 AND 6),
  CONSTRAINT awcms_tax_rule_versions_window_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT awcms_tax_rule_versions_definition_check
    CHECK (
      jsonb_typeof(definition) = 'object'
      AND octet_length(definition::text) <= 262144
    ),
  -- A published version always says when and (when known) by whom.
  CONSTRAINT awcms_tax_rule_versions_published_check
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- The version a document is taxed under: profile, then the window containing the
-- document's date. Partial — only published versions are ever resolved.
CREATE INDEX IF NOT EXISTS awcms_tax_rule_versions_resolve_idx
  ON awcms_tax_rule_versions (tenant_id, profile_code, effective_from DESC)
  WHERE status = 'published';

-- The admin listing: newest first.
CREATE INDEX IF NOT EXISTS awcms_tax_rule_versions_created_idx
  ON awcms_tax_rule_versions (tenant_id, created_at DESC, id DESC);

ALTER TABLE awcms_tax_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tax_rule_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tax_rule_versions_tenant_isolation
  ON awcms_tax_rule_versions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The BEGIN/END below are PL/pgSQL block delimiters inside a dollar-quoted body,
-- NOT transaction control — the migration runner strips dollar-quoted blocks
-- before its transaction-control scan (scripts/db-migrate.ts).
CREATE OR REPLACE FUNCTION awcms_tax_rule_versions_guard()
RETURNS trigger AS $awcms_tax_versions_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION
        'awcms_tax_rule_versions row % is published and cannot be deleted (ADR-0127)',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' THEN
    -- The one permitted change: closing an open-ended window. Everything else —
    -- including re-opening a closed one — must be unchanged.
    IF OLD.effective_to IS NOT NULL
       OR NEW.effective_to IS NULL
       OR NEW.effective_to <= OLD.effective_from
       OR (to_jsonb(NEW) - 'effective_to' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to' - 'updated_at') THEN
      RAISE EXCEPTION
        'awcms_tax_rule_versions row % is published and immutable (ADR-0127): publish a new version instead',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$awcms_tax_versions_guard$ LANGUAGE plpgsql;

CREATE TRIGGER awcms_tax_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON awcms_tax_rule_versions
  FOR EACH ROW
  EXECUTE FUNCTION awcms_tax_rule_versions_guard();

CREATE OR REPLACE FUNCTION awcms_tax_rule_versions_no_overlap()
RETURNS trigger AS $awcms_tax_versions_overlap$
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  -- Serialise every publish for this profile. `hashtextextended` over a string
  -- that includes the tenant, so two tenants' same-named profiles do not queue
  -- behind one another.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':' || NEW.profile_code, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM awcms_tax_rule_versions other
    WHERE other.tenant_id = NEW.tenant_id
      AND other.profile_code = NEW.profile_code
      AND other.status = 'published'
      AND other.id <> NEW.id
      AND daterange(other.effective_from, other.effective_to, '[)')
          && daterange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION
      'tax rule version windows for profile % overlap (ADR-0127)',
      NEW.profile_code
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$awcms_tax_versions_overlap$ LANGUAGE plpgsql;

CREATE TRIGGER awcms_tax_rule_versions_no_overlap
  BEFORE INSERT OR UPDATE ON awcms_tax_rule_versions
  FOR EACH ROW
  EXECUTE FUNCTION awcms_tax_rule_versions_no_overlap();

COMMENT ON COLUMN awcms_tax_rule_versions.definition IS
  'ADR-0127 — {categories, rules}. Validated by the application before insert and IMMUTABLE once published: a rule edit is a new version.';

COMMENT ON COLUMN awcms_tax_rule_versions.effective_to IS
  'ADR-0127 — EXCLUSIVE end of the window; NULL = open-ended. The only column a published row may change, and only from NULL, when its successor is published.';
