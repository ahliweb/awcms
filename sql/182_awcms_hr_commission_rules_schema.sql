-- `hr_commission` phase 2 foundation — versioned commission rules (Issue #950,
-- ADR-0132, `docs/awcms/hr-payroll.md` sections 6.1 and 8).
--
-- ## The shape, in one paragraph
--
-- A commission RULE is a jurisdiction-neutral, tenant-authored statement of how
-- a share of a source amount becomes a commission: a PERCENT of a base amount or
-- a FIXED amount per unit, in one currency, rounded under one explicit rule, with
-- an optional floor and ceiling. A rule is identified by `rule_key` and changes
-- only by a NEW VERSION (`version_no`); the version in force for an event is the
-- one whose half-open window `[effective_from, effective_to)` contains the
-- event's own date, never `now()`. Nothing here is about any country's law, and
-- no employment, person or earning is stored: this is configuration. The accrual
-- ledger that will cite a version is a later issue of the same ADR.
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * A PUBLISHED OR RETIRED VERSION IS IMMUTABLE. `draft` rows may be edited and
--     may move to `published` (or `retired`, abandoning the draft); a published
--     row's ONLY permitted change is the move to `retired`, which stamps who and
--     when and leaves every other column byte-identical; a retired row never
--     changes. A later ledger row that cites a version therefore cites a body
--     that cannot have moved.
--   * NO TWO PUBLISHED VERSIONS OF ONE RULE OVERLAP. A trigger takes a
--     transaction-scoped advisory lock per (tenant, rule) before it looks, so two
--     concurrent publishes serialise and the second sees the first's committed
--     row (an exclusion constraint would need `btree_gist`, a privileged
--     `CREATE EXTENSION` no other migration here asks for). Retired versions no
--     longer count.
--   * A ROW IS BORN A DRAFT. A BEFORE INSERT trigger refuses any other status
--     and any lifecycle stamp, so a published version can only ever come from a
--     draft that passed the overlap check on its way. (A draft may move straight
--     to `retired`: that is "abandon this draft" and is intentional, so a
--     retired row does NOT imply it was ever published; `published_at` says.)
--   * NO ROW IS EVER DELETED. A mistaken or superseded rule is retired.
--   * THE SHAPE IS CONSISTENT: a percent rule has a rate and no fixed amount, a
--     fixed rule the reverse; the floor never exceeds the ceiling; a floor or
--     ceiling carries no more decimals than the rounding scale, so clamping
--     after rounding can never produce an unroundable amount.
--
-- ## Money is exact
--
-- `numeric`, never a float column, and never NaN (a `numeric` accepts 'NaN'
-- and NaN passes a `>= 0` check, so every money/rate column carries an explicit
-- `<> 'NaN'` check); the application evaluates with `bigint`
-- arithmetic and the API carries every amount and rate as a decimal STRING.
--
-- ## Classification
--
-- CONFIDENTIAL (a tenant's commercial terms). Carries no personal data: the only
-- person-shaped columns are the four actor stamps. Every reference is a
-- composite `(tenant_id, ...)` foreign key. RLS ENABLE + FORCE with a
-- USING/WITH CHECK policy.

CREATE TABLE IF NOT EXISTS awcms_hr_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The rule this is a version OF. Free-form within a tenant: a tenant names its
  -- own rules ("room_upsell", "service_basic").
  rule_key text NOT NULL,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  name text NOT NULL,
  -- The kind of source event this applies to. An opaque, tenant-defined code:
  -- this module imports neither commerce nor booking (hr-payroll.md 6.4).
  source_type text NOT NULL,
  calculation text NOT NULL,
  -- PERCENT: a percentage of the base amount (2.5 = 2.5 %). Never a fraction.
  rate numeric(9, 6),
  -- FIXED: an amount per unit.
  fixed_amount numeric(18, 6),
  -- Optional clamp on the rounded commission.
  min_amount numeric(18, 6),
  max_amount numeric(18, 6),
  currency_code char(3) NOT NULL,
  rounding_mode text NOT NULL,
  rounding_scale smallint NOT NULL,
  effective_from date NOT NULL,
  -- Exclusive end; NULL = open-ended.
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  published_at timestamptz,
  published_by uuid,
  retired_at timestamptz,
  retired_by uuid,
  CONSTRAINT awcms_hr_commission_rules_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_commission_rules_number_key
    UNIQUE (tenant_id, rule_key, version_no),
  CONSTRAINT awcms_hr_commission_rules_status_check
    CHECK (status IN ('draft', 'published', 'retired')),
  CONSTRAINT awcms_hr_commission_rules_key_check
    CHECK (rule_key ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_rules_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_rules_version_check
    CHECK (version_no >= 1),
  CONSTRAINT awcms_hr_commission_rules_name_check
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT awcms_hr_commission_rules_calculation_check
    CHECK (calculation IN ('percent', 'fixed')),
  CONSTRAINT awcms_hr_commission_rules_shape_check
    CHECK (
      (calculation = 'percent'
         AND rate IS NOT NULL AND fixed_amount IS NULL
         AND rate >= 0 AND rate <= 100)
      OR
      (calculation = 'fixed'
         AND fixed_amount IS NOT NULL AND rate IS NULL
         AND fixed_amount >= 0)
    ),
  CONSTRAINT awcms_hr_commission_rules_not_nan_check
    CHECK (
      (rate IS NULL OR rate <> 'NaN')
      AND (fixed_amount IS NULL OR fixed_amount <> 'NaN')
      AND (min_amount IS NULL OR min_amount <> 'NaN')
      AND (max_amount IS NULL OR max_amount <> 'NaN')
    ),
  CONSTRAINT awcms_hr_commission_rules_bounds_check
    CHECK (
      (min_amount IS NULL OR min_amount >= 0)
      AND (max_amount IS NULL OR max_amount >= 0)
      AND (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
    ),
  CONSTRAINT awcms_hr_commission_rules_currency_check
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT awcms_hr_commission_rules_rounding_mode_check
    CHECK (rounding_mode IN (
      'half_up', 'half_down', 'half_even', 'up', 'down', 'ceiling', 'floor'
    )),
  CONSTRAINT awcms_hr_commission_rules_rounding_scale_check
    CHECK (rounding_scale BETWEEN 0 AND 6),
  -- A clamp value must be representable at the rounding scale.
  CONSTRAINT awcms_hr_commission_rules_bounds_scale_check
    CHECK (
      (min_amount IS NULL OR min_amount = round(min_amount, rounding_scale))
      AND (max_amount IS NULL OR max_amount = round(max_amount, rounding_scale))
    ),
  CONSTRAINT awcms_hr_commission_rules_window_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT awcms_hr_commission_rules_lifecycle_check
    CHECK (
      (status = 'draft' AND published_at IS NULL AND retired_at IS NULL)
      OR (status = 'published' AND published_at IS NOT NULL AND retired_at IS NULL)
      OR (status = 'retired' AND retired_at IS NOT NULL)
    ),
  CONSTRAINT awcms_hr_commission_rules_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_rules_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_rules_published_by_fkey
    FOREIGN KEY (tenant_id, published_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_rules_retired_by_fkey
    FOREIGN KEY (tenant_id, retired_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- The version applied to an event: rule, then the window containing its date.
-- Partial — only published versions are ever resolved.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_resolve_idx
  ON awcms_hr_commission_rules (tenant_id, rule_key, effective_from DESC)
  WHERE status = 'published';

-- The admin listing: newest first.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_list_idx
  ON awcms_hr_commission_rules (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_created_by_idx
  ON awcms_hr_commission_rules (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_updated_by_idx
  ON awcms_hr_commission_rules (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_published_by_idx
  ON awcms_hr_commission_rules (tenant_id, published_by) WHERE published_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_rules_retired_by_idx
  ON awcms_hr_commission_rules (tenant_id, retired_by) WHERE retired_by IS NOT NULL;

ALTER TABLE awcms_hr_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_commission_rules_tenant_isolation
  ON awcms_hr_commission_rules
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No DELETE, ever: a rule ends by being retired.
REVOKE DELETE, TRUNCATE ON awcms_hr_commission_rules FROM awcms_app;

-- The BEGIN/END below are PL/pgSQL block delimiters inside a dollar-quoted body,
-- NOT transaction control — the migration runner strips dollar-quoted blocks
-- before its transaction-control scan (scripts/db-migrate.ts).
CREATE OR REPLACE FUNCTION awcms_hr_commission_rules_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $awcms_hr_commission_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'awcms_hr_commission_rules row % cannot be deleted: retire it (ADR-0132)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- Identity never changes in any state.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.rule_key <> OLD.rule_key OR NEW.version_no <> OLD.version_no
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION
      'awcms_hr_commission_rules: a version''s identity cannot change; create a new version'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION
      'awcms_hr_commission_rules row % is retired and immutable (ADR-0132)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'published' THEN
    -- The ONE permitted change: retiring it. Every other column stays
    -- byte-identical (the actor/time stamps of the retirement excepted).
    IF NEW.status <> 'retired'
       OR (to_jsonb(NEW) - 'status' - 'retired_at' - 'retired_by'
                         - 'updated_at' - 'updated_by')
          IS DISTINCT FROM
          (to_jsonb(OLD) - 'status' - 'retired_at' - 'retired_by'
                         - 'updated_at' - 'updated_by') THEN
      RAISE EXCEPTION
        'awcms_hr_commission_rules row % is published and immutable (ADR-0132): publish a new version instead',
        OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_guard$;

-- A row is born a draft: no other status, no lifecycle stamp.
CREATE OR REPLACE FUNCTION awcms_hr_commission_rules_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $awcms_hr_commission_insert$
BEGIN
  IF NEW.status <> 'draft'
     OR NEW.published_at IS NOT NULL OR NEW.published_by IS NOT NULL
     OR NEW.retired_at IS NOT NULL OR NEW.retired_by IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_hr_commission_rules: a version must be inserted as a draft (ADR-0132); publish it afterwards'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_insert$;

CREATE TRIGGER awcms_hr_commission_rules_born_draft
  BEFORE INSERT ON awcms_hr_commission_rules
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_rules_insert_guard();

CREATE TRIGGER awcms_hr_commission_rules_immutable
  BEFORE UPDATE OR DELETE ON awcms_hr_commission_rules
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_rules_guard();

CREATE OR REPLACE FUNCTION awcms_hr_commission_rules_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $awcms_hr_commission_overlap$
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  -- Serialise every publish of this rule. The key includes the tenant, so two
  -- tenants' same-named rules do not queue behind one another.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hr_commission_rule:' || NEW.tenant_id::text || ':' || NEW.rule_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM awcms_hr_commission_rules other
    WHERE other.tenant_id = NEW.tenant_id
      AND other.rule_key = NEW.rule_key
      AND other.status = 'published'
      AND other.id <> NEW.id
      AND daterange(other.effective_from, other.effective_to, '[)')
          && daterange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_rules: published windows for rule % overlap (ADR-0132)',
      NEW.rule_key
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_overlap$;

CREATE TRIGGER awcms_hr_commission_rules_no_overlap
  BEFORE INSERT OR UPDATE ON awcms_hr_commission_rules
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_rules_no_overlap();

COMMENT ON TABLE awcms_hr_commission_rules IS
  'Issue #950 / ADR-0132 — CONFIDENTIAL. Versioned, jurisdiction-neutral commission rules (percent or fixed per unit). Draft rows are editable; published and retired rows are immutable by trigger (a published row may only become retired); published windows of one rule never overlap (advisory-locked trigger); never deleted. No personal data beyond actor stamps.';
COMMENT ON COLUMN awcms_hr_commission_rules.effective_to IS
  'Issue #950 — EXCLUSIVE end of the window; NULL = open-ended. A successor version must start on or after it.';
