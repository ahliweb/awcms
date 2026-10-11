-- `hr_workforce` shifts — templates and assignments (Issue #946, ADR-0132,
-- `docs/awcms/hr-payroll.md` section 4.4). The schedule the generic
-- `StaffAvailabilityPort` reads.
--
-- ## The shape, in one paragraph
--
-- A SHIFT TEMPLATE (`awcms_hr_shift_templates`) is a pattern: a local start time,
-- a duration in minutes, an optional single break, an IANA zone. A SHIFT
-- ASSIGNMENT (`awcms_hr_shift_assignments`) is one concrete interval for one
-- employment, stored as UTC instants `[starts_at, ends_at)` (half-open). Putting
-- a template on a local date RESOLVES the wall clock to UTC once, in the
-- application, and stores the result together with the zone it was resolved in,
-- so editing a template (or a zone rule) later never moves an assignment that
-- exists. An overnight shift is an interval that crosses midnight, not a
-- date-keyed row. Time off is an assignment of kind `time_off` with a COARSE
-- category and NO reason column: sick leave is health data, so there is no
-- free-text column on an assignment at all.
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * NO OVERLAP per employment among assignments that are not cancelled, across
--     kinds (work over time off conflicts). A trigger takes a transaction-scoped
--     advisory lock keyed on (tenant, employment) BEFORE it looks, so two
--     concurrent writers serialise and the second sees the first's committed row
--     (READ COMMITTED re-reads on the next statement). A GiST exclusion
--     constraint would be tighter but needs the `btree_gist` extension and a
--     privileged `CREATE EXTENSION`; sql/171 records the same decision for tax
--     rule versions and no migration in this repo asks for the extension.
--   * STATUS ONLY MOVES FORWARD: draft -> published -> cancelled, or draft ->
--     cancelled. `cancelled` is terminal; a published or cancelled assignment's
--     interval, break, kind, zone, office and template can no longer change.
--     A new row is always inserted as `draft`.
--   * NOTHING IS DELETED: awcms_app is denied DELETE and a trigger rejects it. A
--     published assignment is cancelled, never deleted.
--   * SHAPE: `ends_at > starts_at`, a work shift of 15 minutes to 24 hours, time off of
--     at most 31 days, a single break strictly inside a work interval, whole
--     minutes only (so a millisecond-precision client can never disagree with
--     the database), a time-off category only on time off.
--   * NO ASSIGNMENT ON A DELETED EMPLOYMENT, and an invalid zone name is refused
--     (checked against `pg_timezone_names`).
--
-- ## Time zones and daylight saving
--
-- The zone on a row is a SNAPSHOT (an IANA name). Instants are UTC, so a shift
-- that spans a clock change simply has its true elapsed length; resolving a
-- template onto a local date that falls in a gap or an overlap is decided in
-- application code and tested (earlier occurrence on overlap; the pre-change
-- offset on a gap).
--
-- ## Classification
--
-- Templates are internal (a pattern, no person). Assignments are CONFIDENTIAL:
-- they say when a person works and when they are away.
--
-- Every reference is a composite `(tenant_id, ...)` foreign key. Every table: RLS
-- ENABLE + FORCE with a USING/WITH CHECK policy.

-- 1. Shift templates ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  name text NOT NULL,
  -- Local wall-clock start, whole minutes. Meaningful only with `time_zone`.
  local_start time NOT NULL,
  -- ELAPSED minutes (the end is start + duration, whatever the wall clock does).
  duration_minutes integer NOT NULL,
  -- Optional single break: minutes after the start, and how long it lasts.
  break_offset_minutes integer,
  break_minutes integer,
  time_zone text NOT NULL,
  office_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT awcms_hr_shift_templates_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_shift_templates_code_check
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$'),
  CONSTRAINT awcms_hr_shift_templates_name_check
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT awcms_hr_shift_templates_start_check
    CHECK (extract(second FROM local_start) = 0),
  CONSTRAINT awcms_hr_shift_templates_duration_check
    CHECK (duration_minutes BETWEEN 15 AND 1440),
  CONSTRAINT awcms_hr_shift_templates_break_pair_check
    CHECK ((break_offset_minutes IS NULL) = (break_minutes IS NULL)),
  CONSTRAINT awcms_hr_shift_templates_break_range_check
    CHECK (
      break_minutes IS NULL
      OR (break_offset_minutes >= 0
          AND break_minutes >= 1
          AND break_offset_minutes + break_minutes <= duration_minutes)
    ),
  CONSTRAINT awcms_hr_shift_templates_zone_check
    CHECK (time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  CONSTRAINT awcms_hr_shift_templates_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_hr_shift_templates_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_shift_templates_updated_by_fkey
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_shift_templates_deleted_by_fkey
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Codes are unique among LIVE templates; a soft-deleted one frees its code.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_shift_templates_code_key
  ON awcms_hr_shift_templates (tenant_id, lower(code))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_templates_list_idx
  ON awcms_hr_shift_templates (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_shift_templates_office_idx
  ON awcms_hr_shift_templates (tenant_id, office_id) WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_templates_created_by_idx
  ON awcms_hr_shift_templates (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_templates_updated_by_idx
  ON awcms_hr_shift_templates (tenant_id, updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_templates_deleted_by_idx
  ON awcms_hr_shift_templates (tenant_id, deleted_by) WHERE deleted_by IS NOT NULL;

ALTER TABLE awcms_hr_shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_shift_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_shift_templates_tenant_isolation
  ON awcms_hr_shift_templates
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_hr_shift_templates FROM awcms_app;

-- 2. Shift assignments ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  employment_id uuid NOT NULL,
  -- Provenance only: the instants below are authoritative and never recomputed.
  template_id uuid,
  kind text NOT NULL,
  -- A coarse category, never a reason. Required for time off, absent for work.
  time_off_kind text,
  -- UTC, half-open [starts_at, ends_at), whole minutes.
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Optional single break inside a work interval.
  break_starts_at timestamptz,
  break_ends_at timestamptz,
  -- IANA zone the interval was resolved in (a snapshot, never re-resolved).
  time_zone text NOT NULL,
  office_id uuid,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  published_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_hr_shift_assignments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_kind_check
    CHECK (kind IN ('work', 'time_off')),
  CONSTRAINT awcms_hr_shift_assignments_time_off_kind_check
    CHECK (
      (kind = 'work' AND time_off_kind IS NULL)
      OR (kind = 'time_off' AND time_off_kind IN ('leave', 'holiday', 'other'))
    ),
  CONSTRAINT awcms_hr_shift_assignments_status_check
    CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT awcms_hr_shift_assignments_range_check
    CHECK (ends_at > starts_at),
  CONSTRAINT awcms_hr_shift_assignments_length_check
    CHECK (
      (kind = 'work'
       AND ends_at - starts_at >= interval '15 minutes'
       AND ends_at - starts_at <= interval '24 hours')
      OR (kind = 'time_off' AND ends_at - starts_at <= interval '31 days')
    ),
  CONSTRAINT awcms_hr_shift_assignments_whole_minutes_check
    CHECK (
      extract(second FROM starts_at) = 0
      AND extract(second FROM ends_at) = 0
      AND (break_starts_at IS NULL OR extract(second FROM break_starts_at) = 0)
      AND (break_ends_at IS NULL OR extract(second FROM break_ends_at) = 0)
    ),
  CONSTRAINT awcms_hr_shift_assignments_break_check
    CHECK (
      (break_starts_at IS NULL AND break_ends_at IS NULL)
      OR (kind = 'work'
          AND break_starts_at IS NOT NULL
          AND break_ends_at IS NOT NULL
          AND break_ends_at > break_starts_at
          AND break_starts_at >= starts_at
          AND break_ends_at <= ends_at)
    ),
  CONSTRAINT awcms_hr_shift_assignments_zone_check
    CHECK (time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  CONSTRAINT awcms_hr_shift_assignments_lifecycle_check
    CHECK (
      (status = 'draft' AND published_at IS NULL AND cancelled_at IS NULL)
      OR (status = 'published' AND published_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    ),
  CONSTRAINT awcms_hr_shift_assignments_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_template_fkey
    FOREIGN KEY (tenant_id, template_id)
    REFERENCES awcms_hr_shift_templates (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_published_by_fkey
    FOREIGN KEY (tenant_id, published_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_cancelled_by_fkey
    FOREIGN KEY (tenant_id, cancelled_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_shift_assignments_created_by_fkey
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- The overlap guard and the availability read both walk one employment's live
-- intervals in time order.
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_employment_time_idx
  ON awcms_hr_shift_assignments (tenant_id, employment_id, starts_at, ends_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_published_window_idx
  ON awcms_hr_shift_assignments (tenant_id, starts_at, ends_at)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_list_idx
  ON awcms_hr_shift_assignments (tenant_id, starts_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_template_idx
  ON awcms_hr_shift_assignments (tenant_id, template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_office_idx
  ON awcms_hr_shift_assignments (tenant_id, office_id) WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_published_by_idx
  ON awcms_hr_shift_assignments (tenant_id, published_by) WHERE published_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_cancelled_by_idx
  ON awcms_hr_shift_assignments (tenant_id, cancelled_by) WHERE cancelled_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_shift_assignments_created_by_idx
  ON awcms_hr_shift_assignments (tenant_id, created_by) WHERE created_by IS NOT NULL;

ALTER TABLE awcms_hr_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_shift_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_shift_assignments_tenant_isolation
  ON awcms_hr_shift_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_hr_shift_assignments FROM awcms_app;

-- 3. Guards -----------------------------------------------------------------------
-- (`awcms_hr_reject_mutation` is defined in sql/176.)
CREATE TRIGGER awcms_hr_shift_templates_no_delete
  BEFORE DELETE ON awcms_hr_shift_templates
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_shift_assignments_no_delete
  BEFORE DELETE ON awcms_hr_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- An IANA zone the database knows. `AT TIME ZONE` would also accept POSIX-style
-- strings and abbreviations; a schedule needs a real zone with real history.
CREATE OR REPLACE FUNCTION awcms_hr_assert_time_zone(p_zone text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_zone) THEN
    RAISE EXCEPTION 'awcms_hr: HR_UNKNOWN_TIME_ZONE' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION awcms_hr_guard_shift_template()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN
    PERFORM awcms_hr_assert_time_zone(NEW.time_zone);
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
          OR lower(NEW.code) <> lower(OLD.code)) THEN
    RAISE EXCEPTION 'awcms_hr: a shift template''s identity and code cannot change'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_shift_templates_guard
  BEFORE INSERT OR UPDATE ON awcms_hr_shift_templates
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_shift_template();

-- The per-employment schedule lock. ONE function so the trigger and the
-- application's pre-check take the SAME lock key and cannot drift. Held to the
-- end of the transaction; re-entrant within it.
CREATE OR REPLACE FUNCTION awcms_hr_lock_employment_schedule(
  p_tenant uuid, p_employment uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hr_shift:' || p_tenant::text || ':' || p_employment::text, 0)
  );
END;
$$;

-- The overlap rule, in ONE place: the id of another non-cancelled assignment of
-- the same employment that overlaps [p_start, p_end), or NULL. Half-open, across
-- kinds. Callers lock first.
CREATE OR REPLACE FUNCTION awcms_hr_shift_conflict(
  p_tenant uuid, p_employment uuid, p_id uuid,
  p_start timestamptz, p_end timestamptz
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id
    FROM awcms_hr_shift_assignments a
   WHERE a.tenant_id = p_tenant
     AND a.employment_id = p_employment
     AND a.status <> 'cancelled'
     AND a.id <> p_id
     AND a.starts_at < p_end
     AND p_start < a.ends_at
   ORDER BY a.starts_at, a.id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION awcms_hr_guard_shift_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  header_deleted timestamptz;
  conflict uuid;
BEGIN
  -- The overlap rule rests on READ COMMITTED: after the advisory lock is
  -- granted, the next statement must see the previous holder's committed row.
  -- Under REPEATABLE READ / SERIALIZABLE the snapshot predates the lock and two
  -- writers could both pass, so the guard refuses rather than assume.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'awcms_hr: shift writes require READ COMMITTED isolation'
      USING ERRCODE = '25000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'awcms_hr: a shift assignment is created as a draft'
        USING ERRCODE = '55000';
    END IF;

    PERFORM awcms_hr_assert_time_zone(NEW.time_zone);
  ELSE
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.employment_id <> OLD.employment_id THEN
      RAISE EXCEPTION 'awcms_hr: a shift assignment''s identity and employment cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF NOT (
      OLD.status = NEW.status
      OR (OLD.status = 'draft' AND NEW.status IN ('published', 'cancelled'))
      OR (OLD.status = 'published' AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'awcms_hr: HR_SHIFT_BAD_TRANSITION' USING ERRCODE = '55000';
    END IF;

    IF OLD.status <> 'draft'
       AND (NEW.kind, NEW.time_off_kind, NEW.starts_at, NEW.ends_at,
            NEW.break_starts_at, NEW.break_ends_at, NEW.time_zone,
            NEW.office_id, NEW.template_id, NEW.created_at, NEW.created_by)
           IS DISTINCT FROM
           (OLD.kind, OLD.time_off_kind, OLD.starts_at, OLD.ends_at,
            OLD.break_starts_at, OLD.break_ends_at, OLD.time_zone,
            OLD.office_id, OLD.template_id, OLD.created_at, OLD.created_by) THEN
      RAISE EXCEPTION 'awcms_hr: a published or cancelled shift assignment is immutable'
        USING ERRCODE = '55000';
    END IF;

    -- The lifecycle stamps are evidence of who did what and when: once written
    -- they never change (a stamp may only be set by the transition itself).
    IF OLD.published_at IS NOT NULL
       AND (NEW.published_at IS DISTINCT FROM OLD.published_at
            OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
      RAISE EXCEPTION 'awcms_hr: publish stamps are immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.cancelled_at IS NOT NULL
       AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
            OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by) THEN
      RAISE EXCEPTION 'awcms_hr: cancel stamps are immutable' USING ERRCODE = '55000';
    END IF;

    IF NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN
      PERFORM awcms_hr_assert_time_zone(NEW.time_zone);
    END IF;

    -- Transitions set exactly their own stamps and leave the others alone.
    IF OLD.status = 'draft' AND NEW.status = 'published'
       AND (NEW.published_at IS NULL
            OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL) THEN
      RAISE EXCEPTION 'awcms_hr: publishing sets the publish stamps and nothing else'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled'
       AND (NEW.cancelled_at IS NULL
            OR NEW.published_at IS DISTINCT FROM OLD.published_at
            OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
      RAISE EXCEPTION 'awcms_hr: cancelling sets the cancel stamps and keeps the publish stamps'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- No schedule on a deleted employment (a new row, or a publish).
  IF TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status = 'published') THEN
    SELECT e.deleted_at INTO header_deleted
      FROM awcms_hr_employments e
     WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employment_id;

    IF header_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_DELETED' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Overlap: only a row that stays live, and only when it is new or its
  -- interval moved. Lock first, so a concurrent writer is serialised and the
  -- conflict read below sees its committed row.
  IF NEW.status <> 'cancelled'
     AND (TG_OP = 'INSERT'
          OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
          OR NEW.ends_at IS DISTINCT FROM OLD.ends_at) THEN
    PERFORM awcms_hr_lock_employment_schedule(NEW.tenant_id, NEW.employment_id);

    conflict := awcms_hr_shift_conflict(
      NEW.tenant_id, NEW.employment_id, NEW.id, NEW.starts_at, NEW.ends_at
    );

    IF conflict IS NOT NULL THEN
      RAISE EXCEPTION 'awcms_hr: HR_SHIFT_CONFLICT %', conflict
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_shift_assignments_guard
  BEFORE INSERT OR UPDATE ON awcms_hr_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_shift_assignment();

COMMENT ON TABLE awcms_hr_shift_templates IS
  'Issue #946 / ADR-0132 — internal. A shift PATTERN (local start, elapsed duration, optional break, IANA zone). Soft-deleted, never removed; editing one never moves an existing assignment.';
COMMENT ON TABLE awcms_hr_shift_assignments IS
  'Issue #946 / ADR-0132 — CONFIDENTIAL. One UTC half-open interval per employment, kind work or time_off (coarse category, never a reason). No overlap among non-cancelled rows per employment (advisory-lock trigger); status only moves forward; published/cancelled rows are immutable; never deleted. Read by StaffAvailabilityPort, published rows only.';
