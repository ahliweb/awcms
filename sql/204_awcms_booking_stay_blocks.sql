-- `booking` stay slice: blocked nights as allocation rows, the guards that keep
-- stays and blocks consistent with their owners (Issue #940, ADR-0135 section
-- 4; docs/awcms/booking.md section 4 and 8.1 rule 7).
--
-- ## What `sql/180` and `sql/186` already hold, and what this adds
--
-- `sql/180` already carries the stay form of an allocation (`stay_from`,
-- `stay_to`), the second partial exclusion constraint over `daterange(...,'[)')`,
-- the granularity-equals-booking-mode guard and the 366-night bound, and
-- `sql/186` carries `awcms_booking_resource_blocks`. What was deliberately left
-- for this slice is the one thing that makes a block a HARD exclusion: the
-- allocation rows it owns, under the SAME stay constraint as a guest's nights.
--
--   1. `block_id` on `awcms_booking_resource_allocations`, `item_id` becomes
--      nullable, and exactly one of the two is set (a row is a guest's night or
--      a blocked night, never both). `starts_at` / `ends_at` become nullable for
--      a block row (a block has dates, no arrival or departure instant).
--   2. `block_released` as a release reason, tied to block rows only.
--   3. The allocation INSERT guard learns the block form: the row must equal its
--      block (resource, unit, dates), the block must be active, the resource
--      must be a stay resource. The UPDATE guard refuses to release a block row
--      unless its block is already released, and an AFTER UPDATE trigger on the
--      block releases its rows in the same statement, so "block released <=>
--      its nights released" is a database invariant, not a handler convention.
--   4. The resource guard reports a booking_mode change under live allocations
--      as `BOOKING_MODE_IN_USE` (the `sql/186` body said `TIMEZONE_IN_USE` for
--      both, which hid which rule refused).
--   5. The instant bound on a reservation / item is widened from 366 / 367 to
--      368 days. The 366-NIGHT bound is a bound in dates (ADR-0135 section 2);
--      the derived arrival and departure instants of a 366-night stay can be up
--      to a day longer (a later check-out time than check-in time) plus an hour
--      of daylight-saving change, and a CHECK on instants must not refuse a stay
--      the date rule admits.
--
-- ## Nothing here weakens the constraint
--
-- The two exclusion constraints are untouched. A block row is `granularity =
-- 'stay'` with `stay_from` / `stay_to` set, so it sits under the stay constraint
-- (`daterange(stay_from, stay_to, '[)') WITH &&`, live rows only) together with
-- every guest's nights on the unit; whichever commits first wins and the other
-- receives 23P01. No override lifts it. Two overlapping blocks on one unit also
-- conflict (they share the constraint): release or shorten the first.
--
-- ## Not in this migration
--
-- No permission (the three `blocks.*` codes were seeded by `sql/181`), no table,
-- no extension, no function the job role may call. `sql/200` (the hold-expiry
-- sweep) needs no change: a stay hold expires on the same `hold_expires_at`
-- clock and its nights are released through the same item join; a block row has
-- no item and is never touched by it.

-- 1. A block row ---------------------------------------------------------------
ALTER TABLE awcms_booking_resource_allocations
  ADD COLUMN IF NOT EXISTS block_id uuid;

ALTER TABLE awcms_booking_resource_allocations
  ALTER COLUMN item_id DROP NOT NULL,
  ALTER COLUMN starts_at DROP NOT NULL,
  ALTER COLUMN ends_at DROP NOT NULL;

ALTER TABLE awcms_booking_resource_allocations
  ADD CONSTRAINT awcms_booking_resource_allocations_block_fkey
  FOREIGN KEY (tenant_id, block_id)
  REFERENCES awcms_booking_resource_blocks (tenant_id, id);

-- Leads with the foreign key's columns (db:fk-index:check) and makes a block own
-- at most one row per unit.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_resource_allocations_block_unit_key
  ON awcms_booking_resource_allocations (tenant_id, block_id, resource_unit_id)
  WHERE block_id IS NOT NULL;

-- Exactly one owner: a guest's item or a block.
ALTER TABLE awcms_booking_resource_allocations
  ADD CONSTRAINT awcms_booking_resource_allocations_owner_check
  CHECK (num_nonnulls(item_id, block_id) = 1);

-- The shape check of `sql/180`, with the block form. A time row needs its
-- instants EXPLICITLY (a NULL would make the old comparisons unknown, which a
-- CHECK passes); a block row is a stay row with NO instants.
ALTER TABLE awcms_booking_resource_allocations
  DROP CONSTRAINT awcms_booking_resource_allocations_shape_check;
ALTER TABLE awcms_booking_resource_allocations
  ADD CONSTRAINT awcms_booking_resource_allocations_shape_check
  CHECK (
    (granularity = 'time'
      AND item_id IS NOT NULL AND block_id IS NULL
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND occupied_from IS NOT NULL AND occupied_to IS NOT NULL
      AND occupied_from <= starts_at AND starts_at < ends_at
      AND ends_at <= occupied_to
      AND stay_from IS NULL AND stay_to IS NULL)
    OR (granularity = 'stay'
      AND item_id IS NOT NULL AND block_id IS NULL
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND occupied_from IS NULL AND occupied_to IS NULL
      AND starts_at < ends_at
      AND stay_from IS NOT NULL AND stay_to IS NOT NULL
      AND stay_from < stay_to AND stay_to - stay_from <= 366)
    OR (granularity = 'stay'
      AND item_id IS NULL AND block_id IS NOT NULL
      AND starts_at IS NULL AND ends_at IS NULL
      AND occupied_from IS NULL AND occupied_to IS NULL
      AND stay_from IS NOT NULL AND stay_to IS NOT NULL
      AND stay_from < stay_to AND stay_to - stay_from <= 366)
  );

-- 2. Release reasons -----------------------------------------------------------
-- A block row is released only by releasing its block, and only with that reason;
-- a guest's row never carries it.
ALTER TABLE awcms_booking_resource_allocations
  DROP CONSTRAINT awcms_booking_resource_allocations_reason_check;
ALTER TABLE awcms_booking_resource_allocations
  ADD CONSTRAINT awcms_booking_resource_allocations_reason_check
  CHECK (
    released_reason IS NULL
    OR (block_id IS NULL
        AND released_reason IN ('cancelled', 'expired', 'rescheduled'))
    OR (block_id IS NOT NULL AND released_reason = 'block_released')
  );

-- 3. Instant bounds ------------------------------------------------------------
ALTER TABLE awcms_booking_reservations
  DROP CONSTRAINT awcms_booking_reservations_interval_check;
ALTER TABLE awcms_booking_reservations
  ADD CONSTRAINT awcms_booking_reservations_interval_check
  CHECK (starts_at < ends_at AND ends_at - starts_at <= interval '368 days');

ALTER TABLE awcms_booking_reservation_items
  DROP CONSTRAINT awcms_booking_reservation_items_interval_check;
ALTER TABLE awcms_booking_reservation_items
  ADD CONSTRAINT awcms_booking_reservation_items_interval_check
  CHECK (starts_at < ends_at AND ends_at - starts_at <= interval '368 days');

-- 4. Allocation INSERT guard, with the block form -------------------------------
-- The `sql/180` body for a guest's row, unchanged, plus a block branch. Where it
-- reads a parent it takes FOR SHARE, so a concurrent change of that parent waits
-- for this insert (or this insert waits for it) instead of racing it.
CREATE OR REPLACE FUNCTION awcms_booking_guard_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  item awcms_booking_reservation_items%ROWTYPE;
  blk awcms_booking_resource_blocks%ROWTYPE;
  res_mode text;
  res_status text;
  res_deleted timestamptz;
  unit_status text;
  parent_status text;
BEGIN
  SELECT booking_mode, status, deleted_at
    INTO res_mode, res_status, res_deleted
  FROM awcms_booking_resources
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_id
  FOR SHARE;

  -- A block row: the resource says `stay`, the row says `stay`, and the row IS
  -- its block (resource, unit if named, dates). The unit's status is NOT checked:
  -- an inactive unit that is reactivated later must still be blocked.
  IF NEW.block_id IS NOT NULL THEN
    IF res_mode IS DISTINCT FROM 'stay' OR NEW.granularity <> 'stay' THEN
      RAISE EXCEPTION
        'awcms_booking: a blocked night belongs to a stay resource (resource %)',
        NEW.resource_id
        USING ERRCODE = '55000';
    END IF;

    SELECT * INTO blk
    FROM awcms_booking_resource_blocks
    WHERE tenant_id = NEW.tenant_id AND id = NEW.block_id
    FOR SHARE;

    IF blk.id IS NULL OR blk.status <> 'active' THEN
      RAISE EXCEPTION
        'awcms_booking: nights are blocked only under an active block (block %)',
        NEW.block_id
        USING ERRCODE = '55000';
    END IF;

    IF blk.resource_id <> NEW.resource_id
       OR (blk.resource_unit_id IS NOT NULL
           AND blk.resource_unit_id <> NEW.resource_unit_id)
       OR NEW.stay_from <> blk.block_from
       OR NEW.stay_to <> blk.block_to THEN
      RAISE EXCEPTION
        'awcms_booking: allocation disagrees with its block (block %)', NEW.block_id
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF res_status IS DISTINCT FROM 'active' OR res_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: resource % is inactive or deleted and cannot be allocated',
      NEW.resource_id
      USING ERRCODE = '55000';
  END IF;

  SELECT status INTO unit_status
  FROM awcms_booking_resource_units
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_unit_id
  FOR SHARE;

  IF unit_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'awcms_booking: unit % is not active and cannot be allocated',
      NEW.resource_unit_id
      USING ERRCODE = '55000';
  END IF;

  -- A live allocation exists only under a held or confirmed reservation. FOR
  -- SHARE: a concurrent cancel holds the reservation FOR UPDATE, so this insert
  -- waits for the verdict instead of reading a stale one.
  SELECT r.status INTO parent_status
  FROM awcms_booking_reservation_items i
  JOIN awcms_booking_reservations r
    ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
  WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id
  FOR SHARE OF r;

  IF parent_status IS NULL OR parent_status NOT IN ('held', 'confirmed') THEN
    RAISE EXCEPTION
      'awcms_booking: allocations may only be added to a held or confirmed reservation (item %)',
      NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  -- The resource says `slot`/`stay`, the allocation `time`/`stay`: one concept,
  -- two spellings (booking.md section 4), mapped here and nowhere else.
  IF (CASE res_mode WHEN 'slot' THEN 'time' ELSE res_mode END)
     IS DISTINCT FROM NEW.granularity THEN
    RAISE EXCEPTION
      'awcms_booking: allocation granularity % does not match resource booking_mode %',
      NEW.granularity, res_mode
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO item
  FROM awcms_booking_reservation_items
  WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;

  IF item.id IS NULL
     OR item.granularity <> NEW.granularity
     OR item.starts_at <> NEW.starts_at
     OR item.ends_at <> NEW.ends_at THEN
    RAISE EXCEPTION
      'awcms_booking: allocation disagrees with its item (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.granularity = 'time'
     AND (NEW.occupied_from <> item.starts_at - make_interval(secs => item.setup_seconds)
          OR NEW.occupied_to <> item.ends_at + make_interval(secs => item.cleanup_seconds)) THEN
    RAISE EXCEPTION
      'awcms_booking: allocation buffer does not equal the item snapshot (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.granularity = 'stay'
     AND (NEW.stay_from <> item.check_in_date OR NEW.stay_to <> item.check_out_date) THEN
    RAISE EXCEPTION
      'awcms_booking: allocation dates differ from the item stay (item %)', NEW.item_id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Allocation UPDATE guard, with the block form -------------------------------
-- Only `released_at` / `released_reason` may change, and only once. A block row
-- is released only when its block is: the block's own trigger (below) does it.
CREATE OR REPLACE FUNCTION awcms_booking_guard_allocation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: allocation % is already released', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['released_at', 'released_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['released_at', 'released_reason']) THEN
    RAISE EXCEPTION
      'awcms_booking: only released_at / released_reason may change on an allocation (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;
  -- Read only for a block row: a guest's row never reaches the blocks table, so
  -- the hold-expiry sweep (which owns no privilege on it) is unaffected. The
  -- query is NESTED under the IF rather than AND-ed into it on purpose: an
  -- expression with a subquery runs as a full SPI query whose permissions are
  -- checked at executor start, and with a generic plan (plan_cache_mode, or the
  -- plan cache switching after five calls) nothing folds `NULL IS NOT NULL` away
  -- first, so the sweep role would be refused SELECT on the blocks table.
  IF NEW.block_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM awcms_booking_resource_blocks b
      WHERE b.tenant_id = OLD.tenant_id AND b.id = OLD.block_id
        AND b.status = 'released'
    ) THEN
      RAISE EXCEPTION
        'awcms_booking: a blocked night is released only by releasing its block (%)',
        OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Releasing a block releases its nights --------------------------------------
-- AFTER UPDATE, in the statement that released the block: the two cannot be
-- separated by a handler that forgets the second half. Runs as the invoking role,
-- so RLS (FORCE) applies and only the session tenant's rows are touched.
CREATE OR REPLACE FUNCTION awcms_booking_release_block_allocations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE awcms_booking_resource_allocations
  SET released_at = clock_timestamp(), released_reason = 'block_released'
  WHERE tenant_id = NEW.tenant_id
    AND block_id = NEW.id
    AND released_at IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER awcms_booking_resource_blocks_release_nights
  AFTER UPDATE OF status ON awcms_booking_resource_blocks
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status = 'released')
  EXECUTE FUNCTION awcms_booking_release_block_allocations();

-- 7. Resource guard: which rule refused -----------------------------------------
-- The `sql/186` body, with the booking_mode refusal named for itself. The
-- timezone refusal keeps `TIMEZONE_IN_USE` (booking.md section 2.5, edge case 6).
CREATE OR REPLACE FUNCTION awcms_booking_guard_resource_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  in_use boolean;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
      RAISE EXCEPTION 'awcms_booking: TIMEZONE_INVALID: %', NEW.timezone
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.booking_mode IS DISTINCT FROM OLD.booking_mode
          OR (OLD.booking_mode = 'stay'
              AND NEW.timezone IS DISTINCT FROM OLD.timezone)) THEN
    in_use := EXISTS (
      SELECT 1 FROM awcms_booking_resource_allocations
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND released_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM awcms_booking_resource_blocks
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND status = 'active'
    );

    IF in_use AND NEW.booking_mode IS DISTINCT FROM OLD.booking_mode THEN
      RAISE EXCEPTION
        'awcms_booking: BOOKING_MODE_IN_USE: resource % has live allocations or blocks', OLD.id
        USING ERRCODE = '55000';
    END IF;

    IF in_use THEN
      RAISE EXCEPTION
        'awcms_booking: TIMEZONE_IN_USE: resource % has live allocations or blocks', OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    IF EXISTS (
      SELECT 1 FROM awcms_booking_schedules
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION
        'awcms_booking: SCHEDULE_TIMEZONE_MISMATCH: resource % has an active schedule in its current zone; deactivate it first',
        OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN awcms_booking_resource_allocations.block_id IS
  'Issue #940 / ADR-0135 -- set on a blocked-night row (no item, no instants), NULL on a guest''s row; exactly one of item_id / block_id. Under the same stay exclusion constraint as a guest''s nights.';
COMMENT ON TABLE awcms_booking_resource_blocks IS
  'Issue #938 / #940, ADR-0135 -- blocked nights of a stay resource, a HARD exclusion: one allocation row per affected unit under the stay exclusion constraint (a block never overrides a live stay and vice versa). Never deleted; released once, which releases its nights.';
