-- `hr_workforce` phase 1 foundation — employment context (Issue #945,
-- ADR-0132, `docs/awcms/hr-payroll.md` sections 3 and 4.1).
--
-- ## The shape, in one paragraph
--
-- An EMPLOYMENT (`awcms_hr_employments`) is a stable header that REFERENCES a
-- `profile_identity` party (`profile_id`, a composite `(tenant_id, profile_id)`
-- foreign key to `awcms_profiles (tenant_id, id)`, the key sql/174 added) and
-- never copies it: there is NO name, contact, address, birth date, NIK or NPWP
-- column on any table here, and NO photo, biometric or device column either
-- (owner decision O6: never). Everything that CHANGES over time lives in
-- `awcms_hr_employment_terms`, an append-only, effective-dated history of office,
-- manager, job title, employment type and status. The tenant's own knobs live in
-- `awcms_hr_workforce_settings`.
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * ONE ACTIVE EMPLOYMENT PER PROFILE AND TENANT: a partial unique index over
--     live, non-terminated headers. Rehire is a NEW employment after the old one
--     is terminated.
--   * ONE ACTIVE EMPLOYMENT PER LOGIN: the same, over `tenant_user_id`, so the
--     self-service ownership rule ("this employment is mine") can never be
--     ambiguous.
--   * TERMS NEVER OVERLAP and are only ever APPENDED; the only permitted UPDATE
--     closes an open row (`effective_to`). History is never edited or deleted.
--   * TERMINATED IS TERMINAL: a `terminated` term stamps the header
--     (`terminated_on`), after which no further term can be written and the stamp
--     cannot be cleared.
--   * THE MANAGER CHAIN is acyclic and at most 10 edges deep INCLUDING the subtree
--     below the employee, and manager-edge writes are serialised per tenant.
--   * A PROFILE MERGE (`merged_into_profile_id`) between two profiles that both
--     carry an ACTIVE employment is refused (ADR-0132 section 2).
--
-- ## Classification
--
-- `awcms_hr_employments` and `awcms_hr_employment_terms` are CONFIDENTIAL (they
-- link a person to an employer and say where they work and under whom);
-- `awcms_hr_workforce_settings` is internal.
--
-- Every reference is a composite `(tenant_id, ...)` foreign key, so tenancy is
-- part of the constraint (sql/020) and RLS is not the only wall.
-- Every table: RLS ENABLE + FORCE with a USING/WITH CHECK policy.

-- 1. Tenant-wide settings -----------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_workforce_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- How far into the future a claimed event time may be before it is refused
  -- (consumed by the attendance issue that follows; configured here).
  clock_skew_seconds integer NOT NULL DEFAULT 300,
  -- The workflow_approval definition key a correction starts. No evidence,
  -- location or photo setting exists, by construction (O6).
  correction_workflow_key text NOT NULL DEFAULT 'hr.attendance_correction',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_hr_workforce_settings_skew_check
    CHECK (clock_skew_seconds BETWEEN 0 AND 3600),
  CONSTRAINT awcms_hr_workforce_settings_workflow_key_check
    CHECK (correction_workflow_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  CONSTRAINT awcms_hr_workforce_settings_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

ALTER TABLE awcms_hr_workforce_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_workforce_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_workforce_settings_tenant_isolation
  ON awcms_hr_workforce_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS awcms_hr_workforce_settings_updated_by_idx
  ON awcms_hr_workforce_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

REVOKE DELETE, TRUNCATE ON awcms_hr_workforce_settings FROM awcms_app;

-- 2. Employments --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_employments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The person. A REFERENCE to profile_identity, mandatory (an employee is a
  -- person), immutable once written.
  profile_id uuid NOT NULL,
  employee_no text NOT NULL,
  hired_on date NOT NULL,
  -- The login that IS this employee: the basis of "employee sees own"
  -- (ownership grant). Optional; setting or changing it is a high-risk `assign`.
  tenant_user_id uuid,
  -- Stamped by the terms trigger when a `terminated` term is appended; never
  -- cleared. NULL = the employment has not ended.
  terminated_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_hr_employments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_employments_employee_no_check
    CHECK (employee_no ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$'),
  CONSTRAINT awcms_hr_employments_terminated_check
    CHECK (terminated_on IS NULL OR terminated_on >= hired_on),
  CONSTRAINT awcms_hr_employments_delete_reason_len
    CHECK (delete_reason IS NULL OR char_length(delete_reason) <= 500),
  CONSTRAINT awcms_hr_employments_profile_fkey
    FOREIGN KEY (tenant_id, profile_id)
    REFERENCES awcms_profiles (tenant_id, id),
  CONSTRAINT awcms_hr_employments_tenant_user_fkey
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_employments_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_employments_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_employments_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_employments_restored_by_fkey
    FOREIGN KEY (tenant_id, restored_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Employee numbers are unique among LIVE rows (ADR/doc 4.1); a soft-deleted
-- employment frees its number, and restoring one that collides is a 409.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_employments_employee_no_key
  ON awcms_hr_employments (tenant_id, lower(employee_no))
  WHERE deleted_at IS NULL;

-- ONE ACTIVE EMPLOYMENT per profile and tenant, and per login.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_employments_one_active_per_profile
  ON awcms_hr_employments (tenant_id, profile_id)
  WHERE deleted_at IS NULL AND terminated_on IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_employments_one_active_per_user
  ON awcms_hr_employments (tenant_id, tenant_user_id)
  WHERE tenant_user_id IS NOT NULL
    AND deleted_at IS NULL AND terminated_on IS NULL;

CREATE INDEX IF NOT EXISTS awcms_hr_employments_list_idx
  ON awcms_hr_employments (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_employments_profile_idx
  ON awcms_hr_employments (tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS awcms_hr_employments_created_by_idx
  ON awcms_hr_employments (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employments_updated_by_idx
  ON awcms_hr_employments (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employments_deleted_by_idx
  ON awcms_hr_employments (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employments_restored_by_idx
  ON awcms_hr_employments (tenant_id, restored_by) WHERE restored_by IS NOT NULL;

ALTER TABLE awcms_hr_employments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_employments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_employments_tenant_isolation
  ON awcms_hr_employments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No DELETE, ever: an employment ends by a `terminated` term, or is soft-deleted
-- when it was entered by mistake.
REVOKE DELETE, TRUNCATE ON awcms_hr_employments FROM awcms_app;

-- 3. Employment terms (effective-dated, append-only) -------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_employment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  employment_id uuid NOT NULL,
  -- The office tree IS the organisational unit and the `office` business scope.
  office_id uuid,
  manager_employment_id uuid,
  -- Descriptive text, never a scope. Not a place for personal data.
  job_title text,
  employment_type text NOT NULL,
  status text NOT NULL,
  effective_from date NOT NULL,
  -- Exclusive end; NULL = the current row.
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_hr_employment_terms_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_employment_terms_from_key
    UNIQUE (tenant_id, employment_id, effective_from),
  CONSTRAINT awcms_hr_employment_terms_type_check
    CHECK (employment_type IN ('permanent', 'fixed_term', 'part_time', 'casual')),
  CONSTRAINT awcms_hr_employment_terms_status_check
    CHECK (status IN ('active', 'on_leave', 'suspended', 'terminated')),
  CONSTRAINT awcms_hr_employment_terms_title_len
    CHECK (job_title IS NULL OR char_length(job_title) BETWEEN 1 AND 120),
  CONSTRAINT awcms_hr_employment_terms_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- A terminated row is terminal, so it stays open-ended.
  CONSTRAINT awcms_hr_employment_terms_terminated_open
    CHECK (status <> 'terminated' OR effective_to IS NULL),
  CONSTRAINT awcms_hr_employment_terms_not_own_manager
    CHECK (manager_employment_id IS NULL OR manager_employment_id <> employment_id),
  CONSTRAINT awcms_hr_employment_terms_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_employment_terms_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_hr_employment_terms_manager_fkey
    FOREIGN KEY (tenant_id, manager_employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_employment_terms_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_hr_employment_terms_employment_idx
  ON awcms_hr_employment_terms (tenant_id, employment_id, effective_from DESC);
-- At most ONE open (current) row per employment.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_employment_terms_one_current
  ON awcms_hr_employment_terms (tenant_id, employment_id)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employment_terms_office_idx
  ON awcms_hr_employment_terms (tenant_id, office_id) WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employment_terms_manager_idx
  ON awcms_hr_employment_terms (tenant_id, manager_employment_id)
  WHERE manager_employment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_employment_terms_created_by_idx
  ON awcms_hr_employment_terms (tenant_id, created_by) WHERE created_by IS NOT NULL;

ALTER TABLE awcms_hr_employment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_employment_terms FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_employment_terms_tenant_isolation
  ON awcms_hr_employment_terms
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_hr_employment_terms FROM awcms_app;

-- 4. Guards ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_hr_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'awcms_hr: % is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER awcms_hr_employment_terms_no_delete
  BEFORE DELETE ON awcms_hr_employment_terms
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_employments_no_delete
  BEFORE DELETE ON awcms_hr_employments
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- Header: the person and the tenant never change; terminated is terminal.
CREATE OR REPLACE FUNCTION awcms_hr_guard_employment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.profile_id <> OLD.profile_id THEN
    RAISE EXCEPTION
      'awcms_hr: an employment''s identity and person cannot change; create a new employment (rehire)'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.terminated_on IS NOT NULL
     AND NEW.terminated_on IS DISTINCT FROM OLD.terminated_on THEN
    RAISE EXCEPTION 'awcms_hr: terminated is terminal for an employment'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_employments_update_guard
  BEFORE UPDATE ON awcms_hr_employments
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_employment_update();

-- The manager-chain rule, in ONE place so the trigger and the application's
-- pre-check cannot drift. Returns 'cycle', 'depth' or NULL.
--
--   * CYCLE: walking up from `p_manager` reaches `p_employment`.
--   * DEPTH: the longest reporting path through the employee, in edges, is
--     (nodes from the manager up to the root) + (height of the subtree BELOW
--     the employee), and must be at most 10. Counting only the upward half let a
--     manager be added ABOVE an already-full chain.
--
-- CONCURRENCY: the walk reads committed rows, so two transactions that each add
-- one edge of a cycle (A under B, B under A) would both see an acyclic chain
-- and both commit. Every writer of a manager edge therefore takes ONE
-- transaction-scoped advisory lock per tenant before it walks, and holds it to
-- commit; the loser re-reads, under READ COMMITTED, the winner's committed edge
-- and is refused. It lives here (not only in the handler) so it holds for ANY
-- writer, including a maintenance session. Edges are written rarely, so a
-- tenant-wide lock costs nothing that matters.
CREATE OR REPLACE FUNCTION awcms_hr_manager_chain_problem(
  p_tenant uuid, p_employment uuid, p_manager uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  walker uuid := p_manager;
  up_nodes integer := 0;
  down_edges integer := 0;
BEGIN
  IF p_manager IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hr_manager_chain:' || p_tenant::text, 0)
  );

  WHILE walker IS NOT NULL LOOP
    IF p_employment IS NOT NULL AND walker = p_employment THEN
      RETURN 'cycle';
    END IF;

    up_nodes := up_nodes + 1;

    IF up_nodes > 10 THEN
      RETURN 'depth';
    END IF;

    SELECT t.manager_employment_id INTO walker
      FROM awcms_hr_employment_terms t
     WHERE t.tenant_id = p_tenant
       AND t.employment_id = walker
       AND t.effective_to IS NULL;
  END LOOP;

  IF p_employment IS NOT NULL THEN
    WITH RECURSIVE sub(id, d) AS (
      SELECT p_employment, 0
      UNION ALL
      SELECT t.employment_id, sub.d + 1
        FROM sub
        JOIN awcms_hr_employment_terms t
          ON t.tenant_id = p_tenant
         AND t.manager_employment_id = sub.id
         AND t.effective_to IS NULL
       WHERE sub.d < 12
    )
    SELECT COALESCE(max(d), 0) INTO down_edges FROM sub;
  END IF;

  IF up_nodes + down_edges > 10 THEN
    RETURN 'depth';
  END IF;

  RETURN NULL;
END;
$$;

-- Terms, BEFORE INSERT: no term on a deleted or terminated employment, no
-- overlap, and an acyclic, bounded manager chain.
CREATE OR REPLACE FUNCTION awcms_hr_guard_term_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header awcms_hr_employments%ROWTYPE;
  problem text;
BEGIN
  SELECT * INTO header FROM awcms_hr_employments
   WHERE tenant_id = NEW.tenant_id AND id = NEW.employment_id;

  IF header.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_DELETED' USING ERRCODE = '55000';
  END IF;

  IF header.terminated_on IS NOT NULL THEN
    RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_TERMINATED' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM awcms_hr_employment_terms t
     WHERE t.tenant_id = NEW.tenant_id
       AND t.employment_id = NEW.employment_id
       AND NEW.effective_from < COALESCE(t.effective_to, 'infinity'::date)
       AND t.effective_from < COALESCE(NEW.effective_to, 'infinity'::date)
  ) THEN
    RAISE EXCEPTION 'awcms_hr: HR_TERMS_OVERLAP' USING ERRCODE = '23P01';
  END IF;

  problem := awcms_hr_manager_chain_problem(
    NEW.tenant_id, NEW.employment_id, NEW.manager_employment_id
  );

  IF problem = 'cycle' THEN
    RAISE EXCEPTION 'awcms_hr: HR_MANAGER_CYCLE' USING ERRCODE = '23514';
  ELSIF problem = 'depth' THEN
    RAISE EXCEPTION 'awcms_hr: HR_MANAGER_DEPTH' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_employment_terms_insert_guard
  BEFORE INSERT ON awcms_hr_employment_terms
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_term_insert();

-- Terms, AFTER INSERT: a `terminated` term stamps the header.
CREATE OR REPLACE FUNCTION awcms_hr_stamp_termination()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'terminated' THEN
    UPDATE awcms_hr_employments
       SET terminated_on = NEW.effective_from, updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND id = NEW.employment_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER awcms_hr_employment_terms_stamp_termination
  AFTER INSERT ON awcms_hr_employment_terms
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_stamp_termination();

-- Terms, BEFORE UPDATE: the ONLY edit is closing the open row.
CREATE OR REPLACE FUNCTION awcms_hr_guard_term_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.effective_to IS NOT NULL
     OR NEW.effective_to IS NULL
     OR (to_jsonb(NEW) - 'effective_to') <> (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION
      'awcms_hr: employment terms are append-only; the only edit is closing the open row'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_employment_terms_update_guard
  BEFORE UPDATE ON awcms_hr_employment_terms
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_term_update();

-- Profile merge guard (ADR-0132 section 2): one person must not end up with two
-- ACTIVE employments. Fires only when `merged_into_profile_id` is being set.
CREATE OR REPLACE FUNCTION awcms_hr_guard_profile_merge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.merged_into_profile_id IS NOT NULL
     AND NEW.merged_into_profile_id IS DISTINCT FROM OLD.merged_into_profile_id
     AND EXISTS (
       SELECT 1 FROM awcms_hr_employments e
        WHERE e.tenant_id = NEW.tenant_id AND e.profile_id = NEW.id
          AND e.deleted_at IS NULL AND e.terminated_on IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM awcms_hr_employments e
        WHERE e.tenant_id = NEW.tenant_id
          AND e.profile_id = NEW.merged_into_profile_id
          AND e.deleted_at IS NULL AND e.terminated_on IS NULL
     ) THEN
    RAISE EXCEPTION 'awcms_hr: HR_MERGE_BOTH_EMPLOYED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_profiles_merge_guard
  BEFORE UPDATE OF merged_into_profile_id ON awcms_profiles
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_profile_merge();

COMMENT ON TABLE awcms_hr_employments IS
  'Issue #945 / ADR-0132 — CONFIDENTIAL. Employment header referencing a profile_identity party by composite FK; never copies name/contact/national id; never a photo, biometric or device column. One active employment per profile and per login (partial unique indexes). Never deleted.';
COMMENT ON TABLE awcms_hr_employment_terms IS
  'Issue #945 / ADR-0132 — CONFIDENTIAL. Effective-dated, append-only office/manager/title/type/status history; terms never overlap; the only UPDATE closes the open row; terminated is terminal.';
COMMENT ON TABLE awcms_hr_workforce_settings IS
  'Issue #945 / ADR-0132 — internal. One row per tenant: clock skew bound and the correction workflow key. No evidence setting exists (O6).';
