-- `hr_commission` phase 2 — the accrual ledger and its transition log (Issue
-- #951, ADR-0132, `docs/awcms/hr-payroll.md` sections 6.1-6.3 and 8).
--
-- ## The shape, in one paragraph
--
-- An ACCRUAL is one commission earned by one EMPLOYMENT from one SOURCE event
-- (an opaque `(source_type, source_ref, source_line)` an adapter reports; this
-- module imports nothing from commerce or booking). Its monetary FACTS — who,
-- which rule version, the inputs, the rate snapshot, the amount, the currency,
-- when it happened — are written once and never change. Only `status` and the
-- stamps of the transition that set it advance, along
--
--     pending --approve--> approved --release--> payable --pay--> paid
--        \________void_______/
--
-- (`void` is from `pending` or `approved` only: no money was committed, so no
-- compensating row exists. A reversal of a payable or paid accrual — a NEW
-- negative row — is the recorded follow-up; `operation` and the unique key
-- already have room for it.)
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * EXACTLY-ONCE. `(tenant_id, source_type, source_ref, source_line,
--     employment_id, operation)` is UNIQUE: a double delivery, or two racing
--     deliveries, is one row. `employment_id` is in the key so one source line
--     can be split between staff and each accrues once.
--   * THE FACTS NEVER CHANGE. A BEFORE UPDATE trigger compares every column
--     outside the status/stamp set byte for byte; no row is ever deleted
--     (`awcms_app` holds no DELETE and a trigger refuses it for everyone).
--   * THE MACHINE IS THE DATA'S. Only the five transitions above exist, each
--     must stamp its own actor and time and touch no other stamp, and a VOIDED
--     accrual can never be paid (there is no edge out of `voided`, `paid` or
--     `reversed`). SEGREGATION OF DUTIES: the beneficiary can approve, release
--     or pay none of their own accrual, the creator cannot approve it and the
--     approver cannot pay it.
--   * A BIRTH IS VALIDATED AGAINST ITS PARENTS UNDER LOCK. The insert trigger
--     reads the rule and the employment `FOR SHARE`, so a rule retired or an
--     employment terminated/soft-deleted in a concurrent transaction waits for
--     this one (or this one sees the result): the rule must be PUBLISHED, its
--     window must contain `occurred_on`, its key, version, source type,
--     currency, calculation and snapshot terms must match, the amount must EQUAL
--     the rule's evaluation of the stored inputs (rounding mode, scale, floor and
--     ceiling), the event must be at most 730 days old, and the employment must
--     be live and employed on `occurred_on`.
--   * THE LOG CANNOT DIVERGE FROM THE STATUS. `awcms_hr_commission_transitions`
--     is written ONLY by triggers on the accrual (a direct insert is refused:
--     `pg_trigger_depth()`), once for the birth and once per status change, so
--     "status = the latest transition" holds by construction and a
--     reconciliation query can prove it. The log is append-only (no UPDATE or
--     DELETE privilege, and a trigger).
--
-- ## Money is exact
--
-- `numeric`, never a float, never NaN (explicit `<> 'NaN'` checks: a `numeric`
-- accepts NaN and NaN passes `>= 0`). The application computes the amount with
-- its exact `bigint` evaluation and the database RECOMPUTES it from the stored
-- inputs and the referenced rule version (`awcms_hr_commission_expected_amount`,
-- exact `numeric`) and refuses a mismatch.
--
-- ## Classification
--
-- CONFIDENTIAL — a person's earnings. The only person link is the employment
-- (an opaque id into `hr_workforce`) and actor stamps; no name, identifier,
-- contact, bank account or free text is stored. Every reference is a composite
-- `(tenant_id, ...)` foreign key. RLS ENABLE + FORCE with USING/WITH CHECK.
--
-- ## Payroll (phase 3) is designed for, not built (hr-payroll.md PS-19)
--
-- An accrual must be paid by exactly one run, including after a reversal. This
-- migration gives that its footing: `payable -> paid` happens once and `paid` is
-- terminal; a partial index serves the run's `FOR UPDATE SKIP LOCKED` selection
-- of payable accruals; and a reversal never re-opens its original (it is a NEW
-- row), so there is no state from which one accrual could be claimed twice. The
-- claim itself (run id, release on cancel) is #962's, because releasing a claim
-- depends on the recovery decision PS-02 has not made.

CREATE TABLE IF NOT EXISTS awcms_hr_commission_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The beneficiary: always an employment (hr-payroll.md 6.4). Affiliate and
  -- referral commission has an external beneficiary and is NOT here.
  employment_id uuid NOT NULL,
  -- The rule version applied (immutable once published) and its identity,
  -- snapshotted so the row is self-describing.
  rule_id uuid NOT NULL,
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  -- The source identity. Opaque to this module.
  source_type text NOT NULL,
  source_ref text NOT NULL,
  source_line text NOT NULL DEFAULT '',
  operation text NOT NULL DEFAULT 'accrue',
  -- The inputs and the rule's terms at accrual time (snapshot).
  calculation text NOT NULL,
  base_amount numeric(18, 6),
  units integer,
  rate numeric(9, 6),
  fixed_amount numeric(18, 6),
  amount numeric(18, 6) NOT NULL,
  currency_code char(3) NOT NULL,
  -- The instant of the source event, and the civil date the adapter derived from
  -- it (in whatever time its tenant keeps); the rule window is matched on the
  -- DATE. The two may differ by at most one day (any UTC offset).
  occurred_at timestamptz NOT NULL,
  occurred_on date NOT NULL,
  -- SHA-256 over the canonical request, so a replay with a DIFFERENT amount, rule
  -- key or date for the same source identity is a conflict and not a silent
  -- success. Not derived from any person's data.
  request_digest text NOT NULL,
  correlation_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  released_at timestamptz,
  released_by uuid,
  paid_at timestamptz,
  paid_by uuid,
  -- Where the payment is recorded (a payout batch, a payroll run id as text).
  payment_reference text,
  voided_at timestamptz,
  voided_by uuid,
  -- A CODE, never free text: free text about a person's pay does not belong here.
  void_reason_code text,
  CONSTRAINT awcms_hr_commission_accruals_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_source_key
    UNIQUE (tenant_id, source_type, source_ref, source_line, employment_id, operation),
  CONSTRAINT awcms_hr_commission_accruals_status_check
    CHECK (status IN ('pending', 'approved', 'payable', 'paid', 'voided')),
  CONSTRAINT awcms_hr_commission_accruals_operation_check
    CHECK (operation IN ('accrue')),
  CONSTRAINT awcms_hr_commission_accruals_rule_key_check
    CHECK (rule_key ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_accruals_rule_version_check
    CHECK (rule_version >= 1),
  CONSTRAINT awcms_hr_commission_accruals_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_accruals_source_ref_check
    CHECK (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  CONSTRAINT awcms_hr_commission_accruals_source_line_check
    CHECK (source_line ~ '^[A-Za-z0-9_.:-]{0,64}$'),
  CONSTRAINT awcms_hr_commission_accruals_calculation_check
    CHECK (calculation IN ('percent', 'fixed')),
  CONSTRAINT awcms_hr_commission_accruals_shape_check
    CHECK (
      (calculation = 'percent'
         AND base_amount IS NOT NULL AND rate IS NOT NULL
         AND units IS NULL AND fixed_amount IS NULL)
      OR
      (calculation = 'fixed'
         AND units IS NOT NULL AND fixed_amount IS NOT NULL
         AND base_amount IS NULL AND rate IS NULL)
    ),
  CONSTRAINT awcms_hr_commission_accruals_not_nan_check
    CHECK (
      amount <> 'NaN'
      AND (base_amount IS NULL OR base_amount <> 'NaN')
      AND (rate IS NULL OR rate <> 'NaN')
      AND (fixed_amount IS NULL OR fixed_amount <> 'NaN')
    ),
  CONSTRAINT awcms_hr_commission_accruals_range_check
    CHECK (
      amount >= 0 AND amount < 1000000000000
      AND (base_amount IS NULL OR (base_amount >= 0 AND base_amount < 1000000000000))
      AND (rate IS NULL OR (rate >= 0 AND rate <= 100))
      AND (fixed_amount IS NULL OR (fixed_amount >= 0 AND fixed_amount < 1000000000000))
      AND (units IS NULL OR (units >= 0 AND units <= 1000000))
    ),
  CONSTRAINT awcms_hr_commission_accruals_currency_check
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT awcms_hr_commission_accruals_digest_check
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_hr_commission_accruals_correlation_check
    CHECK (correlation_id IS NULL OR char_length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT awcms_hr_commission_accruals_occurred_check
    CHECK (abs(occurred_on - (occurred_at AT TIME ZONE 'UTC')::date) <= 1),
  CONSTRAINT awcms_hr_commission_accruals_payment_ref_check
    CHECK (payment_reference IS NULL OR payment_reference ~ '^[A-Za-z0-9_.:/-]{1,64}$'),
  CONSTRAINT awcms_hr_commission_accruals_void_reason_check
    CHECK (void_reason_code IS NULL OR void_reason_code ~ '^[a-z][a-z0-9_.-]{0,39}$'),
  -- The status and its stamps always agree: a stamp exists exactly when the
  -- accrual has passed through its transition, and `voided` is a branch of
  -- pending/approved, so a voided row never carries released/paid stamps.
  CONSTRAINT awcms_hr_commission_accruals_lifecycle_check
    CHECK (
      (status = 'pending'
         AND approved_at IS NULL AND approved_by IS NULL
         AND released_at IS NULL AND released_by IS NULL
         AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL
         AND voided_at IS NULL AND voided_by IS NULL AND void_reason_code IS NULL)
      OR (status = 'approved'
         AND approved_at IS NOT NULL AND approved_by IS NOT NULL
         AND released_at IS NULL AND released_by IS NULL
         AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL
         AND voided_at IS NULL AND voided_by IS NULL AND void_reason_code IS NULL)
      OR (status = 'payable'
         AND approved_at IS NOT NULL AND approved_by IS NOT NULL
         AND released_at IS NOT NULL AND released_by IS NOT NULL
         AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL
         AND voided_at IS NULL AND voided_by IS NULL AND void_reason_code IS NULL)
      OR (status = 'paid'
         AND approved_at IS NOT NULL AND approved_by IS NOT NULL
         AND released_at IS NOT NULL AND released_by IS NOT NULL
         AND paid_at IS NOT NULL AND paid_by IS NOT NULL
         AND voided_at IS NULL AND voided_by IS NULL AND void_reason_code IS NULL)
      OR (status = 'voided'
         AND voided_at IS NOT NULL AND voided_by IS NOT NULL
         AND released_at IS NULL AND released_by IS NULL
         AND paid_at IS NULL AND paid_by IS NULL AND payment_reference IS NULL)
    ),
  CONSTRAINT awcms_hr_commission_accruals_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_rule_fkey
    FOREIGN KEY (tenant_id, rule_id)
    REFERENCES awcms_hr_commission_rules (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_approved_by_fkey
    FOREIGN KEY (tenant_id, approved_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_released_by_fkey
    FOREIGN KEY (tenant_id, released_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_paid_by_fkey
    FOREIGN KEY (tenant_id, paid_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_accruals_voided_by_fkey
    FOREIGN KEY (tenant_id, voided_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Newest first, the admin listing.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_list_idx
  ON awcms_hr_commission_accruals (tenant_id, created_at DESC, id DESC);
-- A beneficiary's accruals (also serves the employment foreign key).
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_employment_idx
  ON awcms_hr_commission_accruals (tenant_id, employment_id, created_at DESC);
-- The rule foreign key.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_rule_idx
  ON awcms_hr_commission_accruals (tenant_id, rule_id);
-- The payroll run's selection of what it may pay (`FOR UPDATE SKIP LOCKED`), and
-- the per-status listing: only the rows that are still in motion.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_open_idx
  ON awcms_hr_commission_accruals (tenant_id, status, employment_id)
  WHERE status IN ('pending', 'approved', 'payable');
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_created_by_idx
  ON awcms_hr_commission_accruals (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_approved_by_idx
  ON awcms_hr_commission_accruals (tenant_id, approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_released_by_idx
  ON awcms_hr_commission_accruals (tenant_id, released_by) WHERE released_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_paid_by_idx
  ON awcms_hr_commission_accruals (tenant_id, paid_by) WHERE paid_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_accruals_voided_by_idx
  ON awcms_hr_commission_accruals (tenant_id, voided_by) WHERE voided_by IS NOT NULL;

ALTER TABLE awcms_hr_commission_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_accruals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_commission_accruals_tenant_isolation
  ON awcms_hr_commission_accruals
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No DELETE, ever: an accrual ends by being voided (or, later, reversed).
REVOKE DELETE, TRUNCATE ON awcms_hr_commission_accruals FROM awcms_app;

-- The transition log ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_commission_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Total order of the log; one accrual's rows are serialised by its row lock,
  -- so per accrual this is also the order the transitions happened in.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  accrual_id uuid NOT NULL,
  -- NULL only for the birth (-> pending).
  from_status text,
  to_status text NOT NULL,
  actor_tenant_user_id uuid,
  reason_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_hr_commission_transitions_tenant_id_key UNIQUE (tenant_id, id),
  -- Each state is entered at most once per accrual: the machine has no cycle.
  CONSTRAINT awcms_hr_commission_transitions_once_key
    UNIQUE (tenant_id, accrual_id, to_status),
  CONSTRAINT awcms_hr_commission_transitions_edge_check
    CHECK (
      (from_status IS NULL AND to_status = 'pending')
      OR (from_status = 'pending' AND to_status IN ('approved', 'voided'))
      OR (from_status = 'approved' AND to_status IN ('payable', 'voided'))
      OR (from_status = 'payable' AND to_status = 'paid')
    ),
  CONSTRAINT awcms_hr_commission_transitions_reason_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_.-]{0,39}$'),
  CONSTRAINT awcms_hr_commission_transitions_accrual_fkey
    FOREIGN KEY (tenant_id, accrual_id)
    REFERENCES awcms_hr_commission_accruals (tenant_id, id),
  CONSTRAINT awcms_hr_commission_transitions_actor_fkey
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_commission_transitions_accrual_idx
  ON awcms_hr_commission_transitions (tenant_id, accrual_id, seq);
CREATE INDEX IF NOT EXISTS awcms_hr_commission_transitions_actor_idx
  ON awcms_hr_commission_transitions (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_commission_transitions_created_idx
  ON awcms_hr_commission_transitions (tenant_id, occurred_at);

ALTER TABLE awcms_hr_commission_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_commission_transitions_tenant_isolation
  ON awcms_hr_commission_transitions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Append-only: a privilege AND (below) a trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_hr_commission_transitions FROM awcms_app;

-- Triggers --------------------------------------------------------------------
-- The BEGIN/END below are PL/pgSQL block delimiters inside dollar-quoted bodies,
-- NOT transaction control — the migration runner strips dollar-quoted blocks
-- before its transaction-control scan (scripts/db-migrate.ts).

-- The amount a rule version yields for an input: the SQL twin of the pure
-- `evaluateCommission` (`hr-commission-evaluation.ts`), exact in `numeric`,
-- rounded ONCE at the rule's mode and scale, then clamped to the floor/ceiling.
-- Inputs are non-negative (CHECK constraints), so the rounding modes are the
-- non-negative cases (`up`/`ceiling` and `down`/`floor` coincide). A test drives
-- both implementations over every mode and boundary and demands they agree.
CREATE OR REPLACE FUNCTION awcms_hr_commission_expected_amount(
  p_calculation text,
  p_base numeric,
  p_rate numeric,
  p_fixed numeric,
  p_units integer,
  p_mode text,
  p_scale integer,
  p_min numeric,
  p_max numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $awcms_hr_commission_expected$
DECLARE
  v_factor numeric := power(10::numeric, p_scale);
  v numeric;
  v_int numeric;
  v_frac numeric;
  v_rounded numeric;
BEGIN
  IF p_calculation = 'percent' THEN
    v := (p_base * p_rate) * v_factor / 100;
  ELSE
    v := (p_fixed * p_units) * v_factor;
  END IF;

  v_int := trunc(v);
  v_frac := v - v_int;
  v_rounded := v_int + CASE p_mode
    WHEN 'down' THEN 0
    WHEN 'floor' THEN 0
    WHEN 'up' THEN CASE WHEN v_frac > 0 THEN 1 ELSE 0 END
    WHEN 'ceiling' THEN CASE WHEN v_frac > 0 THEN 1 ELSE 0 END
    WHEN 'half_up' THEN CASE WHEN v_frac >= 0.5 THEN 1 ELSE 0 END
    WHEN 'half_down' THEN CASE WHEN v_frac > 0.5 THEN 1 ELSE 0 END
    WHEN 'half_even' THEN CASE
      WHEN v_frac > 0.5 THEN 1
      WHEN v_frac = 0.5 AND mod(v_int, 2) = 1 THEN 1
      ELSE 0 END
  END;
  v_rounded := v_rounded / v_factor;

  IF p_min IS NOT NULL AND v_rounded < p_min THEN
    v_rounded := p_min;
  END IF;

  IF p_max IS NOT NULL AND v_rounded > p_max THEN
    v_rounded := p_max;
  END IF;

  RETURN v_rounded;
END;
$awcms_hr_commission_expected$;

-- A birth is validated against its parents, under FOR SHARE.
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

  -- FOR SHARE: a concurrent retire/terminate/soft-delete UPDATE queues behind
  -- this transaction instead of slipping between the check and the insert.
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

  -- The stored amount IS the rule's evaluation of the stored inputs: a caller
  -- (or a bypassing session) cannot write a commission the rule does not yield.
  IF NEW.amount IS DISTINCT FROM awcms_hr_commission_expected_amount(
       v_rule.calculation, NEW.base_amount, v_rule.rate, v_rule.fixed_amount,
       NEW.units, v_rule.rounding_mode, v_rule.rounding_scale::integer,
       v_rule.min_amount, v_rule.max_amount) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals: the amount is not the rule''s evaluation of the inputs (Issue #951)'
      USING ERRCODE = '23514';
  END IF;

  -- A bounded event age (2 years): a sale this old is not a late delivery.
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

  RETURN NEW;
END;
$awcms_hr_commission_accrual_insert$;

CREATE TRIGGER awcms_hr_commission_accruals_born_valid
  BEFORE INSERT ON awcms_hr_commission_accruals
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_insert_guard();

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

  -- Segregation of duties. The beneficiary (the employment's own login) can
  -- perform none of approve, release or pay on their own accrual; whoever
  -- created an accrual cannot approve it; whoever approved it cannot pay it.
  -- `created_by` / `approved_by` are NULL for a system-created / unstamped row,
  -- and a NULL comparison constrains nothing (the handler refuses a NULL actor).
  SELECT tenant_user_id INTO v_beneficiary
  FROM awcms_hr_employments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.employment_id
  FOR SHARE;

  IF NEW.status = 'approved'
     AND (NEW.approved_by = v_beneficiary OR NEW.approved_by = NEW.created_by) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary or the creator cannot approve the accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'payable' AND NEW.released_by = v_beneficiary THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary cannot release their own accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'paid'
     AND (NEW.paid_by = v_beneficiary OR NEW.paid_by = NEW.approved_by) THEN
    RAISE EXCEPTION
      'awcms_hr_commission_accruals row %: the beneficiary or the approver cannot pay the accrual (Issue #951)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_accrual_guard$;

CREATE TRIGGER awcms_hr_commission_accruals_immutable
  BEFORE UPDATE OR DELETE ON awcms_hr_commission_accruals
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_guard();

-- The log is written ONLY by the accrual's own triggers: once at birth and once
-- per status change.
CREATE OR REPLACE FUNCTION awcms_hr_commission_accruals_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $awcms_hr_commission_accrual_log$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO awcms_hr_commission_transitions
      (tenant_id, accrual_id, from_status, to_status, actor_tenant_user_id)
    VALUES (NEW.tenant_id, NEW.id, NULL, 'pending', NEW.created_by);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO awcms_hr_commission_transitions
      (tenant_id, accrual_id, from_status, to_status, actor_tenant_user_id, reason_code)
    VALUES (
      NEW.tenant_id, NEW.id, OLD.status, NEW.status,
      CASE NEW.status
        WHEN 'approved' THEN NEW.approved_by
        WHEN 'payable' THEN NEW.released_by
        WHEN 'paid' THEN NEW.paid_by
        WHEN 'voided' THEN NEW.voided_by
      END,
      CASE WHEN NEW.status = 'voided' THEN NEW.void_reason_code END
    );
  END IF;

  RETURN NULL;
END;
$awcms_hr_commission_accrual_log$;

CREATE TRIGGER awcms_hr_commission_accruals_log_birth
  AFTER INSERT ON awcms_hr_commission_accruals
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_log();

CREATE TRIGGER awcms_hr_commission_accruals_log_change
  AFTER UPDATE ON awcms_hr_commission_accruals
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_log();

CREATE OR REPLACE FUNCTION awcms_hr_commission_transitions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $awcms_hr_commission_transition_guard$
DECLARE
  v_status text;
  v_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'awcms_hr_commission_transitions is append-only (Issue #951)'
      USING ERRCODE = '55000';
  END IF;

  -- Only the accrual's own trigger (depth 2: this one, nested in that one) may
  -- write the log, so it cannot say something the accrual did not do.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION
      'awcms_hr_commission_transitions is written only by the accrual ledger (Issue #951)'
      USING ERRCODE = '55000';
  END IF;

  SELECT status INTO v_status
  FROM awcms_hr_commission_accruals
  WHERE tenant_id = NEW.tenant_id AND id = NEW.accrual_id;

  SELECT to_status INTO v_previous
  FROM awcms_hr_commission_transitions
  WHERE tenant_id = NEW.tenant_id AND accrual_id = NEW.accrual_id
  ORDER BY seq DESC
  LIMIT 1;

  IF v_status IS DISTINCT FROM NEW.to_status
     OR v_previous IS DISTINCT FROM NEW.from_status THEN
    RAISE EXCEPTION
      'awcms_hr_commission_transitions: the row does not continue the accrual''s history (Issue #951)'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_transition_guard$;

CREATE TRIGGER awcms_hr_commission_transitions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON awcms_hr_commission_transitions
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_transitions_guard();

COMMENT ON TABLE awcms_hr_commission_accruals IS
  'Issue #951 / ADR-0132 — CONFIDENTIAL (a person''s earnings). The commission ledger: monetary facts immutable by trigger, only status and its stamps advance (pending -> approved -> payable -> paid, or voided from pending/approved), unique per source identity and employment, never deleted. References an employment, stores no name or identifier.';
COMMENT ON TABLE awcms_hr_commission_transitions IS
  'Issue #951 / ADR-0132 — CONFIDENTIAL. Append-only log of accrual status changes, written only by the accrual''s own triggers, so an accrual''s status always equals its latest transition.';
