-- `hr_workforce` attendance — append-only events and corrections with approval
-- (Issue #947, ADR-0132, `docs/awcms/hr-payroll.md` sections 4.2 and 13).
--
-- ## The shape, in one paragraph
--
-- An ATTENDANCE EVENT (`awcms_hr_attendance_events`) is one fact: this employment
-- clocked in / out / started a break / ended a break, at this claimed instant,
-- recorded by the database at that instant, from this source. Events are NEVER
-- edited and NEVER deleted. A CORRECTION (`awcms_hr_attendance_corrections`) is a
-- PROPOSED change: it adds an event, or replaces one, with a mandatory reason, and
-- it starts a `workflow_approval` instance. Approval appends a NEW event that
-- `supersedes` the old one; the effective record is "events not superseded". The
-- correction row only ever changes its STATUS.
--
-- There is NO location, coordinate, photo, device or network column anywhere
-- here (owner decision O6, ADR-0138). Location evidence, when it is built (Issue
-- #970), is a SEPARATE append-only table keyed to an event id; it never becomes
-- a column of the event, so it can be purged without touching the record that
-- payroll may rely on.
--
-- ## What the database enforces, so a bug or a maintenance session cannot
--
--   * APPEND-ONLY: awcms_app holds no UPDATE, DELETE or TRUNCATE on the events
--     table (privilege) and a trigger refuses both (second layer).
--   * THE SERVER CLOCK: `recorded_at` is overwritten with `clock_timestamp()`
--     by a trigger, so a client can never supply it. A claimed `occurred_at`
--     more than the tenant's clock-skew bound (`awcms_hr_workforce_settings`,
--     default 300 s) in the FUTURE is refused for every source.
--   * BACK-DATING: a `self` or `supervisor` event claims "now", so an
--     `occurred_at` older than the same skew bound is refused (it needs an
--     approved correction). A `kiosk` or `import` event is a replayed offline
--     queue, so a stale `occurred_at` is ACCEPTED up to 7 days and FLAGGED `late`
--     when more than 15 minutes old; older than 7 days is refused. `late` is set
--     by the trigger, never by the client.
--   * REPLAY: `(tenant_id, employment_id, client_event_key)` is unique, so a
--     replayed queue records each event once.
--   * A CORRECTION NEVER EDITS THE ORIGINAL, and a `correction`-sourced event can
--     only be written for an APPROVED correction, with exactly the kind, instant,
--     employment and target that was approved, once (unique per correction).
--     An event can be superseded at most once (unique per target).
--   * A CORRECTION'S STATUS FOLLOWS THE WORKFLOW VERDICT: it can become
--     `approved` only when its `workflow_approval` instance is `approved`, the
--     recorded approver actually made an approving decision, and the REQUESTER
--     made none (neither directly nor as the delegator whose standing a delegate
--     used). `rejected` needs a `rejected` instance, `withdrawn` a `cancelled`
--     one. `approved` also needs the superseding event to exist by commit (a
--     deferred constraint trigger), so approval and application cannot part.
--   * SEGREGATION OF DUTIES: on an approved row `decided_by` is neither the
--     requester nor the employee the correction is ABOUT (`subject_tenant_user_id`,
--     the login linked at request time, stamped by the trigger): a CHECK
--     constraint. The trigger repeats it against the workflow's own decision rows
--     (directly or on behalf of), for the snapshot AND the login linked now.
--     There is no transitive manager-chain exclusion.
--   * NO CLOCKING ON A DELETED EMPLOYMENT, and none on a TERMINATED one (only an
--     approved correction may still touch a terminated employment's history).
--
-- ## Classification
--
-- Events are CONFIDENTIAL (behavioural data: when a person works). Corrections are
-- CONFIDENTIAL and the `reason` column is SENSITIVE (it may say "I was ill"): it
-- never rides in an audit row, a domain event, a log or the workflow store
-- (no facts are passed to the instance), and a response carries it only to the
-- requester, a workflow assignee, or a holder of `corrections.read`.
--
-- Every reference is a composite `(tenant_id, ...)` foreign key. Every table: RLS
-- ENABLE + FORCE with a USING/WITH CHECK policy.

-- 1. Events ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  employment_id uuid NOT NULL,
  kind text NOT NULL,
  -- The CLAIMED instant (UTC). Bounded by the guard below.
  occurred_at timestamptz NOT NULL,
  -- The DATABASE's clock at insert; the guard overwrites whatever is supplied.
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL,
  -- The device's / queue's own idempotency key for this event.
  client_event_key text NOT NULL,
  office_id uuid,
  -- The event this one replaces (only an approved correction writes one).
  supersedes_event_id uuid,
  -- Set exactly when `source = 'correction'`.
  correction_id uuid,
  -- Stamped by the guard: an offline replay whose claimed time is stale.
  late boolean NOT NULL DEFAULT false,
  recorded_by uuid,
  CONSTRAINT awcms_hr_attendance_events_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_events_client_key
    UNIQUE (tenant_id, employment_id, client_event_key),
  CONSTRAINT awcms_hr_attendance_events_kind_check
    CHECK (kind IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  CONSTRAINT awcms_hr_attendance_events_source_check
    CHECK (source IN ('self', 'supervisor', 'kiosk', 'import', 'correction')),
  CONSTRAINT awcms_hr_attendance_events_client_key_check
    CHECK (client_event_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  CONSTRAINT awcms_hr_attendance_events_correction_check
    CHECK ((source = 'correction') = (correction_id IS NOT NULL)),
  CONSTRAINT awcms_hr_attendance_events_not_self_superseding
    CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  CONSTRAINT awcms_hr_attendance_events_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_events_office_fkey
    FOREIGN KEY (tenant_id, office_id)
    REFERENCES awcms_offices (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_events_supersedes_fkey
    FOREIGN KEY (tenant_id, supersedes_event_id)
    REFERENCES awcms_hr_attendance_events (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_events_recorded_by_fkey
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- An event is superseded AT MOST ONCE, and a correction writes AT MOST ONE event.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_attendance_events_one_superseder
  ON awcms_hr_attendance_events (tenant_id, supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_attendance_events_one_per_correction
  ON awcms_hr_attendance_events (tenant_id, correction_id)
  WHERE correction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_hr_attendance_events_list_idx
  ON awcms_hr_attendance_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_events_employment_idx
  ON awcms_hr_attendance_events (tenant_id, employment_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_events_office_idx
  ON awcms_hr_attendance_events (tenant_id, office_id) WHERE office_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_events_recorded_by_idx
  ON awcms_hr_attendance_events (tenant_id, recorded_by) WHERE recorded_by IS NOT NULL;

ALTER TABLE awcms_hr_attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_attendance_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_attendance_events_tenant_isolation
  ON awcms_hr_attendance_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Append-only, by privilege AND by trigger (below).
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_hr_attendance_events FROM awcms_app;

-- 2. Corrections -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_hr_attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  employment_id uuid NOT NULL,
  -- `add`: a missing event. `replace`: supersedes `target_event_id`.
  kind text NOT NULL,
  target_event_id uuid,
  -- The event that would be appended on approval.
  proposed_kind text NOT NULL,
  proposed_occurred_at timestamptz NOT NULL,
  -- SENSITIVE: may describe health or family circumstances. Never audited,
  -- never in an event, never in the workflow store; see the header.
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  -- The `workflow_approval` instance. Single-column FK: the instance table has
  -- no (tenant_id, id) key; the guard checks the tenant, resource and requester.
  workflow_instance_id uuid NOT NULL REFERENCES awcms_workflow_instances (id),
  requested_by uuid NOT NULL,
  -- The login linked to the employment AT REQUEST TIME (NULL when it had none),
  -- stamped by the guard trigger and never supplied by a writer: the person the
  -- correction is ABOUT may not approve it either (segregation of duties covers
  -- the subject, not only the requester). A snapshot, so a re-link between the
  -- request and the settle does not shed the exclusion; the guard also checks the
  -- employment's CURRENT login.
  subject_tenant_user_id uuid,
  -- The approver (approved), the rejecter (rejected) or whoever ended the
  -- instance (withdrawn). NULL while pending.
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_hr_attendance_corrections_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_corrections_kind_check
    CHECK (kind IN ('add', 'replace')),
  CONSTRAINT awcms_hr_attendance_corrections_target_check
    CHECK ((kind = 'replace') = (target_event_id IS NOT NULL)),
  CONSTRAINT awcms_hr_attendance_corrections_proposed_kind_check
    CHECK (proposed_kind IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  CONSTRAINT awcms_hr_attendance_corrections_reason_check
    CHECK (char_length(reason) BETWEEN 1 AND 500 AND btrim(reason) <> ''),
  CONSTRAINT awcms_hr_attendance_corrections_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT awcms_hr_attendance_corrections_lifecycle_check
    CHECK (
      (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
  -- SEGREGATION OF DUTIES, in the data: neither the requester nor the person the
  -- correction is about is the approver.
  CONSTRAINT awcms_hr_attendance_corrections_sod_check
    CHECK (status <> 'approved'
           OR (decided_by <> requested_by
               AND (subject_tenant_user_id IS NULL
                    OR decided_by <> subject_tenant_user_id))),
  CONSTRAINT awcms_hr_attendance_corrections_employment_fkey
    FOREIGN KEY (tenant_id, employment_id)
    REFERENCES awcms_hr_employments (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_corrections_target_fkey
    FOREIGN KEY (tenant_id, target_event_id)
    REFERENCES awcms_hr_attendance_events (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_corrections_requested_by_fkey
    FOREIGN KEY (tenant_id, requested_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_corrections_subject_fkey
    FOREIGN KEY (tenant_id, subject_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_hr_attendance_corrections_decided_by_fkey
    FOREIGN KEY (tenant_id, decided_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- One workflow instance per correction, and at most ONE pending correction per
-- target event (two concurrent requests cannot both replace the same event).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_instance_key
  ON awcms_hr_attendance_corrections (workflow_instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_one_pending_target
  ON awcms_hr_attendance_corrections (tenant_id, target_event_id)
  WHERE target_event_id IS NOT NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_list_idx
  ON awcms_hr_attendance_corrections (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_employment_idx
  ON awcms_hr_attendance_corrections (tenant_id, employment_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_target_idx
  ON awcms_hr_attendance_corrections (tenant_id, target_event_id)
  WHERE target_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_requested_by_idx
  ON awcms_hr_attendance_corrections (tenant_id, requested_by);
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_subject_idx
  ON awcms_hr_attendance_corrections (tenant_id, subject_tenant_user_id)
  WHERE subject_tenant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_hr_attendance_corrections_decided_by_idx
  ON awcms_hr_attendance_corrections (tenant_id, decided_by) WHERE decided_by IS NOT NULL;

ALTER TABLE awcms_hr_attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_hr_attendance_corrections FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_hr_attendance_corrections_tenant_isolation
  ON awcms_hr_attendance_corrections
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_hr_attendance_corrections FROM awcms_app;

-- The event -> correction link closes the cycle (events reference corrections,
-- corrections reference events), so it is added once both tables exist.
ALTER TABLE awcms_hr_attendance_events
  ADD CONSTRAINT awcms_hr_attendance_events_correction_fkey
  FOREIGN KEY (tenant_id, correction_id)
  REFERENCES awcms_hr_attendance_corrections (tenant_id, id);

-- 3. Guards ------------------------------------------------------------------------
-- (`awcms_hr_reject_mutation` is defined in sql/176.)
CREATE TRIGGER awcms_hr_attendance_events_no_update
  BEFORE UPDATE ON awcms_hr_attendance_events
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_attendance_events_no_delete
  BEFORE DELETE ON awcms_hr_attendance_events
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();
CREATE TRIGGER awcms_hr_attendance_corrections_no_delete
  BEFORE DELETE ON awcms_hr_attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_reject_mutation();

-- Events, BEFORE INSERT: the server clock, the skew and back-dating bounds, the
-- employment's state, the supersession target and the approved-correction gate.
CREATE OR REPLACE FUNCTION awcms_hr_guard_attendance_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  header_deleted timestamptz;
  header_terminated date;
  header_found boolean;
  skew integer;
  target_employment uuid;
  corr_status text;
  corr_employment uuid;
  corr_kind text;
  corr_occurred timestamptz;
  corr_target uuid;
BEGIN
  -- The database's own clock. Whatever the caller supplied is discarded.
  NEW.recorded_at := clock_timestamp();

  -- The parent row is locked FOR SHARE, so a concurrent delete or termination
  -- of the employment serialises with this insert instead of racing it.
  SELECT e.deleted_at, e.terminated_on, true
    INTO header_deleted, header_terminated, header_found
    FROM awcms_hr_employments e
   WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employment_id
   FOR SHARE;

  IF header_found IS TRUE THEN
    IF header_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_DELETED' USING ERRCODE = '55000';
    END IF;

    IF header_terminated IS NOT NULL AND NEW.source <> 'correction' THEN
      RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_TERMINATED' USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT s.clock_skew_seconds INTO skew
    FROM awcms_hr_workforce_settings s
   WHERE s.tenant_id = NEW.tenant_id;
  skew := COALESCE(skew, 300);

  IF NEW.occurred_at > NEW.recorded_at + make_interval(secs => skew) THEN
    RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_FUTURE' USING ERRCODE = '23514';
  END IF;

  NEW.late := false;

  IF NEW.source IN ('self', 'supervisor') THEN
    IF NEW.occurred_at < NEW.recorded_at - make_interval(secs => skew) THEN
      RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_BACKDATED' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source IN ('kiosk', 'import') THEN
    IF NEW.occurred_at < NEW.recorded_at - interval '7 days' THEN
      RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_TOO_OLD' USING ERRCODE = '23514';
    END IF;

    NEW.late := NEW.occurred_at < NEW.recorded_at - interval '15 minutes';
  END IF;

  IF NEW.supersedes_event_id IS NOT NULL THEN
    SELECT ev.employment_id INTO target_employment
      FROM awcms_hr_attendance_events ev
     WHERE ev.tenant_id = NEW.tenant_id AND ev.id = NEW.supersedes_event_id;

    IF target_employment IS DISTINCT FROM NEW.employment_id THEN
      RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_SUPERSEDE_MISMATCH' USING ERRCODE = '23514';
    END IF;

    -- Only an approved correction replaces an event.
    IF NEW.source <> 'correction' THEN
      RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_SUPERSEDE_FORBIDDEN' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.source = 'correction' THEN
    SELECT c.status, c.employment_id, c.proposed_kind, c.proposed_occurred_at,
           c.target_event_id
      INTO corr_status, corr_employment, corr_kind, corr_occurred, corr_target
      FROM awcms_hr_attendance_corrections c
     WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.correction_id
     FOR SHARE;

    IF corr_status IS DISTINCT FROM 'approved'
       OR corr_employment <> NEW.employment_id
       OR corr_kind <> NEW.kind
       OR corr_occurred <> NEW.occurred_at
       OR corr_target IS DISTINCT FROM NEW.supersedes_event_id THEN
      RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_CORRECTION_NOT_APPROVED' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_attendance_events_guard
  BEFORE INSERT ON awcms_hr_attendance_events
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_attendance_event();

-- Corrections, BEFORE INSERT OR UPDATE: the workflow binding, the status machine
-- (pending is the only state with an exit) and the verdict-following rule.
CREATE OR REPLACE FUNCTION awcms_hr_guard_attendance_correction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  header_deleted timestamptz;
  header_found boolean;
  header_login uuid;
  current_login uuid;
  target_employment uuid;
  inst_tenant uuid;
  inst_type text;
  inst_resource text;
  inst_requester uuid;
  inst_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'awcms_hr: a correction is created pending' USING ERRCODE = '55000';
    END IF;

    SELECT e.deleted_at, e.tenant_user_id, true
      INTO header_deleted, header_login, header_found
      FROM awcms_hr_employments e
     WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employment_id
     FOR SHARE;

    IF header_found IS TRUE AND header_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'awcms_hr: HR_EMPLOYMENT_DELETED' USING ERRCODE = '55000';
    END IF;

    -- The subject's login is stamped HERE; whatever the writer supplied is discarded.
    NEW.subject_tenant_user_id := header_login;

    IF NEW.target_event_id IS NOT NULL THEN
      SELECT ev.employment_id INTO target_employment
        FROM awcms_hr_attendance_events ev
       WHERE ev.tenant_id = NEW.tenant_id AND ev.id = NEW.target_event_id;

      IF target_employment IS DISTINCT FROM NEW.employment_id THEN
        RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_TARGET_MISMATCH' USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT i.tenant_id, i.resource_type, i.resource_id,
           i.requested_by_tenant_user_id
      INTO inst_tenant, inst_type, inst_resource, inst_requester
      FROM awcms_workflow_instances i
     WHERE i.id = NEW.workflow_instance_id
     FOR SHARE;

    IF inst_tenant IS DISTINCT FROM NEW.tenant_id
       OR inst_type IS DISTINCT FROM 'hr_attendance_correction'
       OR inst_resource IS DISTINCT FROM NEW.id::text
       OR inst_requester IS DISTINCT FROM NEW.requested_by THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_BAD_WORKFLOW' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: only a status move out of `pending`, plus its stamps.
  IF (NEW.id, NEW.tenant_id, NEW.employment_id, NEW.kind, NEW.target_event_id,
      NEW.proposed_kind, NEW.proposed_occurred_at, NEW.reason,
      NEW.workflow_instance_id, NEW.requested_by, NEW.subject_tenant_user_id,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.employment_id, OLD.kind, OLD.target_event_id,
      OLD.proposed_kind, OLD.proposed_occurred_at, OLD.reason,
      OLD.workflow_instance_id, OLD.requested_by, OLD.subject_tenant_user_id,
      OLD.created_at) THEN
    RAISE EXCEPTION 'awcms_hr: a correction''s proposal is immutable; only its status moves'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_NOT_PENDING' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'awcms_hr: a correction update must move its status' USING ERRCODE = '55000';
  END IF;

  -- The status follows the workflow engine's verdict, never a handler's say-so.
  SELECT i.status INTO inst_status
    FROM awcms_workflow_instances i
   WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.workflow_instance_id
   FOR SHARE;

  IF NEW.status = 'approved' THEN
    IF inst_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_VERDICT_MISMATCH' USING ERRCODE = '23514';
    END IF;

    -- The recorded approver made an approving decision ...
    IF NOT EXISTS (
      SELECT 1
        FROM awcms_workflow_decisions d
        JOIN awcms_workflow_tasks t
          ON t.tenant_id = d.tenant_id AND t.id = d.workflow_task_id
       WHERE d.tenant_id = NEW.tenant_id
         AND t.workflow_instance_id = NEW.workflow_instance_id
         AND d.decision IN ('approve', 'force_approve')
         AND d.decided_by_tenant_user_id = NEW.decided_by
    ) THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_NO_APPROVER' USING ERRCODE = '23514';
    END IF;

    -- ... and neither the requester NOR THE PERSON THE CORRECTION IS ABOUT made
    -- one, directly or as the delegator whose standing a delegate used (the
    -- workflow engine's own self-approval guard compares only the acting user).
    -- The subject is the login linked when it was requested AND the login linked
    -- now, so a re-link in between does not shed the exclusion.
    SELECT e.tenant_user_id INTO current_login
      FROM awcms_hr_employments e
     WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employment_id;

    IF NEW.decided_by IN (NEW.requested_by, NEW.subject_tenant_user_id, current_login)
       OR EXISTS (
      SELECT 1
        FROM awcms_workflow_decisions d
        JOIN awcms_workflow_tasks t
          ON t.tenant_id = d.tenant_id AND t.id = d.workflow_task_id
       WHERE d.tenant_id = NEW.tenant_id
         AND t.workflow_instance_id = NEW.workflow_instance_id
         AND d.decision IN ('approve', 'force_approve')
         AND (d.decided_by_tenant_user_id IN
                (NEW.requested_by, NEW.subject_tenant_user_id, current_login)
              OR d.on_behalf_of_tenant_user_id IN
                (NEW.requested_by, NEW.subject_tenant_user_id, current_login))
    ) THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_SELF_APPROVAL' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'rejected' THEN
    IF inst_status IS DISTINCT FROM 'rejected' THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_VERDICT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'withdrawn' THEN
    IF inst_status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_VERDICT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_hr_attendance_corrections_guard
  BEFORE INSERT OR UPDATE ON awcms_hr_attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_attendance_correction();

-- Corrections, deferred: an `approved` correction must have its superseding event
-- by COMMIT, so the approval and its application cannot part.
CREATE OR REPLACE FUNCTION awcms_hr_assert_correction_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND NOT EXISTS (
    SELECT 1 FROM awcms_hr_attendance_events ev
     WHERE ev.tenant_id = NEW.tenant_id AND ev.correction_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'awcms_hr: HR_CORRECTION_NOT_APPLIED' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER awcms_hr_attendance_corrections_applied
  AFTER INSERT OR UPDATE ON awcms_hr_attendance_corrections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_assert_correction_applied();

-- 4. The manager chain, downwards --------------------------------------------------
-- The LIVE employments that report to `p_manager` directly or transitively, by the
-- CURRENT (open) terms. Bounded: the chain trigger of sql/176 caps a chain at ten
-- edges, and the recursion stops at ten levels regardless. A soft-deleted
-- employment is NEITHER returned NOR walked through, so the people below a
-- deleted manager are not visible to the manager above it until HR rewrites their
-- terms (fail closed; the dangling-manager posture of sql/176, README L6).
CREATE OR REPLACE FUNCTION awcms_hr_report_ids(p_tenant uuid, p_manager uuid)
RETURNS TABLE (employment_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE reports(id, depth) AS (
    SELECT t.employment_id, 1
      FROM awcms_hr_employment_terms t
      JOIN awcms_hr_employments e
        ON e.tenant_id = t.tenant_id AND e.id = t.employment_id
       AND e.deleted_at IS NULL
     WHERE t.tenant_id = p_tenant
       AND t.manager_employment_id = p_manager
       AND t.effective_to IS NULL
    UNION
    SELECT t.employment_id, r.depth + 1
      FROM reports r
      JOIN awcms_hr_employment_terms t
        ON t.tenant_id = p_tenant
       AND t.manager_employment_id = r.id
       AND t.effective_to IS NULL
      JOIN awcms_hr_employments e
        ON e.tenant_id = t.tenant_id AND e.id = t.employment_id
       AND e.deleted_at IS NULL
     WHERE r.depth < 10
  )
  SELECT DISTINCT id FROM reports WHERE id <> p_manager
$$;

COMMENT ON TABLE awcms_hr_attendance_events IS
  'Issue #947 / ADR-0132 — CONFIDENTIAL behavioural data. Append-only (no UPDATE/DELETE for awcms_app, plus triggers). recorded_at is the DATABASE clock; occurred_at is bounded by the tenant skew; self/supervisor events cannot be back-dated, kiosk/import replays are accepted up to 7 days and flagged late. Replay-safe by client_event_key. Superseded only by an approved correction, once. No location, photo, device or network column (O6, ADR-0138: evidence is a separate table, Issue #970).';
COMMENT ON TABLE awcms_hr_attendance_corrections IS
  'Issue #947 / ADR-0132 — CONFIDENTIAL; `reason` is SENSITIVE (never audited, never in an event or the workflow store). A proposed add/replace of an attendance event. Only the status moves, and it follows the workflow_approval verdict; neither the requester nor the employee the correction is about (the login linked at request time or now) can be the approver (CHECK + trigger against the workflow decision rows, including delegation). Never deleted.';
