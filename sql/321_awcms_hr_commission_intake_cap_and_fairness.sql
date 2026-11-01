-- 321_awcms_hr_commission_intake_cap_and_fairness.sql
--
-- Issue #1211 (follow-up to #1189 audit M2, L4, L7; ADR-0147):
--   1. Per-tenant live-row cap (`pending` + `posting` <= 10,000, a constant: no
--      session setting can move it) and module-enabled
--      check (`awcms_tenant_modules.enabled` for `hr_commission`) enforced at
--      insert time inside `awcms_hr_commission_intents_guard_insert()` as a
--      narrow `SECURITY DEFINER` trigger owned by the NOLOGIN, memberless
--      `awcms_hr_commission_lifecycle_counter` role. `awcms_worker` keeps zero
--      direct `SELECT` on `awcms_hr_commission_intents` and `awcms_tenant_modules`.
--      When the module or switch is off, the trigger raises `55000` (`disabled`);
--      when the tenant's live queue is at cap (and the row is not an idempotent
--      replay of an existing row), it raises `54000` (`full`).
--   2. Separate `deferrals` counter on `awcms_hr_commission_intents` (L7): a void
--      deferred while awaiting its origin accrual increments `deferrals` and
--      gives back its `attempts` claim, so deferrals never consume error retries
--      or reuse a previous `(attempts, deferrals)` lease token.
--   3. Composite index `(tenant_id, status, created_at)` to bound per-status
--      summary counts and live-row cap checks.
--   4. Dry-run retention count fix (L4): `awcms_hr_commission_lifecycle_eligible_count`
--      counts only terminal rows (`status IN ('posted', 'refused', 'failed')`)
--      older than `p_cutoff`, never live `pending` or `posting` work.
--   5. Narrow `awcms_hr_commission_intake_non_idle_tenants()` discovery function
--      (owned by `awcms_hr_commission_lifecycle_counter`, `EXECUTE` granted only
--      to `awcms_app`) so `hr-commission:intents:post` skips idle tenants with
--      zero tenant transactions per tick.

ALTER TABLE awcms_hr_commission_intents
  ADD COLUMN IF NOT EXISTS deferrals integer NOT NULL DEFAULT 0
    CONSTRAINT awcms_hr_commission_intents_deferrals_check
      CHECK (deferrals BETWEEN 0 AND 100000);

CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_status_idx
  ON awcms_hr_commission_intents (tenant_id, status, created_at);

-- Column-level grants for the NOLOGIN, memberless counter/guard owner role.
-- Never granted `base_amount` or any payroll-family relation.
GRANT SELECT (tenant_id, module_key, enabled)
  ON awcms_tenant_modules TO awcms_hr_commission_lifecycle_counter;
GRANT SELECT (tenant_id, created_at, commission_intake_enabled)
  ON awcms_hr_commission_intake_settings TO awcms_hr_commission_lifecycle_counter;
GRANT SELECT (
  tenant_id,
  status,
  updated_at,
  kind,
  source_type,
  source_ref,
  source_line,
  employment_id,
  request_digest
) ON awcms_hr_commission_intents TO awcms_hr_commission_lifecycle_counter;

DROP POLICY IF EXISTS awcms_hr_commission_intake_settings_counter_select
  ON awcms_hr_commission_intake_settings;
CREATE POLICY awcms_hr_commission_intake_settings_counter_select
  ON awcms_hr_commission_intake_settings
  FOR SELECT
  TO awcms_hr_commission_lifecycle_counter
  USING (true);

DROP POLICY IF EXISTS awcms_tenant_modules_commission_intake_counter_select
  ON awcms_tenant_modules;
CREATE POLICY awcms_tenant_modules_commission_intake_counter_select
  ON awcms_tenant_modules
  FOR SELECT
  TO awcms_hr_commission_lifecycle_counter
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Insert guard: born pending, tenant match, module + switch enabled, live-row cap.
CREATE OR REPLACE FUNCTION awcms_hr_commission_intents_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant uuid;
  v_module_enabled boolean;
  v_max_live integer;
  v_live integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.attempts IS DISTINCT FROM 0
     OR NEW.deferrals IS DISTINCT FROM 0
     OR NEW.outcome_code IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_hr_commission: an intake row is born pending, with no attempts and no outcome'
      USING ERRCODE = '55000';
  END IF;

  v_tenant := nullif(current_setting('app.current_tenant_id', true), '')::uuid;

  IF v_tenant IS NULL OR NEW.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION
      'awcms_hr_commission: tenant_id on a commission intent must match app.current_tenant_id'
      USING ERRCODE = '42501';
  END IF;

  SELECT tm.enabled INTO v_module_enabled
  FROM awcms_tenant_modules AS tm
  WHERE tm.tenant_id = NEW.tenant_id
    AND tm.module_key = 'hr_commission';

  IF COALESCE(v_module_enabled, true) IS NOT TRUE THEN
    RAISE EXCEPTION
      'awcms_hr_commission: module hr_commission is not enabled for this tenant'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM awcms_hr_commission_intake_settings AS s
    WHERE s.tenant_id = NEW.tenant_id AND s.commission_intake_enabled
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: commission intake is not enabled for this tenant'
      USING ERRCODE = '55000';
  END IF;

  v_max_live := 10000;

  SELECT count(*)::integer INTO v_live
  FROM (
    SELECT 1
    FROM awcms_hr_commission_intents AS i
    WHERE i.tenant_id = NEW.tenant_id
      AND i.status IN ('pending', 'posting')
    LIMIT v_max_live
  ) AS live;

  IF v_live >= v_max_live AND NOT EXISTS (
    SELECT 1
    FROM awcms_hr_commission_intents AS dup
    WHERE dup.tenant_id = NEW.tenant_id
      AND dup.kind = NEW.kind
      AND dup.source_type = NEW.source_type
      AND dup.source_ref = NEW.source_ref
      AND dup.source_line = NEW.source_line
      AND dup.employment_id = NEW.employment_id
      AND dup.request_digest = NEW.request_digest
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: commission intake queue is full for this tenant (% rows)',
      v_max_live
      USING ERRCODE = '54000';
  END IF;

  NEW.next_attempt_at := now();
  NEW.created_at := now();
  NEW.updated_at := now();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION awcms_hr_commission_intents_guard_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_commission_intents_guard_insert()
  TO awcms_app, awcms_worker;
ALTER FUNCTION awcms_hr_commission_intents_guard_insert()
  OWNER TO awcms_hr_commission_lifecycle_counter;

-- Update guard: separate deferrals counter from error attempts (L7).
CREATE OR REPLACE FUNCTION awcms_hr_commission_intents_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.source_line IS DISTINCT FROM OLD.source_line
     OR NEW.employment_id IS DISTINCT FROM OLD.employment_id
     OR NEW.rule_key IS DISTINCT FROM OLD.rule_key
     OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
     OR NEW.units IS DISTINCT FROM OLD.units
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.claimed_by_tenant_user_id IS DISTINCT FROM OLD.claimed_by_tenant_user_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'awcms_hr_commission: the request of an intake row is immutable (%)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('posted', 'refused', 'failed') THEN
    RAISE EXCEPTION
      'awcms_hr_commission: intake row % is %, and a settled row does not change',
      OLD.id, OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
       (OLD.status = 'pending' AND NEW.status IN ('pending', 'posting'))
    OR (OLD.status = 'posting'
        AND NEW.status IN ('posting', 'pending', 'posted', 'refused', 'failed'))
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: intake row % may not move from % to %',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;

  IF NEW.deferrals < OLD.deferrals THEN
    RAISE EXCEPTION
      'awcms_hr_commission: deferrals of intake row % never go down', OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- Attempts never go down, except on a void deferral (posting -> pending),
  -- which increments deferrals by 1 and gives back the claim's 1 attempt.
  IF NEW.attempts < OLD.attempts
     AND NOT (
       OLD.status = 'posting'
       AND NEW.status = 'pending'
       AND OLD.kind = 'void'
       AND NEW.attempts = OLD.attempts - 1
       AND NEW.deferrals = OLD.deferrals + 1
     ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: attempts of intake row % never go down', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.deferrals > OLD.deferrals
     AND NOT (
       OLD.status = 'posting'
       AND NEW.status = 'pending'
       AND OLD.kind = 'void'
       AND NEW.attempts = OLD.attempts - 1
       AND NEW.deferrals = OLD.deferrals + 1
     ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: deferrals of intake row % only advance on a void deferral',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at := now();

  RETURN NEW;
END;
$function$;

-- Retention dry-run count (L4): count only terminal rows past the cutoff.
CREATE OR REPLACE FUNCTION awcms_hr_commission_lifecycle_eligible_count(
  p_table text,
  p_tenant_id uuid,
  p_cutoff timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_table = 'awcms_hr_commission_intents' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_commission_intents AS x
    WHERE x.tenant_id = p_tenant_id
      AND x.status IN ('posted', 'refused', 'failed')
      AND x.updated_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_commission_intake_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_commission_intake_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION
      'awcms_hr_commission_lifecycle_eligible_count: table % is not one of this module''s lifecycle descriptors',
      p_table
      USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz)
  OWNER TO awcms_hr_commission_lifecycle_counter;

-- Non-idle tenant discovery for the poster job: tenants with intake enabled or
-- any row in the intake table. Idle tenants cost zero tenant transactions.
CREATE OR REPLACE FUNCTION awcms_hr_commission_intake_non_idle_tenants()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT s.tenant_id
  FROM awcms_hr_commission_intake_settings AS s
  WHERE s.commission_intake_enabled = true
  UNION
  SELECT DISTINCT i.tenant_id
  FROM awcms_hr_commission_intents AS i;
$function$;

COMMENT ON FUNCTION awcms_hr_commission_intake_non_idle_tenants() IS
  'Issue #1211 -- narrow SECURITY DEFINER discovery returning tenant_ids that either have commission_intake_enabled = true or hold any row in awcms_hr_commission_intents, so hr-commission:intents:post skips idle tenants with zero tenant transactions per tick. Owned by awcms_hr_commission_lifecycle_counter; EXECUTE granted only to awcms_app.';

REVOKE ALL ON FUNCTION awcms_hr_commission_intake_non_idle_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_commission_intake_non_idle_tenants() TO awcms_app;
ALTER FUNCTION awcms_hr_commission_intake_non_idle_tenants()
  OWNER TO awcms_hr_commission_lifecycle_counter;

