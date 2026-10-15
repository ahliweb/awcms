-- `hr_commission` — segregation of duties against the beneficiary SNAPSHOT as
-- well as the current link, failing closed when neither exists (Issue #1019,
-- ADR-0132). Companion of `sql/236`, which adds and stamps the snapshot column.
--
-- Only the segregation block of `awcms_hr_commission_accruals_guard()` differs
-- from `sql/188`; every other check is copied unchanged. The trigger itself is
-- not recreated: `CREATE OR REPLACE FUNCTION` swaps the body in place.

-- The facts never change; only the five edges exist; each edge stamps itself.
CREATE OR REPLACE FUNCTION awcms_hr_commission_accruals_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $awcms_hr_commission_accrual_guard$
DECLARE
  v_facts_new jsonb;
  v_facts_old jsonb;
  v_beneficiary uuid;
  v_stamps text[] := ARRAY[
    'status', 'approved_at', 'approved_by', 'released_at', 'released_by',
    'paid_at', 'paid_by', 'payment_reference', 'voided_at', 'voided_by',
    'void_reason_code'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row % cannot be deleted (Issue #951)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  v_facts_new := to_jsonb(NEW) - v_stamps;
  v_facts_old := to_jsonb(OLD) - v_stamps;

  IF v_facts_new IS DISTINCT FROM v_facts_old THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row % has immutable monetary facts (Issue #951)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = OLD.status THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION
        'awcms_hr_commission_accruals row %: a stamp changes only with a status transition (Issue #951)', OLD.id
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'voided'))
    OR (OLD.status = 'approved' AND NEW.status IN ('payable', 'voided'))
    OR (OLD.status = 'payable' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: % -> % is not a permitted transition (Issue #951)',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;

  -- Every stamp not belonging to this edge is unchanged (the lifecycle CHECK
  -- then proves the stamps of the edge itself are present).
  IF NEW.status <> 'approved' AND (
       NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
    RAISE EXCEPTION 'awcms_hr_commission_accruals row %: unexpected approval stamp change', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'payable' AND (
       NEW.released_at IS DISTINCT FROM OLD.released_at
       OR NEW.released_by IS DISTINCT FROM OLD.released_by) THEN
    RAISE EXCEPTION 'awcms_hr_commission_accruals row %: unexpected release stamp change', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'paid' AND (
       NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
       OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference) THEN
    RAISE EXCEPTION 'awcms_hr_commission_accruals row %: unexpected payment stamp change', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'voided' AND (
       NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
       OR NEW.void_reason_code IS DISTINCT FROM OLD.void_reason_code) THEN
    RAISE EXCEPTION 'awcms_hr_commission_accruals row %: unexpected void stamp change', OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- Segregation of duties (Issue #951, hardened by Issue #1019). The beneficiary
  -- is identified by BOTH the login snapshotted at the accrual's birth
  -- (`beneficiary_tenant_user_id`, `sql/236`) and the employment's login NOW:
  -- unlinking or re-pointing the employment between birth and transition cannot
  -- make the beneficiary someone else. When NEITHER exists the beneficiary
  -- cannot be identified at all, and approve, release and pay are REFUSED
  -- (fail closed) rather than segregating against NULL, which constrains
  -- nothing. `created_by` / `approved_by` NULL (system-created / unstamped)
  -- still constrain nothing; the handler refuses a NULL actor.
  IF NEW.status IN ('approved', 'payable', 'paid') THEN
    SELECT tenant_user_id INTO v_beneficiary
    FROM awcms_hr_employments
    WHERE tenant_id = NEW.tenant_id AND id = NEW.employment_id
    FOR SHARE;

    IF v_beneficiary IS NULL AND NEW.beneficiary_tenant_user_id IS NULL THEN
      RAISE EXCEPTION
        'awcms_hr_commission_accruals row %: BENEFICIARY_LOGIN_UNRESOLVED - the beneficiary employment has no linked login and no snapshot, so segregation of duties cannot be proven (Issue #1019)',
        OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'approved'
     AND (NEW.approved_by = v_beneficiary
          OR NEW.approved_by = NEW.beneficiary_tenant_user_id
          OR NEW.approved_by = NEW.created_by) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary or the creator cannot approve the accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'payable'
     AND (NEW.released_by = v_beneficiary
          OR NEW.released_by = NEW.beneficiary_tenant_user_id) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary cannot release their own accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'paid'
     AND (NEW.paid_by = v_beneficiary
          OR NEW.paid_by = NEW.beneficiary_tenant_user_id
          OR NEW.paid_by = NEW.approved_by) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary or the approver cannot pay the accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_accrual_guard$;
