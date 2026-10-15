-- `booking` reporting facts on the transition history (Issue #944, ADR-0131;
-- booking.md section 7.2).
--
-- The reporting projections of booking ride the EXISTING `reporting` engine as
-- monotonic counters over the append-only `awcms_booking_reservation_events`
-- table (a `cursor_table` source: genuinely append-only, one row per
-- transition). A counter of ROWS answers "how many reservations were confirmed";
-- it cannot answer "how many unit-nights were booked", because that is a SUM and
-- the quantity is not on the event row. This migration puts the quantities on the
-- event row, once, at the moment the event is written, so the engine's cursor
-- scan (and its rebuild, which reads the same table) needs nothing but the table.
--
-- Three additions, none of which changes what an existing statement writes:
--
-- 1. `projection_kind` -- a STORED generated column: `kind`, except that a
--    cancellation the policy judged late reads `late_cancelled`. The engine
--    matches one column against one value per metric rule, so "late cancelled"
--    needs its own column; deriving it from `detail->>'lateCancellation'`
--    (written by the cancel transition, sql/180 era code) keeps a single source of
--    truth for the flag. `kind` itself is untouched, so `cancelled` still counts
--    EVERY cancellation and `late_cancelled` is the subset.
--
-- 2. `booked_seconds`, `released_seconds`, `booked_nights`, `released_nights` --
--    four non-negative bigint quantities, DEFAULT 0, filled by a BEFORE INSERT
--    trigger from the reservation's own allocation rows:
--      * time allocations contribute their SERVICE interval in seconds
--        (`ends_at - starts_at`, never the setup/cleanup buffer: a buffer is
--        capacity the customer did not use);
--      * stay allocations contribute `stay_to - stay_from` nights. An allocation
--        is one UNIT, so a two-night stay on one unit is two unit-nights and the
--        same stay on three units is six (booking.md section 2.5: the occupancy
--        unit is (unit, night)).
--    `confirmed` BOOKS the quantity; a `cancelled` or `rescheduled` event whose
--    `from_status` is `confirmed` RELEASES it. Nothing else carries a quantity:
--    a hold that expires or is cancelled was never booked, and a `no_show`
--    keeps its booking (booked vs actual time is still open under O8).
--    The trigger reads the allocation rows, which still exist after a release
--    (a released allocation is kept as history), so the figure a release carries
--    equals the figure its confirmation booked.
--
-- 3. A one-time backfill of those columns for events that already exist. The
--    append-only trigger is disabled for that single statement and re-enabled in
--    the same transaction; the statement writes ONLY the four new columns, from
--    the same rule as the trigger, and the migration runner's transaction makes
--    the disabled window invisible to every other session.
--
-- No new table, no new privilege: `awcms_worker` already holds SELECT on the
-- events table (sql/180 section 16), column-level grants follow the table, and
-- the trigger function runs as the inserting role under RLS FORCE like any other
-- statement (it reads the inserter's own tenant's allocations only).

BEGIN;

ALTER TABLE awcms_booking_reservation_events
  ADD COLUMN IF NOT EXISTS projection_kind text
    GENERATED ALWAYS AS (
      CASE
        WHEN kind = 'cancelled' AND (detail ->> 'lateCancellation') = 'true'
          THEN 'late_cancelled'
        ELSE kind
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS booked_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booked_nights bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_nights bigint NOT NULL DEFAULT 0;

ALTER TABLE awcms_booking_reservation_events
  DROP CONSTRAINT IF EXISTS awcms_booking_reservation_events_quantities_check;
ALTER TABLE awcms_booking_reservation_events
  ADD CONSTRAINT awcms_booking_reservation_events_quantities_check
  CHECK (booked_seconds >= 0 AND released_seconds >= 0
         AND booked_nights >= 0 AND released_nights >= 0);

-- 1. The one place that says how much a reservation holds ----------------------
CREATE OR REPLACE FUNCTION awcms_booking_reservation_quantities(
  p_tenant_id uuid,
  p_reservation_id uuid
)
RETURNS TABLE (seconds bigint, nights bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    coalesce(sum(
      CASE WHEN a.granularity = 'time'
           THEN floor(extract(epoch FROM (a.ends_at - a.starts_at)))::bigint
           ELSE 0 END), 0)::bigint,
    coalesce(sum(
      CASE WHEN a.granularity = 'stay'
           THEN (a.stay_to - a.stay_from)::bigint
           ELSE 0 END), 0)::bigint
  FROM awcms_booking_reservation_items i
  JOIN awcms_booking_resource_allocations a
    ON a.tenant_id = i.tenant_id AND a.item_id = i.id
  WHERE i.tenant_id = p_tenant_id AND i.reservation_id = p_reservation_id;
$function$;

COMMENT ON FUNCTION awcms_booking_reservation_quantities(uuid, uuid) IS
  'Issue #944 / ADR-0131, ADR-0143. Service-interval seconds and unit-nights a reservation holds, summed over its allocation rows (released rows included: they are kept). SECURITY INVOKER: RLS FORCE applies to the caller. Used by the event-quantity trigger and the sql/244 backfill.';

-- The sql/209 pattern: nobody by default, then exactly the roles that write
-- reservation events (the application role, and the sweep owner for symmetry).
REVOKE ALL ON FUNCTION awcms_booking_reservation_quantities(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_reservation_quantities(uuid, uuid)
  TO awcms_app, awcms_booking_expiry;

-- 2. The trigger ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_booking_stamp_event_quantities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_seconds bigint;
  v_nights bigint;
BEGIN
  IF NEW.kind = 'confirmed' THEN
    SELECT q.seconds, q.nights INTO v_seconds, v_nights
    FROM awcms_booking_reservation_quantities(NEW.tenant_id, NEW.reservation_id) q;
    NEW.booked_seconds := coalesce(v_seconds, 0);
    NEW.booked_nights := coalesce(v_nights, 0);
  ELSIF NEW.kind IN ('cancelled', 'rescheduled')
        AND NEW.from_status = 'confirmed' THEN
    SELECT q.seconds, q.nights INTO v_seconds, v_nights
    FROM awcms_booking_reservation_quantities(NEW.tenant_id, NEW.reservation_id) q;
    NEW.released_seconds := coalesce(v_seconds, 0);
    NEW.released_nights := coalesce(v_nights, 0);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION awcms_booking_stamp_event_quantities() FROM PUBLIC;

DROP TRIGGER IF EXISTS awcms_booking_reservation_events_stamp_quantities
  ON awcms_booking_reservation_events;
CREATE TRIGGER awcms_booking_reservation_events_stamp_quantities
  BEFORE INSERT ON awcms_booking_reservation_events
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_stamp_event_quantities();

-- 3. Backfill of events written before this migration ---------------------------
ALTER TABLE awcms_booking_reservation_events
  DISABLE TRIGGER awcms_booking_reservation_events_append_only;

-- DML on FORCE RLS tables (the sql/103 pattern). The events, items and
-- allocations tables are FORCE ROW LEVEL SECURITY and this backfill is
-- deliberately cross-tenant: with no app.current_tenant_id set, a migration
-- owner that does not bypass RLS would abort with "unrecognized configuration
-- parameter" -- and only where rows exist, so an empty CI database would not
-- show it. FORCE is dropped for the duration and restored below; the runner
-- wraps the file in one transaction and ALTER TABLE holds ACCESS EXCLUSIVE, so
-- no other session observes the tables without it. The quantity is computed
-- ONCE per row (LATERAL) and written by id.
ALTER TABLE awcms_booking_reservation_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reservation_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_allocations NO FORCE ROW LEVEL SECURITY;

WITH q AS (
  SELECT e.id, e.kind, f.seconds, f.nights
  FROM awcms_booking_reservation_events e
  CROSS JOIN LATERAL awcms_booking_reservation_quantities(
    e.tenant_id, e.reservation_id) f
  WHERE e.kind = 'confirmed'
     OR (e.kind IN ('cancelled', 'rescheduled') AND e.from_status = 'confirmed')
)
UPDATE awcms_booking_reservation_events e
SET booked_seconds = CASE WHEN q.kind = 'confirmed' THEN q.seconds ELSE 0 END,
    booked_nights = CASE WHEN q.kind = 'confirmed' THEN q.nights ELSE 0 END,
    released_seconds = CASE WHEN q.kind <> 'confirmed' THEN q.seconds ELSE 0 END,
    released_nights = CASE WHEN q.kind <> 'confirmed' THEN q.nights ELSE 0 END
FROM q
WHERE e.id = q.id;

ALTER TABLE awcms_booking_reservation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reservation_items FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_allocations FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_booking_reservation_events
  ENABLE TRIGGER awcms_booking_reservation_events_append_only;

COMMENT ON COLUMN awcms_booking_reservation_events.projection_kind IS
  'Issue #944 / ADR-0131. kind, except a cancellation judged late reads late_cancelled; the reporting engine matches one column per rule.';
COMMENT ON COLUMN awcms_booking_reservation_events.booked_seconds IS
  'Issue #944. Service-interval seconds a confirmed event BOOKED (sum over the reservation''s time allocations; buffers excluded). 0 on every other event.';
COMMENT ON COLUMN awcms_booking_reservation_events.released_seconds IS
  'Issue #944. The same quantity RELEASED by a cancelled/rescheduled event whose from_status is confirmed. 0 otherwise.';
COMMENT ON COLUMN awcms_booking_reservation_events.booked_nights IS
  'Issue #944. Unit-nights a confirmed event BOOKED (sum of stay_to - stay_from over the reservation''s stay allocations: one per unit and night). 0 otherwise.';
COMMENT ON COLUMN awcms_booking_reservation_events.released_nights IS
  'Issue #944. The same quantity RELEASED by a cancelled/rescheduled event whose from_status is confirmed. 0 otherwise.';

COMMIT;
