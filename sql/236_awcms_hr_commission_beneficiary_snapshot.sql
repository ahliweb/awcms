-- `hr_commission` — the beneficiary's login is SNAPSHOTTED on each accrual (Issue
-- #1019, ADR-0132, `docs/awcms/hr-payroll.md` section 8).
--
-- ## The hole this closes
--
-- `sql/188` found the beneficiary through `awcms_hr_employments.tenant_user_id`
-- at the moment of the transition. When that link is NULL the comparison
-- `approved_by = NULL` is never true, so the segregation-of-duties rule blocked
-- nothing. A user holding `hr_workforce.employments.assign` plus commission
-- approve/release could unlink their own employment's login, approve and
-- release their own accrual, and link the login back: three steps, no step-up.
--
-- ## The fix, fail closed
--
--   * `beneficiary_tenant_user_id` is the beneficiary's login AS OF THE
--     ACCRUAL'S BIRTH, stamped by the insert trigger from the employment's link
--     (whatever the writer supplied is discarded, exactly as attendance
--     corrections stamp `subject_tenant_user_id`, `sql/198`). It is a fact: the
--     existing facts-immutable trigger covers it with no change.
--   * `sql/237` enforces segregation of duties against BOTH the snapshot and the
--     current link, and refuses approve / release / pay while neither exists.
--
-- Existing rows are backfilled from the employment's CURRENT link (the best
-- evidence there is); a row whose employment is unlinked stays NULL and is then
-- refused until the employment is linked (fail closed).
--
-- ## Privacy
--
-- The column is an opaque tenant-user id, the same class as `created_by` and
-- `approved_by` already on the row. It is not exposed by any API. Grants are
-- unchanged (table-level), so no security-readiness matrix changes.

ALTER TABLE awcms_hr_commission_accruals
  ADD COLUMN IF NOT EXISTS beneficiary_tenant_user_id uuid;

DO $awcms_hr_commission_beneficiary_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_hr_commission_accruals_beneficiary_fkey'
  ) THEN
    ALTER TABLE awcms_hr_commission_accruals
      ADD CONSTRAINT awcms_hr_commission_accruals_beneficiary_fkey
      FOREIGN KEY (tenant_id, beneficiary_tenant_user_id)
      REFERENCES awcms_tenant_users (tenant_id, id);
  END IF;
END
$awcms_hr_commission_beneficiary_fk$;

CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_beneficiary_idx
  ON awcms_hr_commission_accruals (tenant_id, beneficiary_tenant_user_id)
  WHERE beneficiary_tenant_user_id IS NOT NULL;

-- Backfill from the current link. Two things stand in the way, and both are
-- lifted only for this one statement, inside the migration's transaction:
--
--   * The facts-immutable trigger refuses any change to a non-stamp column
--     (correctly, for everyone), so it is switched off and straight back on.
--   * Both tables are `FORCE ROW LEVEL SECURITY`, so even the owner is subject to
--     the tenant policy, and this backfill is deliberately cross-tenant: there is
--     no single `app.current_tenant_id` to SET, and leaving it unset aborts with
--     `unrecognized configuration parameter` under a non-BYPASSRLS migration
--     owner (it would pass on an empty database and break on a populated one).
--     Dropping FORCE for the duration says "this statement is deliberately
--     tenant-wide"; the runner wraps each migration in one transaction and the
--     ALTER TABLE takes ACCESS EXCLUSIVE, so no session can observe either table
--     while FORCE is off (the pattern and its reasoning are `sql/018`'s and
--     `sql/103`'s). The UPDATE still joins on `tenant_id`, so no row can be
--     stamped with another tenant's login.
ALTER TABLE awcms_hr_commission_accruals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_employments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_accruals
  DISABLE TRIGGER awcms_hr_commission_accruals_immutable;

UPDATE awcms_hr_commission_accruals a
   SET beneficiary_tenant_user_id = e.tenant_user_id
  FROM awcms_hr_employments e
 WHERE e.tenant_id = a.tenant_id
   AND e.id = a.employment_id
   AND e.tenant_user_id IS NOT NULL
   AND a.beneficiary_tenant_user_id IS NULL;

ALTER TABLE awcms_hr_commission_accruals
  ENABLE TRIGGER awcms_hr_commission_accruals_immutable;
ALTER TABLE awcms_hr_employments FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_accruals FORCE ROW LEVEL SECURITY;

-- A birth stamps the snapshot from the employment it already reads FOR SHARE.
-- Body identical to `sql/188` apart from the one stamp before RETURN.
CREATE OR REPLACE FUNCTION awcms_hr_commission_accruals_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $awcms_hr_commission_accrual_insert$
DECLARE
  v_rule awcms_hr_commission_rules%ROWTYPE;
  v_emp awcms_hr_employments%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending'
     OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL
     OR NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL
     OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL
     OR NEW.payment_reference IS NOT NULL
     OR NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL
     OR NEW.void_reason_code IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: an accrual is born pending with no transition stamp (Issue #951)'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_rule
  FROM awcms_hr_commission_rules
  WHERE tenant_id = NEW.tenant_id AND id = NEW.rule_id
  FOR SHARE;

  IF NOT FOUND
     OR v_rule.status <> 'published'
     OR v_rule.rule_key <> NEW.rule_key
     OR v_rule.version_no <> NEW.rule_version
     OR v_rule.source_type <> NEW.source_type
     OR v_rule.currency_code <> NEW.currency_code
     OR v_rule.calculation <> NEW.calculation
     OR v_rule.rate IS DISTINCT FROM NEW.rate
     OR v_rule.fixed_amount IS DISTINCT FROM NEW.fixed_amount
     OR v_rule.effective_from > NEW.occurred_on
     OR (v_rule.effective_to IS NOT NULL AND NEW.occurred_on >= v_rule.effective_to) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: the rule is not a published version in force for this event (Issue #951)'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.amount IS DISTINCT FROM awcms_hr_commission_expected_amount(
       v_rule.calculation, NEW.base_amount, v_rule.rate, v_rule.fixed_amount,
       NEW.units, v_rule.rounding_mode, v_rule.rounding_scale::integer,
       v_rule.min_amount, v_rule.max_amount) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: the amount is not the rule''s evaluation of the inputs (Issue #951)'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.occurred_at < now() - interval '730 days' THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: the event is older than 730 days (Issue #951)'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_emp
  FROM awcms_hr_employments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.employment_id
  FOR SHARE;

  IF NOT FOUND
     OR v_emp.deleted_at IS NOT NULL
     OR v_emp.hired_on > NEW.occurred_on
     OR (v_emp.terminated_on IS NOT NULL AND NEW.occurred_on > v_emp.terminated_on) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: the employment is not live and employed on the event date (Issue #951)'
      USING ERRCODE = '23514';
  END IF;

  -- The beneficiary's login AS OF BIRTH (Issue #1019). Stamped HERE; whatever
  -- the writer supplied is discarded. NULL when the employment is unlinked.
  NEW.beneficiary_tenant_user_id := v_emp.tenant_user_id;

  RETURN NEW;
END;
$awcms_hr_commission_accrual_insert$;
