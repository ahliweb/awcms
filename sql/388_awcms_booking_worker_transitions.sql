-- `booking` worker-callable confirm and cancel (Issue #1278, ADR-0131;
-- booking.md sections 3, 5.1 and 7.4) -- the narrow SECURITY DEFINER function
-- that lets a consumer running as `awcms_worker` (for example a downstream
-- adapter confirming a reservation from `domain-events:dispatch`) call
-- `BookingPort.confirm` / `.cancel` without the worker holding a privilege it
-- could misuse. Same design as `sql/200` / `sql/209` (the hold-expiry sweep) and
-- the same four safeguards of `sql/048` / `sql/119` / `sql/124` / `sql/142`.
--
-- ## Why a function, and not table GRANTs to `awcms_worker`
--
-- `sql/200` explains it for the sweep and it holds here twice over: the worker
-- holds NO privilege on the booking tables (they carry the customer reference
-- and the note), and `GRANT UPDATE (status)` would let a cron job make EVERY
-- legal transition, including the ones this function deliberately does not offer
-- (check-in, completion, no-show). The trigger of `sql/180` limits WHICH
-- transitions are legal, not WHO makes them.
--
-- So the privilege goes to a function whose statements are fixed:
--
--   1. a dedicated NOLOGIN owner role (`awcms_booking_transition`) with no
--      members, unreachable except as this function's definer;
--   2. NO new policy. The owner role is subject to the tables' own
--      tenant-isolation policy, which reads the session's
--      `app.current_tenant_id`; the function ALSO refuses a tenant argument that
--      is not that context, loudly;
--   3. `SET search_path = public, pg_temp`, and the owner role holds only the
--      column-scoped privileges the statements below need;
--   4. EXECUTE revoked from PUBLIC and granted to `awcms_worker` ALONE (the
--      request path never calls it: it has `transitionReservation`).
--
-- ## One implementation of the rule, twice
--
-- `src/modules/booking/application/booking-reservation-service.ts`
-- `transitionReservation` is the application's implementation of confirm and
-- cancel; this is the worker's. Two implementations drift, so
-- `tests/integration/booking-worker-transition.integration.test.ts` runs BOTH for
-- every status and compares the rows they leave (reservation, allocations,
-- history, audit, outbox), exactly as `booking-concurrency` does for the sweep.
-- What is the same and written once, in TypeScript: the audit row and the domain
-- event (the function returns the non-personal facts, as `sql/209` does for the
-- sweep, and the caller hands them to the audit and outbox writers the worker
-- already holds).
--
-- ## What it can and cannot do
--
-- `p_action` is `'confirm'` or `'cancel'` and nothing else (any other value
-- raises 22023). Each branch writes only its own literals:
--
--   * confirm: `held -> confirmed` on a hold that has NOT elapsed on the database
--     clock; clears the hold expiry; writes one `confirmed` history row;
--   * cancel: `held | confirmed -> cancelled`; records `late_cancellation` and the
--     short reason code; releases the live allocations with reason `cancelled`;
--     writes one `cancelled` history row.
--
-- The values the caller supplies and the function writes are exactly: the actor
-- (who the consumer says acted), the correlation id and, for a cancel, a short
-- reason CODE (`^[a-z][a-z0-9_]{0,31}$`, a free-text reason is refused). The
-- actor must be a tenant user of the SAME tenant (the foreign key of `sql/180`
-- refuses any other), and it is as self-asserted here as in any worker job: it
-- names the consumer's principal, it is not an authentication.
--
-- Asking for the state a reservation is already in answers `replayed` and writes
-- nothing (booking.md section 5.2, layer 2). An unknown id, another tenant's id
-- and a soft-hidden one are the same `not_found` (RLS makes them the same).
--
-- Idempotent: the role is created only if absent, the function is
-- `CREATE OR REPLACE`, GRANTs are repeatable.

BEGIN;

-- 1. The owner role. NOLOGIN, no members, no bypass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_booking_transition'
  ) THEN
    CREATE ROLE awcms_booking_transition
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_booking_transition;

-- Exactly what the statements below touch, and no more. The UPDATEs are
-- column-scoped (a belt over the function's literal-only braces).
GRANT SELECT, UPDATE (
  status, hold_expires_at, late_cancellation, cancel_reason_code,
  status_changed_at, status_changed_by, updated_at
) ON awcms_booking_reservations TO awcms_booking_transition;
GRANT SELECT ON awcms_booking_reservation_items TO awcms_booking_transition;
-- The cancellation cutoff, and the three columns of the join that reaches it.
GRANT SELECT (id, tenant_id, cancellation_cutoff_seconds)
  ON awcms_booking_service_offerings TO awcms_booking_transition;
GRANT SELECT, UPDATE (released_at, released_reason)
  ON awcms_booking_resource_allocations TO awcms_booking_transition;
-- Releasing the last allocation of a (item, resource) releases the staff
-- assignment with it (the trigger of `sql/305`, SECURITY INVOKER).
GRANT SELECT, UPDATE (released_at, released_reason)
  ON awcms_booking_staff_assignments TO awcms_booking_transition;
GRANT SELECT, INSERT ON awcms_booking_reservation_events
  TO awcms_booking_transition;

-- The two SECURITY INVOKER functions the statements above reach: the event
-- facts (returned to the caller) and the quantity stamp of the history trigger.
GRANT EXECUTE ON FUNCTION awcms_booking_reservation_event_facts(uuid, uuid)
  TO awcms_booking_transition;
GRANT EXECUTE ON FUNCTION awcms_booking_reservation_quantities(uuid, uuid)
  TO awcms_booking_transition;

-- 2. The function.
CREATE OR REPLACE FUNCTION awcms_booking_worker_transition(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_action text,
  p_actor uuid,
  p_correlation_id uuid,
  p_reason_code text
)
RETURNS TABLE (
  out_outcome text,
  out_previous_status text,
  out_status text,
  out_hold_expires_at text,
  out_reservation_no text,
  out_late_cancellation boolean,
  out_released_allocations integer,
  out_event_facts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
  v_row awcms_booking_reservations%ROWTYPE;
  v_now timestamptz;
  v_target text;
  v_cutoff integer;
  v_late boolean := false;
  v_released integer := 0;
  v_reason text := NULL;
  v_hold_text text;
BEGIN
  -- Only the tenant the calling session is scoped to. RLS would return nothing
  -- for any other, but a silent `not_found` reads as "no such reservation":
  -- refuse loudly.
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_worker_transition: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('confirm', 'cancel') THEN
    RAISE EXCEPTION
      'awcms_booking_worker_transition: only confirm and cancel are offered'
      USING ERRCODE = '22023';
  END IF;

  IF p_reservation_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION
      'awcms_booking_worker_transition: the reservation and the actor are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'cancel' THEN
    -- A short code, never free text (the CHECK of `sql/180` says the same).
    IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z][a-z0-9_]{0,31}$' THEN
      RAISE EXCEPTION
        'awcms_booking_worker_transition: the reason must be a short code'
        USING ERRCODE = '22023';
    END IF;
    v_reason := p_reason_code;
    v_target := 'cancelled';
  ELSE
    v_target := 'confirmed';
  END IF;

  -- The one row every writer of this reservation serialises on (a confirm racing
  -- the sweep, two cancels, a cancel racing a reschedule). It WAITS, as the
  -- application's lock does: a worker confirming a hold the sweep is expiring
  -- must learn the outcome, not skip it.
  SELECT r.* INTO v_row
  FROM awcms_booking_reservations r
  WHERE r.tenant_id = p_tenant_id AND r.id = p_reservation_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::text, NULL::text,
      NULL::text, false, 0, NULL::jsonb;
    RETURN;
  END IF;

  -- The clock is read AFTER the lock (a second statement), the instant the
  -- `held -> confirmed` trigger of `sql/180` will judge.
  v_now := clock_timestamp();
  v_hold_text := to_char(v_row.hold_expires_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  -- Layer 2 of the idempotency layers: already there, write nothing.
  IF v_row.status = v_target THEN
    RETURN QUERY SELECT 'replayed'::text, v_row.status::text, v_row.status::text,
      v_hold_text, v_row.reservation_no::text, v_row.late_cancellation, 0,
      awcms_booking_reservation_event_facts(p_tenant_id, v_row.id);
    RETURN;
  END IF;

  IF p_action = 'confirm' THEN
    -- A payment observed after the sweep expired the hold is "too late", the
    -- same answer as a hold that has elapsed but not yet been swept.
    IF v_row.status = 'expired' THEN
      RETURN QUERY SELECT 'hold_expired'::text, v_row.status::text, NULL::text,
        NULL::text, NULL::text, false, 0, NULL::jsonb;
      RETURN;
    END IF;

    IF v_row.status <> 'held' OR v_row.hold_expires_at IS NULL THEN
      RETURN QUERY SELECT 'invalid_state'::text, v_row.status::text, NULL::text,
        NULL::text, NULL::text, false, 0, NULL::jsonb;
      RETURN;
    END IF;

    IF v_row.hold_expires_at <= v_now THEN
      RETURN QUERY SELECT 'hold_expired'::text, v_row.status::text, NULL::text,
        NULL::text, NULL::text, false, 0, NULL::jsonb;
      RETURN;
    END IF;
  ELSIF v_row.status NOT IN ('held', 'confirmed') THEN
    RETURN QUERY SELECT 'invalid_state'::text, v_row.status::text, NULL::text,
      NULL::text, NULL::text, false, 0, NULL::jsonb;
    RETURN;
  END IF;

  IF p_action = 'cancel' THEN
    -- Late when now is at or past `starts_at - cutoff` of the MOST restrictive
    -- offering (the largest cutoff), compared at millisecond precision exactly
    -- as `isLateCancellation` does in the application.
    SELECT max(o.cancellation_cutoff_seconds) INTO v_cutoff
    FROM awcms_booking_reservation_items i
    JOIN awcms_booking_service_offerings o
      ON o.tenant_id = i.tenant_id AND o.id = i.offering_id
    WHERE i.tenant_id = p_tenant_id AND i.reservation_id = v_row.id;

    v_late := v_cutoff IS NOT NULL
      AND floor(extract(epoch FROM v_now) * 1000)::float8
          >= floor(extract(epoch FROM v_row.starts_at) * 1000)::float8
             - v_cutoff::float8 * 1000;
  END IF;

  -- The `held -> confirmed` guard trigger judges the hold by its OWN
  -- `clock_timestamp()`, a moment after the read above: a hold that elapses in
  -- that window raises 55000 HOLD_EXPIRED. That is the same answer as an elapsed
  -- hold. The block is a subtransaction, so the failed statement leaves nothing.
  BEGIN
    IF p_action = 'confirm' THEN
      UPDATE awcms_booking_reservations r
      SET status = 'confirmed', hold_expires_at = NULL,
          status_changed_at = clock_timestamp(),
          status_changed_by = p_actor,
          updated_at = clock_timestamp()
      WHERE r.tenant_id = p_tenant_id AND r.id = v_row.id
        AND r.status = v_row.status;
    ELSE
      UPDATE awcms_booking_reservations r
      SET status = 'cancelled', late_cancellation = v_late,
          cancel_reason_code = v_reason,
          status_changed_at = clock_timestamp(),
          status_changed_by = p_actor,
          updated_at = clock_timestamp()
      WHERE r.tenant_id = p_tenant_id AND r.id = v_row.id
        AND r.status = v_row.status;
    END IF;

    IF NOT FOUND THEN
      -- Unreachable while the row is locked and its status was just read.
      RAISE EXCEPTION
        'awcms_booking_worker_transition: the reservation changed under its own lock'
        USING ERRCODE = '55000';
    END IF;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM LIKE 'awcms_booking: HOLD_EXPIRED:%' THEN
      RETURN QUERY SELECT 'hold_expired'::text, v_row.status::text, NULL::text,
        NULL::text, NULL::text, false, 0, NULL::jsonb;
      RETURN;
    END IF;
    RAISE;
  END;

  IF p_action = 'cancel' THEN
    WITH released AS (
      UPDATE awcms_booking_resource_allocations a
      SET released_at = clock_timestamp(), released_reason = 'cancelled'
      FROM awcms_booking_reservation_items i
      WHERE a.tenant_id = p_tenant_id
        AND i.tenant_id = p_tenant_id
        AND i.reservation_id = v_row.id
        AND a.item_id = i.id
        AND a.released_at IS NULL
      RETURNING a.id
    )
    SELECT count(*)::integer INTO v_released FROM released;
  END IF;

  -- Exactly ONE history row per transition (booking.md section 13). `detail`
  -- holds closed keys: counts and flags, never text.
  INSERT INTO awcms_booking_reservation_events
    (tenant_id, reservation_id, seq, kind, from_status, to_status,
     actor_user_id, correlation_id, reason_code, detail)
  SELECT p_tenant_id, v_row.id, coalesce(max(ev.seq), 0) + 1,
         v_target, v_row.status, v_target,
         p_actor, p_correlation_id, v_reason,
         CASE WHEN p_action = 'cancel'
              THEN jsonb_build_object('lateCancellation', v_late,
                                      'releasedAllocations', v_released)
              ELSE '{}'::jsonb END
  FROM awcms_booking_reservation_events ev
  WHERE ev.tenant_id = p_tenant_id AND ev.reservation_id = v_row.id;

  RETURN QUERY
  SELECT 'ok'::text, v_row.status::text, v_target,
         CASE WHEN p_action = 'confirm' THEN NULL::text ELSE v_hold_text END,
         v_row.reservation_no::text, v_late, v_released,
         awcms_booking_reservation_event_facts(p_tenant_id, v_row.id);
END;
$function$;

COMMENT ON FUNCTION awcms_booking_worker_transition(uuid, uuid, text, uuid, uuid, text) IS
  'Issue #1278 / ADR-0131. Confirm or cancel ONE reservation of the session tenant on behalf of a worker-role consumer (BookingPort.confirm/.cancel as awcms_worker). p_action is confirm or cancel and nothing else. Same transitions, same refusals (not_found, invalid_state, hold_expired), same layer-2 replay and same history row as transitionReservation; returns the non-personal event facts so the caller writes the audit row and the domain event. Narrow SECURITY DEFINER with the sql/048 safeguards and a dedicated NOLOGIN memberless owner (awcms_booking_transition). The tenant argument must equal the session tenant context; the only caller-supplied values written are the actor (a tenant user of the same tenant, by FK), the correlation id and a short cancel reason code. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_booking_worker_transition(uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_worker_transition(uuid, uuid, text, uuid, uuid, text)
  TO awcms_worker;

-- Reassign so SECURITY DEFINER really runs as that role. Requires SUPERUSER at
-- migration time -- an invariant this repo already demands.
ALTER FUNCTION awcms_booking_worker_transition(uuid, uuid, text, uuid, uuid, text)
  OWNER TO awcms_booking_transition;

COMMIT;
