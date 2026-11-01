-- `hr_commission` intake queue (Issue #1189, ADR-0147; `docs/awcms/hr-payroll.md`
-- section 6.4).
--
-- ## The problem this solves
--
-- An event-driven consumer (the commerce `order.paid` attributor of a derived
-- repository) runs in `domain-events:dispatch` as `awcms_worker`. To post a
-- commission through `CommissionAccrualPort` it would need SELECT, INSERT and
-- column UPDATE on the accrual ledger, and `FOR SHARE` on rules and employments:
-- exactly the privileges the payroll boundary (Issue #1015, #1077) forbids the
-- worker, because an accrual IS one employee's earnings. So there was no
-- sanctioned way for such a consumer to accrue or void.
--
-- ## The shape (ADR-0147 sections 1-4)
--
-- A consumer does not post. It SUBMITS an intake record; a job that runs as
-- `awcms_app` (`hr-commission:intents:post`) claims the rows and posts them
-- through the ONE existing posting core. This migration is the table and the
-- privileges; the port, the poster and the job are application code.
--
--   * `awcms_hr_commission_intents` - one row per submitted request. NOT a
--     payroll-family relation (its name matches no `FORBIDDEN_PAYROLL_TABLE_
--     PATTERNS` pattern, deliberately): it is a transient queue, not the ledger.
--   * `awcms_hr_commission_intake_settings` - the per-tenant switch
--     `commission_intake_enabled` (default FALSE).
--
-- ## What the worker can and cannot do (the load-bearing part)
--
--   * `awcms_worker` holds INSERT on the intents table and NOTHING else on it:
--     no SELECT, UPDATE or DELETE. It cannot read back what it submitted or how
--     it was settled, and it holds no privilege on any payroll-family object.
--     The insert is a bare `INSERT ... ON CONFLICT DO NOTHING` (no conflict
--     target, so PostgreSQL reads no arbiter and SELECT is not needed).
--   * `awcms_worker` holds a COLUMN-level SELECT on the settings table, on
--     (tenant_id, commission_intake_enabled) only: one boolean per tenant, which
--     the port and the insert trigger read. It cannot read the system actor or
--     the stamps. It is not payroll data.
--   * The worker's claim about WHO acted is not trusted. The row stores it as
--     `claimed_by_tenant_user_id`, an attribute for the exceptions trail only;
--     the poster stamps the ledger and the audit with the tenant's configured
--     intake system actor (`intake_actor_tenant_user_id`, set with the switch by
--     the high-risk `hr_commission.intake.configure`). A void is posted only for
--     an accrual that this intake itself created (application rule in the
--     poster), so a compromised worker cannot void a manually created accrual.
--   * A BEFORE INSERT trigger makes a row born `pending` with no attempts and no
--     outcome whoever inserts it, and refuses the insert while the tenant's
--     switch is off (defence in depth behind the port's `disabled` answer).
--   * The columns that decide a posting carry CHECK constraints that follow the
--     alphabets and lengths of the ledger's validators (the validators remain the
--     authority; the CHECKs are a second wall against a value the poster would
--     have to interpret, not a promise of identical acceptance).
--
-- ## Idempotency
--
-- The unique key `(tenant_id, kind, source_type, source_ref, source_line,
-- employment_id, request_digest)`: a redelivery of the SAME request is one row
-- (`duplicate`); the same identity with a DIFFERENT request is a second row and
-- surfaces at posting as the ledger's own `source_conflict` instead of being
-- swallowed here. The digest is the ledger's canonical digest for an accrual.
--
-- ## Lifecycle
--
--     pending --claim--> posting --post--> posted | refused | failed
--                          \--retry--> pending (next_attempt_at pushed out)
--
-- `next_attempt_at` is also the lease: a `posting` row whose lease has lapsed
-- (the poster crashed) is claimable again. The guard trigger allows exactly
-- these edges, freezes the identity of a request, and freezes a terminal row.
-- DELETE is allowed for a terminal row only (the retention purge); a pending or
-- posting row is work and can never be deleted.
--
-- ## Retention
--
-- Terminal rows are purged by the poster job (the `delegated` data-lifecycle
-- form, `updated_at` cursor). `posted` rows go after 30 days (floor 7, ceiling
-- 90); `refused` and `failed` rows, which a human may still need to read, are
-- kept for the 90-day ceiling. The worker
-- cannot read the table, so the lifecycle engine's dry-run snapshot goes through
-- the count-only SECURITY DEFINER function below (the sql/303 pattern).
--
-- ## Classification
--
-- CONFIDENTIAL. A row carries a sale's base amount and an employment id for the
-- retention window: derived earnings data. Audit rows and logs carry codes and
-- ids only, never an amount. RLS ENABLE + FORCE with USING / WITH CHECK.
--
-- Applied migrations are immutable; this file is new.

CREATE TABLE IF NOT EXISTS awcms_hr_commission_intake_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- The per-tenant switch (ADR-0147 section 4). Default-deny: no row, or FALSE,
  -- means `submit*` answers `disabled` and the poster claims nothing.
  commission_intake_enabled boolean NOT NULL DEFAULT false,
  -- The system actor the poster stamps on the ledger and the audit for every
  -- request it posts (the worker's own claim is never trusted). Required while
  -- the switch is on.
  intake_actor_tenant_user_id uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_hr_commission_intake_settings_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_intake_settings_actor_fk
    FOREIGN KEY (tenant_id, intake_actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_intake_settings_actor_required_check
    CHECK (NOT commission_intake_enabled OR intake_actor_tenant_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS awcms_hr_commission_intake_settings_actor_idx
  ON awcms_hr_commission_intake_settings (tenant_id, intake_actor_tenant_user_id)
  WHERE intake_actor_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_hr_commission_intake_settings_updated_by_idx
  ON awcms_hr_commission_intake_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

ALTER TABLE awcms_hr_commission_intake_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_intake_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_commission_intake_settings_tenant_isolation
  ON awcms_hr_commission_intake_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The switch is upserted, never deleted.
REVOKE DELETE, TRUNCATE ON awcms_hr_commission_intake_settings FROM awcms_app;
REVOKE ALL ON awcms_hr_commission_intake_settings FROM awcms_worker;
-- Column-level: the port and the insert trigger read exactly these two columns.
GRANT SELECT (tenant_id, commission_intake_enabled)
  ON awcms_hr_commission_intake_settings TO awcms_worker;

COMMENT ON TABLE awcms_hr_commission_intake_settings IS
  'Issue #1189 / ADR-0147 -- one row per tenant: commission_intake_enabled (default false) and the system actor the poster stamps. Changed only by the high-risk hr_commission.intake.configure permission, audited at warning. Holds no pay data.';

-- The intake queue ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_commission_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  kind text NOT NULL,
  -- The source identity, opaque to this module (same alphabet as the ledger).
  source_type text NOT NULL,
  source_ref text NOT NULL,
  source_line text NOT NULL DEFAULT '',
  employment_id uuid NOT NULL,
  -- The request fields `CommissionAccrualPort.accrue` takes. NULL for a void.
  rule_key text,
  base_amount numeric(18, 6),
  units integer,
  currency_code char(3),
  occurred_at timestamptz,
  occurred_on date,
  -- `void` only: a short CODE, never free text.
  reason text,
  -- `void`: the person who voided the sale (required). `accrue`: optional, a
  -- system accrual has none.
  claimed_by_tenant_user_id uuid,
  correlation_id text,
  -- SHA-256 of the canonical request (the ledger's digest for an accrual).
  request_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  -- HOW it settled: a short lower-case code (`accrued`, `replayed`,
  -- `source_conflict`, `period_closed`, `error`, ...). Never an amount.
  outcome_code text,
  attempts integer NOT NULL DEFAULT 0,
  -- When a pending row becomes claimable; for a `posting` row, the lease expiry.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_hr_commission_intents_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_commission_intents_identity_key
    UNIQUE (tenant_id, kind, source_type, source_ref, source_line,
            employment_id, request_digest),
  CONSTRAINT awcms_hr_commission_intents_employment_fk
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_commission_intents_actor_fk
    FOREIGN KEY (tenant_id, claimed_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_commission_intents_kind_check
    CHECK (kind IN ('accrue', 'void')),
  CONSTRAINT awcms_hr_commission_intents_status_check
    CHECK (status IN ('pending', 'posting', 'posted', 'refused', 'failed')),
  CONSTRAINT awcms_hr_commission_intents_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_intents_source_ref_check
    CHECK (source_ref ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  CONSTRAINT awcms_hr_commission_intents_source_line_check
    CHECK (source_line ~ '^[A-Za-z0-9_.:-]{0,64}$'),
  CONSTRAINT awcms_hr_commission_intents_rule_key_check
    CHECK (rule_key IS NULL OR rule_key ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  CONSTRAINT awcms_hr_commission_intents_currency_check
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT awcms_hr_commission_intents_reason_check
    CHECK (reason IS NULL OR reason ~ '^[a-z][a-z0-9_.-]{0,39}$'),
  CONSTRAINT awcms_hr_commission_intents_digest_check
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_hr_commission_intents_correlation_check
    CHECK (correlation_id IS NULL OR correlation_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  CONSTRAINT awcms_hr_commission_intents_outcome_check
    CHECK (outcome_code IS NULL OR outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT awcms_hr_commission_intents_attempts_check
    CHECK (attempts BETWEEN 0 AND 1000),
  -- No NaN: a numeric accepts it and NaN passes >= 0.
  CONSTRAINT awcms_hr_commission_intents_base_amount_check
    CHECK (base_amount IS NULL OR (base_amount <> 'NaN'::numeric AND base_amount >= 0)),
  CONSTRAINT awcms_hr_commission_intents_units_check
    CHECK (units IS NULL OR units >= 0),
  -- An accrue carries exactly one of base_amount / units and the sale's
  -- instants; a void carries none of them but a reason and a person.
  CONSTRAINT awcms_hr_commission_intents_shape_check
    CHECK (
      (kind = 'accrue'
        AND rule_key IS NOT NULL
        AND currency_code IS NOT NULL
        AND occurred_at IS NOT NULL
        AND occurred_on IS NOT NULL
        AND reason IS NULL
        AND ((base_amount IS NULL) <> (units IS NULL)))
      OR
      (kind = 'void'
        AND reason IS NOT NULL
        AND claimed_by_tenant_user_id IS NOT NULL
        AND rule_key IS NULL
        AND base_amount IS NULL
        AND units IS NULL
        AND currency_code IS NULL
        AND occurred_at IS NULL
        AND occurred_on IS NULL)
    ),
  -- A terminal row says how it ended; a live one does not.
  CONSTRAINT awcms_hr_commission_intents_outcome_status_check
    CHECK ((status IN ('posted', 'refused', 'failed')) = (outcome_code IS NOT NULL))
);

-- The poster's claim: live rows that are due (or whose lease lapsed).
CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_claim_idx
  ON awcms_hr_commission_intents (tenant_id, next_attempt_at, created_at)
  WHERE status IN ('pending', 'posting');
-- The exceptions list and the retention purge walk terminal rows by updated_at.
CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_exceptions_idx
  ON awcms_hr_commission_intents (tenant_id, updated_at DESC, id DESC)
  WHERE status IN ('refused', 'failed');
CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_retention_idx
  ON awcms_hr_commission_intents (tenant_id, updated_at)
  WHERE status IN ('posted', 'refused', 'failed');
CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_employment_idx
  ON awcms_hr_commission_intents (tenant_id, employment_id);
CREATE INDEX IF NOT EXISTS awcms_hr_commission_intents_actor_idx
  ON awcms_hr_commission_intents (tenant_id, claimed_by_tenant_user_id)
  WHERE claimed_by_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_hr_commission_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_commission_intents FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_commission_intents_tenant_isolation
  ON awcms_hr_commission_intents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Born pending, switch on ----------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_hr_commission_intents_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Whoever inserts (the worker, the app, an operator), a row is born pending
  -- with no history: the poster is the only thing that moves it on.
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.attempts IS DISTINCT FROM 0
     OR NEW.outcome_code IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_hr_commission: an intake row is born pending, with no attempts and no outcome'
      USING ERRCODE = '55000';
  END IF;

  NEW.next_attempt_at := now();
  NEW.created_at := now();
  NEW.updated_at := now();

  -- Default-deny behind the port's `disabled` answer: with the switch off (or
  -- never set) nothing is written, whoever tries.
  IF NOT EXISTS (
    SELECT 1
    FROM awcms_hr_commission_intake_settings AS s
    WHERE s.tenant_id = NEW.tenant_id AND s.commission_intake_enabled
  ) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: commission intake is not enabled for this tenant'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_commission_intents_guard_insert
  BEFORE INSERT ON awcms_hr_commission_intents
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_intents_guard_insert();

-- The state machine ----------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_hr_commission_intents_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The request never changes once submitted.
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

  -- A settled row is history.
  IF OLD.status IN ('posted', 'refused', 'failed') THEN
    RAISE EXCEPTION
      'awcms_hr_commission: intake row % is %, and a settled row does not change',
      OLD.id, OLD.status
      USING ERRCODE = '55000';
  END IF;

  -- The edges: pending -> posting (claim); posting -> posting (re-claim after
  -- a lapsed lease); posting -> pending (retry); posting -> posted | refused |
  -- failed (settle). Nothing else.
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

  -- Attempts never go down, except that a DEFERRAL (posting -> pending: a void
  -- waiting for the accrual it reverses) gives its one claim back, so waiting
  -- does not burn the retry budget meant for errors.
  IF NEW.attempts < OLD.attempts
     AND NOT (NEW.status = 'pending' AND NEW.attempts = OLD.attempts - 1) THEN
    RAISE EXCEPTION
      'awcms_hr_commission: attempts of intake row % never go down', OLD.id
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_commission_intents_guard_update
  BEFORE UPDATE ON awcms_hr_commission_intents
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_intents_guard_update();

-- Only a settled row may be removed (the retention purge).
CREATE OR REPLACE FUNCTION awcms_hr_commission_intents_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status NOT IN ('posted', 'refused', 'failed') THEN
    RAISE EXCEPTION
      'awcms_hr_commission: intake row % is still work (%) and cannot be deleted',
      OLD.id, OLD.status
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER awcms_hr_commission_intents_guard_delete
  BEFORE DELETE ON awcms_hr_commission_intents
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_intents_guard_delete();

-- Privileges -----------------------------------------------------------------
-- The runtime role (the poster and any request-path caller of the port) keeps
-- the default verbs; TRUNCATE is withheld. The worker gets INSERT and NOTHING
-- else (ADR-0147 section 1).
REVOKE TRUNCATE ON awcms_hr_commission_intents FROM awcms_app;
REVOKE ALL ON awcms_hr_commission_intents FROM awcms_worker;
GRANT INSERT ON awcms_hr_commission_intents TO awcms_worker;

COMMENT ON TABLE awcms_hr_commission_intents IS
  'Issue #1189 / ADR-0147 -- intake queue for event-driven commission accruals and voids. One row per submitted request; awcms_worker may only INSERT (no SELECT/UPDATE/DELETE), the awcms_app job hr-commission:intents:post claims and posts through the one existing posting core. Derived earnings data (a base amount and an employment id) for the retention window; not a payroll-family relation.';

-- Retention backlog (count-only) ---------------------------------------------
-- The data-lifecycle engine records a dry-run backlog snapshot for every
-- delegated descriptor as `awcms_worker`, which may not read this table. Same
-- safeguards as sql/303: a NOLOGIN memberless owner with COLUMN-level SELECT on
-- (tenant_id, updated_at), static SQL, one integer returned, search_path pinned,
-- EXECUTE for the worker only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_hr_commission_lifecycle_counter'
  ) THEN
    CREATE ROLE awcms_hr_commission_lifecycle_counter
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_hr_commission_lifecycle_counter
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_hr_commission_lifecycle_counter;
GRANT SELECT (tenant_id, updated_at)
  ON awcms_hr_commission_intents TO awcms_hr_commission_lifecycle_counter;
GRANT SELECT (tenant_id, created_at)
  ON awcms_hr_commission_intake_settings TO awcms_hr_commission_lifecycle_counter;

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
    WHERE x.tenant_id = p_tenant_id AND x.updated_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_commission_intake_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_commission_intake_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_hr_commission_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) IS
  'Issue #1189 / ADR-0147. Count-only retention-backlog read for the hr_commission intake descriptor: how many rows of the named table (awcms_hr_commission_intents by updated_at, awcms_hr_commission_intake_settings by created_at; anything else raises 22023) belong to the tenant and were last updated before the cutoff. Returns one integer, never a row. The owner role holds column-level SELECT on (tenant_id, updated_at) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_hr_commission_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_hr_commission_lifecycle_counter;
