-- `booking` domain events for hold expiry (Issue #941, ADR-0131; booking.md
-- section 7.4).
--
-- The nine reservation events go live with the reservation routes, and `expired`
-- is the one that is not caused by a request: the sweep `booking:holds:expire`
-- (this file's concern) and lazy reclaim (application code) cause it. The sweep
-- runs as `awcms_worker`, which holds NO privilege on the booking tables
-- (`sql/200` explains why), so it cannot read the facts an event carries
-- (reservation number, lineage, interval, resources, offerings, the adapter's
-- external reference) -- and it must not be able to: those columns sit beside the
-- customer reference and the note.
--
-- Two changes, both narrow.
--
-- 1. `awcms_booking_reservation_event_facts(tenant, reservation)` -- ONE place that
--    says what an event may carry about a reservation. It returns a jsonb object
--    of an allow-list of non-personal facts and NOTHING else: never the customer
--    reference, the note, a reason, an actor or an amount (there is none). It is
--    SECURITY INVOKER, so for the application role it runs under RLS FORCE like
--    any query, and inside the sweep it runs as the sweep's owner role. EXECUTE is
--    granted to those two roles alone. Every transition's event payload, the lazy
--    reclaim's and the sweep's are built from this one function plus the
--    transition's own fields, so the three cannot drift into carrying different
--    facts.
--
-- 2. `awcms_booking_expire_due_holds` now RETURNS the reservations it expired
--    (id, allocations released, facts), instead of two counts. The statements are
--    unchanged and still write only the same three literals: the new columns are
--    computed from the rows the statement just expired, in the same statement, for
--    the session's own tenant. A caller still supplies a tenant id and a batch
--    size and nothing else, so there is still no value it can make the function
--    write. The caller (the job, as `awcms_worker`) hands the facts to the outbox
--    producer, which the worker may already use (`sql/022`).
--
-- Because the return type changes, the function is DROPped and created again;
-- `sql/200` is applied and immutable and is left as it is. Ownership, the
-- search_path, the tenant-context refusal and the EXECUTE restriction to
-- `awcms_worker` are restated exactly.

BEGIN;

-- 1. The facts function --------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_booking_reservation_event_facts(
  p_tenant_id uuid,
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'reservationId', r.id,
    'reservationNo', r.reservation_no,
    'lineageId', r.lineage_id,
    'startsAt',
      to_char(r.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endsAt',
      to_char(r.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'partySize', r.party_size,
    'externalRefType', r.external_ref_type,
    'externalRef', r.external_ref,
    'resourceIds', coalesce((
      SELECT jsonb_agg(x.rid ORDER BY x.rid)
      FROM (
        SELECT DISTINCT a.resource_id::text AS rid
        FROM awcms_booking_reservation_items i
        JOIN awcms_booking_resource_allocations a
          ON a.tenant_id = i.tenant_id AND a.item_id = i.id
        WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
      ) x
    ), '[]'::jsonb),
    'offeringIds', coalesce((
      SELECT jsonb_agg(x.oid ORDER BY x.oid)
      FROM (
        SELECT DISTINCT i.offering_id::text AS oid
        FROM awcms_booking_reservation_items i
        WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
      ) x
    ), '[]'::jsonb),
    'stays', coalesce((
      SELECT jsonb_agg(s.obj ORDER BY s.rid, s.cin)
      FROM (
        SELECT DISTINCT
          a.resource_id::text AS rid,
          to_char(i.check_in_date, 'YYYY-MM-DD') AS cin,
          jsonb_build_object(
            'resourceId', a.resource_id,
            'checkInDate', to_char(i.check_in_date, 'YYYY-MM-DD'),
            'checkOutDate', to_char(i.check_out_date, 'YYYY-MM-DD'),
            'nights', i.nights,
            'timezone', i.timezone
          ) AS obj
        FROM awcms_booking_reservation_items i
        JOIN awcms_booking_resource_allocations a
          ON a.tenant_id = i.tenant_id AND a.item_id = i.id
        WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
          AND i.granularity = 'stay'
      ) s
    ), '[]'::jsonb)
  )
  FROM awcms_booking_reservations r
  WHERE r.tenant_id = p_tenant_id AND r.id = p_reservation_id;
$function$;

COMMENT ON FUNCTION awcms_booking_reservation_event_facts(uuid, uuid) IS
  'Issue #941 / ADR-0131. The allow-list of non-personal facts a booking domain event may carry about a reservation (number, lineage, interval, resources, offerings, the adapter''s opaque external reference, stay dates). Never the customer reference, the note or a reason. SECURITY INVOKER: RLS FORCE applies to the caller.';

REVOKE ALL ON FUNCTION awcms_booking_reservation_event_facts(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_reservation_event_facts(uuid, uuid)
  TO awcms_app, awcms_booking_expiry;

-- 2. The sweep returns what it expired ------------------------------------------
DROP FUNCTION IF EXISTS awcms_booking_expire_due_holds(uuid, integer);

CREATE FUNCTION awcms_booking_expire_due_holds(
  p_tenant_id uuid,
  p_limit integer
)
RETURNS TABLE (
  expired_reservation_id uuid,
  released_allocations integer,
  event_facts jsonb
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
      'awcms_booking_expire_due_holds: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 1;
  ELSIF p_limit > 1000 THEN
    p_limit := 1000;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT r.id, r.hold_expires_at
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'held'
      AND r.hold_expires_at <= statement_timestamp()
      AND r.hold_expires_at <= clock_timestamp()
    ORDER BY r.hold_expires_at, r.id
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED
  ), expired_rows AS (
    UPDATE awcms_booking_reservations r
    SET status = 'expired',
        status_changed_at = clock_timestamp(),
        status_changed_by = NULL,
        updated_at = clock_timestamp()
    FROM due
    WHERE r.tenant_id = p_tenant_id
      AND r.id = due.id
      AND r.status = 'held'
    RETURNING r.id, due.hold_expires_at
  ), released_rows AS (
    UPDATE awcms_booking_resource_allocations a
    SET released_at = clock_timestamp(), released_reason = 'expired'
    FROM awcms_booking_reservation_items i, expired_rows e
    WHERE a.tenant_id = p_tenant_id
      AND i.tenant_id = p_tenant_id
      AND i.reservation_id = e.id
      AND a.item_id = i.id
      AND a.released_at IS NULL
    RETURNING a.id, i.reservation_id
  ), history_rows AS (
    INSERT INTO awcms_booking_reservation_events
      (tenant_id, reservation_id, seq, kind, from_status, to_status, detail)
    SELECT p_tenant_id, e.id,
           (SELECT coalesce(max(ev.seq), 0) + 1
            FROM awcms_booking_reservation_events ev
            WHERE ev.tenant_id = p_tenant_id AND ev.reservation_id = e.id),
           'expired', 'held', 'expired',
           jsonb_build_object(
             'holdExpiredAt', e.hold_expires_at,
             'trigger', 'reaper',
             'releasedAllocations',
             (SELECT count(*) FROM released_rows rl WHERE rl.reservation_id = e.id)
           )
    FROM expired_rows e
    RETURNING 1
  )
  SELECT e.id,
         (SELECT count(*) FROM released_rows rl WHERE rl.reservation_id = e.id)::integer,
         awcms_booking_reservation_event_facts(p_tenant_id, e.id)
  FROM expired_rows e;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_expire_due_holds(uuid, integer) IS
  'Issue #939 / #941 / ADR-0131. Expires booking holds whose lifetime has elapsed on the database clock: the reservation becomes expired, its live allocations are released with reason expired, and one expired history row is appended, in one statement, FOR UPDATE SKIP LOCKED. Returns one row per reservation it expired (id, allocations released, the non-personal event facts) so the caller can publish the expired domain event. Narrow SECURITY DEFINER with the sql/048 safeguards and a dedicated NOLOGIN memberless owner (awcms_booking_expiry). It takes a tenant id (which must equal the session tenant context) and a batch size and nothing else, so no caller-supplied value is ever written; every literal is in this file. It can only expire an elapsed hold. EXECUTE restricted to awcms_worker. HOUSEKEEPING: the allocator reclaims an elapsed hold on the units it claims, so correctness never depends on this function being called.';

REVOKE ALL ON FUNCTION awcms_booking_expire_due_holds(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_expire_due_holds(uuid, integer)
  TO awcms_worker;

ALTER FUNCTION awcms_booking_expire_due_holds(uuid, integer)
  OWNER TO awcms_booking_expiry;

COMMIT;
