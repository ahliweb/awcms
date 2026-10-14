-- `booking` hold-expiry sweep (Issue #939, ADR-0131; booking.md section 5.1) --
-- the narrow SECURITY DEFINER function that lets the scheduled job
-- `booking:holds:expire` run as `awcms_worker` without holding a privilege it
-- could misuse. Same design as `sql/142` (ADR-0090) and the same four
-- safeguards of `sql/048` / `sql/119` / `sql/124`.
--
-- ## What this is, and is not
--
-- The sweep is HOUSEKEEPING, not the gate. A hold's expiry takes effect for
-- every claim at the instant on the row: the allocator reclaims an elapsed hold
-- on the units it claims (lazy reclaim, in the claim's own transaction, as the
-- application role). This function is the OTHER half: it moves holds nobody
-- tried to claim over from `held` to `expired`, releases their units and writes
-- their history, so a tenant's `held` list does not fill with ghosts. A stopped
-- sweep costs stale `held` rows and never a double booking.
--
-- ## Why a function, and not table GRANTs to `awcms_worker`
--
-- Run as the worker, the sweep needs to UPDATE reservations and allocations. A
-- plain `GRANT UPDATE ON awcms_booking_reservations TO awcms_worker` would hand
-- a cron job every legal transition of the state machine: it could CONFIRM a
-- hold nobody paid for or CANCEL a customer's booking. The trigger of `sql/180`
-- limits WHICH transitions are legal, not WHO may make them, and column-scoped
-- grants do not help (`status` is both the column the sweep must write and the
-- column the dangerous values live in).
--
-- So the privilege goes to a function instead, whose statements are fixed:
--
--   1. a dedicated NOLOGIN owner role (`awcms_booking_expiry`) with no members,
--      unreachable except as this function's definer;
--   2. NO new policy. The owner role is subject to the tables' own
--      tenant-isolation policy, which reads the session's
--      `app.current_tenant_id`; the function ALSO refuses a tenant argument that
--      differs from that context, so it can only ever touch the tenant the
--      calling session is scoped to (stricter than `sql/142`, whose sweep takes
--      the tenant as an argument alone);
--   3. a TIGHT boundary: the function takes a tenant id and a batch size and
--      NOTHING ELSE, so there is no value a caller can supply that it will
--      write. Every literal it writes is in this file, and the owner role holds
--      only the column-scoped UPDATEs those literals need;
--   4. EXECUTE revoked from PUBLIC and granted to `awcms_worker` ALONE (the
--      request path never calls it: lazy reclaim is its own code).
--
-- ## It can only ever EXPIRE an elapsed hold
--
-- Read the statements as a set. The reservation UPDATE writes the literal
-- `'expired'`, is guarded by `status = 'held' AND hold_expires_at <=
-- clock_timestamp()`, so it can neither confirm, nor cancel, nor touch a hold
-- that has not run out (the `held -> expired` trigger of `sql/180` refuses the
-- last one a second time, by the same clock). The allocation UPDATE writes the
-- literal reason `'expired'` and only on a row still live, belonging to a
-- reservation this same statement just expired. The history INSERT writes the
-- literal `'expired'` kind. A compromised worker calling this in a loop can
-- therefore end elapsed holds a little earlier than the next scheduled pass.
-- That is a nuisance, not a breach, and it is the only thing it can do.
--
-- ## Deliberately no actor
--
-- The transition writes `status_changed_by = NULL` and the history row carries no
-- actor: an expiry is made by the clock, and naming the person who placed the
-- hold as the one who last changed its status would be false (the same choice as
-- `sql/142`'s `revoked_by_tenant_user_id`, and what keeps this function narrow:
-- an actor parameter would be a value the caller supplies and the function
-- writes).
--
-- ## One statement, `SKIP LOCKED`
--
-- The reservation, its allocations and its `expired` history row move together
-- or not at all. The candidates are locked `FOR UPDATE SKIP LOCKED`, so the
-- sweep never waits on (and so never deadlocks with) a request that is
-- confirming, cancelling or reclaiming the same hold: such a hold is left for
-- the next pass. `hold_expires_at <= statement_timestamp()` is a redundant,
-- INDEXABLE pre-filter (it is stable, unlike `clock_timestamp()`, so the planner
-- can range-scan `awcms_booking_reservations_hold_expiry_idx`); it is never
-- looser than the authority, `clock_timestamp()`, which is evaluated as well.
--
-- `src/modules/booking/application/booking-hold-expiry.ts` keeps a second
-- implementation of the same end state for lazy reclaim (it expires the holds
-- standing on a claim's units, as the application role). Two implementations
-- drift, so `tests/integration/booking-concurrency.integration.test.ts` runs both
-- and compares the rows they leave.
--
-- Idempotent: the role is created only if absent, the function is
-- `CREATE OR REPLACE`, GRANTs are repeatable, and a second pass finds the same
-- holds already `expired` and matches none of them.

BEGIN;

-- 1. The owner role. NOLOGIN, no members, no bypass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_booking_expiry'
  ) THEN
    CREATE ROLE awcms_booking_expiry
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_booking_expiry;

-- Exactly what the statements below touch, and no more. The UPDATEs are
-- column-scoped (a belt over the function's literal-only braces).
GRANT SELECT, UPDATE (status, status_changed_at, status_changed_by, updated_at)
  ON awcms_booking_reservations TO awcms_booking_expiry;
GRANT SELECT ON awcms_booking_reservation_items TO awcms_booking_expiry;
GRANT SELECT, UPDATE (released_at, released_reason)
  ON awcms_booking_resource_allocations TO awcms_booking_expiry;
GRANT SELECT, INSERT ON awcms_booking_reservation_events TO awcms_booking_expiry;

-- 2. The function. One tenant, one batch size, two integers back.
CREATE OR REPLACE FUNCTION awcms_booking_expire_due_holds(
  p_tenant_id uuid,
  p_limit integer
)
RETURNS TABLE (expired_count integer, released_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
BEGIN
  -- Only the tenant the calling session is scoped to. RLS would return nothing
  -- for any other, but a silent zero reads as "nothing to do": refuse loudly.
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_expire_due_holds: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  -- A hostile or careless batch size must not turn this into a full-table sweep
  -- held in one transaction. Clamped rather than rejected: the caller's intent
  -- ("drain some backlog") is served either way.
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
  SELECT (SELECT count(*) FROM expired_rows)::integer,
         (SELECT count(*) FROM released_rows)::integer;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_expire_due_holds(uuid, integer) IS
  'Issue #939 / ADR-0131. Expires booking holds whose lifetime has elapsed on the database clock: the reservation becomes expired, its live allocations are released with reason expired, and one expired history row is appended, in one statement, FOR UPDATE SKIP LOCKED. Narrow SECURITY DEFINER with the sql/048 safeguards and a dedicated NOLOGIN memberless owner (awcms_booking_expiry). It takes a tenant id (which must equal the session tenant context) and a batch size and nothing else, so no caller-supplied value is ever written; every literal is in sql/200. It can only expire an elapsed hold: it cannot confirm, cancel or touch a hold that has not run out. EXECUTE restricted to awcms_worker. This is HOUSEKEEPING: the allocator reclaims an elapsed hold on the units it claims, so correctness never depends on this function being called.';

REVOKE ALL ON FUNCTION awcms_booking_expire_due_holds(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_expire_due_holds(uuid, integer)
  TO awcms_worker;

-- 3. The read-only twin for `--dry-run`. The worker holds NO privilege on
--    reservations (they carry the customer reference and the note), so even the
--    backlog count goes through a function: it returns one integer, for the
--    session's own tenant, and nothing else.
CREATE OR REPLACE FUNCTION awcms_booking_count_due_holds(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_context text := nullif(current_setting('app.current_tenant_id', true), '');
  v_due integer;
BEGIN
  IF p_tenant_id IS NULL
     OR v_context IS NULL
     OR p_tenant_id IS DISTINCT FROM v_context::uuid THEN
    RAISE EXCEPTION
      'awcms_booking_count_due_holds: the tenant argument must match the session tenant context'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_due
  FROM awcms_booking_reservations r
  WHERE r.tenant_id = p_tenant_id
    AND r.status = 'held'
    AND r.hold_expires_at <= statement_timestamp()
    AND r.hold_expires_at <= clock_timestamp();

  RETURN v_due;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_count_due_holds(uuid) IS
  'Issue #939 / ADR-0131. Read-only: how many holds of the session tenant have elapsed on the database clock (the backlog of awcms_booking_expire_due_holds), for booking:holds:expire --dry-run. Same owner and safeguards as that function; returns one integer.';

REVOKE ALL ON FUNCTION awcms_booking_count_due_holds(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_count_due_holds(uuid) TO awcms_worker;

-- Reassign so SECURITY DEFINER really runs as that role. Requires SUPERUSER at
-- migration time -- an invariant this repo already demands.
ALTER FUNCTION awcms_booking_expire_due_holds(uuid, integer)
  OWNER TO awcms_booking_expiry;
ALTER FUNCTION awcms_booking_count_due_holds(uuid)
  OWNER TO awcms_booking_expiry;

COMMIT;
