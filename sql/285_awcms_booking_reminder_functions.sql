-- `booking` reminder dispatch -- the three narrow SECURITY DEFINER functions of
-- `booking:reminders:dispatch` (Issue #943, ADR-0131, ADR-0133; docs/awcms/
-- booking.md section 7.5). Same design as `sql/200` (ADR-0090) and the same
-- four safeguards of `sql/048` / `sql/119` / `sql/124`.
--
-- ## Why functions, and not table GRANTs to `awcms_worker`
--
-- The job has to know which reservations are confirmed, when they start, and the
-- opaque customer reference the recipient resolver needs. Those columns sit on
-- `awcms_booking_reservations`, next to the customer note, and `UPDATE` on that
-- table would let a cron job confirm or cancel a booking (`sql/200` spells the
-- argument out). So the worker holds NO privilege on the reservation tables and
-- reads exactly what it needs through these functions, each of which:
--
--   1. is owned by a dedicated NOLOGIN, memberless role
--      (`awcms_booking_reminders`) that holds only the column-scoped privileges
--      the statements below use;
--   2. adds NO policy: the owner is subject to the tables' tenant-isolation
--      policy, and every function ALSO refuses a tenant argument that differs
--      from the session's `app.current_tenant_id`;
--   3. takes a tenant id and clamped numeric bounds, never a status, a kind or
--      a text value a caller could cause to be written: every literal written is
--      in this file;
--   4. has EXECUTE revoked from PUBLIC and granted to `awcms_worker` alone.
--
-- ## What each can and cannot do
--
-- * `awcms_booking_reminders_materialize` -- creates intents. It can insert a
--   `confirmation` or `reminder` row for a CONFIRMED reservation, and nothing
--   else: it never touches a reservation. `ON CONFLICT DO NOTHING` on the unique
--   key is what makes "one per (reservation, kind, occurrence)" hold under
--   concurrent workers and under a retried job.
-- * `awcms_booking_reminders_due` -- returns the pending, due intents whose
--   reservation is STILL confirmed, with the reference and the facts the message
--   needs. It takes `FOR UPDATE SKIP LOCKED` on the intent and `FOR SHARE SKIP
--   LOCKED` on the reservation: a reservation that is being cancelled right now
--   holds the row lock and is skipped, and a reservation we hold the share lock
--   on cannot be cancelled until the job's transaction ends. So a cancelled
--   reservation is never sent a message the job queues AFTER the cancel.
-- * `awcms_booking_reminders_stale` -- returns the intents the cancellation
--   sweep must look at: pending ones whose reservation is no longer confirmed
--   (or has started), and enqueued ones, not yet reconciled, whose reservation
--   was cancelled, expired, rescheduled or has started and whose queued message
--   may still be unsent. Read only.
--
-- Idempotent: the role is created only if absent, the functions are CREATE OR
-- REPLACE, GRANTs are repeatable.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_booking_reminders'
  ) THEN
    CREATE ROLE awcms_booking_reminders
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_booking_reminders;
-- Row locks (`FOR SHARE`, `FOR UPDATE`) need the UPDATE privilege on at least
-- one column of the locked table, whatever the lock strength. The reservation
-- grant is therefore one harmless, column-scoped UPDATE: no statement in this
-- file ever writes a reservation (the functions' text is the proof), and the
-- reservation update guard would refuse a status change anyway.
GRANT SELECT, UPDATE (updated_at)
  ON awcms_booking_reservations TO awcms_booking_reminders;
GRANT SELECT ON awcms_booking_reservation_items TO awcms_booking_reminders;
-- The start is shown in the resource's own zone (a slot item carries none).
GRANT SELECT (id, tenant_id, timezone)
  ON awcms_booking_resources TO awcms_booking_reminders;
GRANT SELECT (id, item_id, resource_id, tenant_id)
  ON awcms_booking_resource_allocations TO awcms_booking_reminders;
GRANT SELECT, INSERT, UPDATE (updated_at)
  ON awcms_booking_reminder_intents TO awcms_booking_reminders;

-- 1. Materialize ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_booking_reminders_materialize(
  p_tenant_id uuid,
  p_limit integer,
  p_lead_seconds integer,
  p_fresh_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
  v_created integer := 0;
  v_step integer;
BEGIN
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_reminders_materialize: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 1;
  ELSIF p_limit > 1000 THEN
    p_limit := 1000;
  END IF;
  -- Lead: 5 minutes to 14 days. Freshness of a confirmation: 1 minute to 7 days.
  p_lead_seconds := least(greatest(coalesce(p_lead_seconds, 86400), 300), 1209600);
  p_fresh_seconds := least(greatest(coalesce(p_fresh_seconds, 21600), 60), 604800);

  -- The confirmation: owed to a reservation confirmed recently. A reservation
  -- confirmed long ago gets none, so switching the feature on never floods the
  -- customers of the whole back catalogue. No customer reference means a
  -- walk-in: settled `skipped` at creation (and observable), not re-scanned.
  INSERT INTO awcms_booking_reminder_intents
    (tenant_id, reservation_id, kind, occurrence, status, outcome_code,
     due_at, settled_at)
  SELECT r.tenant_id, r.id, 'confirmation', 0,
         CASE WHEN r.external_customer_ref IS NULL THEN 'skipped' ELSE 'pending' END,
         CASE WHEN r.external_customer_ref IS NULL THEN 'no_customer_ref' END,
         r.status_changed_at,
         CASE WHEN r.external_customer_ref IS NULL THEN clock_timestamp() END
  FROM awcms_booking_reservations r
  WHERE r.tenant_id = p_tenant_id
    AND r.status = 'confirmed'
    AND r.starts_at > clock_timestamp()
    AND r.status_changed_at > clock_timestamp() - make_interval(secs => p_fresh_seconds)
    AND NOT EXISTS (
      SELECT 1 FROM awcms_booking_reminder_intents i
      WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
        AND i.kind = 'confirmation' AND i.occurrence = 0)
  ORDER BY r.status_changed_at, r.id
  LIMIT p_limit
  ON CONFLICT ON CONSTRAINT awcms_booking_reminder_intents_unique_key DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_created := v_created + v_step;

  -- The reminder (occurrence 1): owed once the lead window has opened and the
  -- reservation has not started. A reservation CONFIRMED inside the window
  -- (booked less than the lead ahead) is settled `skipped`: the confirmation is
  -- the notice, and a reminder minutes after it would be noise.
  INSERT INTO awcms_booking_reminder_intents
    (tenant_id, reservation_id, kind, occurrence, status, outcome_code,
     due_at, settled_at)
  SELECT r.tenant_id, r.id, 'reminder', 1,
         CASE WHEN r.external_customer_ref IS NULL
                OR r.status_changed_at > r.starts_at - make_interval(secs => p_lead_seconds)
              THEN 'skipped' ELSE 'pending' END,
         CASE WHEN r.external_customer_ref IS NULL THEN 'no_customer_ref'
              WHEN r.status_changed_at > r.starts_at - make_interval(secs => p_lead_seconds)
              THEN 'booked_inside_lead' END,
         r.starts_at - make_interval(secs => p_lead_seconds),
         CASE WHEN r.external_customer_ref IS NULL
                OR r.status_changed_at > r.starts_at - make_interval(secs => p_lead_seconds)
              THEN clock_timestamp() END
  FROM awcms_booking_reservations r
  WHERE r.tenant_id = p_tenant_id
    AND r.status = 'confirmed'
    AND r.starts_at > clock_timestamp()
    AND r.starts_at - make_interval(secs => p_lead_seconds) <= clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM awcms_booking_reminder_intents i
      WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
        AND i.kind = 'reminder' AND i.occurrence = 1)
  ORDER BY r.starts_at, r.id
  LIMIT p_limit
  ON CONFLICT ON CONSTRAINT awcms_booking_reminder_intents_unique_key DO NOTHING;
  GET DIAGNOSTICS v_step = ROW_COUNT;
  v_created := v_created + v_step;

  RETURN v_created;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_reminders_materialize(uuid, integer, integer, integer) IS
  'Issue #943 / ADR-0131, ADR-0133. Creates the confirmation and reminder intents owed for the session tenant''s CONFIRMED reservations, once per (reservation, kind, occurrence) (unique key + ON CONFLICT DO NOTHING). Writes only the literals in sql/285 and never touches a reservation. A walk-in (no customer reference) and a booking made inside the lead window are created already settled as skipped. Narrow SECURITY DEFINER, owner awcms_booking_reminders; tenant argument must equal the session context; EXECUTE restricted to awcms_worker.';

-- 2. Due -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_booking_reminders_due(
  p_tenant_id uuid,
  p_limit integer
)
RETURNS TABLE (
  intent_id uuid,
  reservation_id uuid,
  kind text,
  occurrence smallint,
  attempts integer,
  reservation_no text,
  external_customer_ref text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
BEGIN
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_reminders_due: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 1;
  ELSIF p_limit > 500 THEN
    p_limit := 500;
  END IF;

  RETURN QUERY
  SELECT i.id, r.id, i.kind, i.occurrence, i.attempts, r.reservation_no,
         r.external_customer_ref, r.starts_at, r.ends_at,
         coalesce(
           (SELECT coalesce(it.timezone, res.timezone)
            FROM awcms_booking_reservation_items it
            LEFT JOIN awcms_booking_resource_allocations a
              ON a.tenant_id = it.tenant_id AND a.item_id = it.id
            LEFT JOIN awcms_booking_resources res
              ON res.tenant_id = a.tenant_id AND res.id = a.resource_id
            WHERE it.tenant_id = r.tenant_id AND it.reservation_id = r.id
            ORDER BY it.line_no, a.id LIMIT 1),
           'UTC'),
         r.status_changed_at
  FROM awcms_booking_reminder_intents i
  JOIN awcms_booking_reservations r
    ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
  WHERE i.tenant_id = p_tenant_id
    AND i.status = 'pending'
    AND i.due_at <= clock_timestamp()
    AND r.status = 'confirmed'
    AND r.starts_at > clock_timestamp()
  ORDER BY i.due_at, i.id
  LIMIT p_limit
  FOR UPDATE OF i SKIP LOCKED
  FOR SHARE OF r SKIP LOCKED;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_reminders_due(uuid, integer) IS
  'Issue #943 / ADR-0131, ADR-0133. Pending, due intents of the session tenant whose reservation is STILL confirmed and has not started, locked FOR UPDATE SKIP LOCKED (intent) and FOR SHARE SKIP LOCKED (reservation): a reservation being cancelled right now is skipped, and one returned here cannot be cancelled until the caller''s transaction ends. Returns the opaque customer reference for the recipient resolver; the caller must not persist it. EXECUTE restricted to awcms_worker.';

-- 3. Stale ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_booking_reminders_stale(
  p_tenant_id uuid,
  p_limit integer
)
RETURNS TABLE (
  intent_id uuid,
  reservation_id uuid,
  kind text,
  occurrence smallint,
  intent_status text,
  reservation_status text,
  starts_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
BEGIN
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_reminders_stale: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 1;
  ELSIF p_limit > 500 THEN
    p_limit := 500;
  END IF;

  RETURN QUERY
  SELECT i.id, r.id, i.kind, i.occurrence, i.status, r.status, r.starts_at
  FROM awcms_booking_reminder_intents i
  JOIN awcms_booking_reservations r
    ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
  WHERE i.tenant_id = p_tenant_id
    AND (
      (i.status = 'pending'
        AND (r.status <> 'confirmed' OR r.starts_at <= clock_timestamp()))
      OR
      (i.status = 'enqueued' AND i.reconciled_at IS NULL
        AND (r.status IN ('cancelled', 'expired', 'rescheduled', 'no_show')
             OR r.starts_at <= clock_timestamp()))
    )
  ORDER BY i.created_at, i.id
  LIMIT p_limit
  FOR UPDATE OF i SKIP LOCKED;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_reminders_stale(uuid, integer) IS
  'Issue #943 / ADR-0131, ADR-0133. The intents the cancellation sweep must settle: pending ones whose reservation is no longer confirmed or has started, and enqueued, unreconciled ones whose reservation was cancelled, expired, rescheduled or marked no-show (the queued message may still be unsent). FOR UPDATE SKIP LOCKED on the intent. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_booking_reminders_materialize(uuid, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION awcms_booking_reminders_due(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION awcms_booking_reminders_stale(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_reminders_materialize(uuid, integer, integer, integer) TO awcms_worker;
GRANT EXECUTE ON FUNCTION awcms_booking_reminders_due(uuid, integer) TO awcms_worker;
GRANT EXECUTE ON FUNCTION awcms_booking_reminders_stale(uuid, integer) TO awcms_worker;

ALTER FUNCTION awcms_booking_reminders_materialize(uuid, integer, integer, integer)
  OWNER TO awcms_booking_reminders;
ALTER FUNCTION awcms_booking_reminders_due(uuid, integer)
  OWNER TO awcms_booking_reminders;
ALTER FUNCTION awcms_booking_reminders_stale(uuid, integer)
  OWNER TO awcms_booking_reminders;

COMMIT;
