-- `booking` availability slice: schedule integrity and blocked nights (Issue
-- #938, ADR-0131 as amended by ADR-0135; booking.md section 2.2, 2.5 and 4).
--
-- ## What this migration adds
--
--   1. `awcms_booking_resource_blocks` -- the blocked nights of a STAY resource,
--      the table `sql/180` recorded as a follow-up. Availability reads it as a
--      HARD exclusion. The allocation rows a block will also claim (so the stay
--      exclusion constraint covers a block against a reservation) arrive with
--      the allocator (Issue #939), which is also what writes blocks; until then
--      nothing in the application inserts into this table.
--   2. The schedule integrity the empty shells of `sql/180` deferred: a closed
--      `rules` shape, ONE active schedule per scope and date (an exclusion
--      constraint -- the same non-overlap the pure `effectiveRangesOverlap`
--      states), a zone that must agree with the resource it is bound to, and a
--      "supersede, do not edit" update guard.
--   3. A resource guard that also refuses a booking_mode / timezone change while
--      the resource has a live block or an active bound schedule (the guard of
--      `sql/180` only looked at allocations).
--
-- Triggers here and the pure functions in `src/modules/booking/domain/` state the
-- same rules; tests/integration/booking-availability.integration.test.ts asserts
-- they agree. Where a guard reads a parent row it takes FOR SHARE, so a
-- concurrent change of that parent waits for the verdict instead of racing it.

-- 1. Blocked nights -----------------------------------------------------------
-- `resource_unit_id` NULL = every unit of the resource. Dates are LOCAL dates in
-- the resource's zone, half-open `[block_from, block_to)`; `reason_code` is a
-- closed list (no free text, no personal data).
CREATE TABLE IF NOT EXISTS awcms_booking_resource_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  resource_id uuid NOT NULL,
  resource_unit_id uuid,
  block_from date NOT NULL,
  block_to date NOT NULL,
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  released_at timestamptz,
  released_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_booking_resource_blocks_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_resource_blocks_window_check
    CHECK (block_from < block_to AND block_to - block_from <= 366),
  CONSTRAINT awcms_booking_resource_blocks_reason_check
    CHECK (reason_code IN ('maintenance', 'owner_use', 'other')),
  CONSTRAINT awcms_booking_resource_blocks_status_check
    CHECK (status IN ('active', 'released')),
  CONSTRAINT awcms_booking_resource_blocks_released_check
    CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CONSTRAINT awcms_booking_resource_blocks_resource_fkey
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES awcms_booking_resources (tenant_id, id),
  -- A named unit must belong to the resource (and so to this tenant).
  CONSTRAINT awcms_booking_resource_blocks_unit_fkey
    FOREIGN KEY (tenant_id, resource_id, resource_unit_id)
    REFERENCES awcms_booking_resource_units (tenant_id, resource_id, id),
  CONSTRAINT awcms_booking_resource_blocks_created_by_fkey
    FOREIGN KEY (tenant_id, created_by) REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_booking_resource_blocks_released_by_fkey
    FOREIGN KEY (tenant_id, released_by) REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_booking_resource_blocks_resource_idx
  ON awcms_booking_resource_blocks (tenant_id, resource_id, block_from)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS awcms_booking_resource_blocks_unit_idx
  ON awcms_booking_resource_blocks (tenant_id, resource_id, resource_unit_id)
  WHERE resource_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resource_blocks_created_by_idx
  ON awcms_booking_resource_blocks (tenant_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_resource_blocks_released_by_idx
  ON awcms_booking_resource_blocks (tenant_id, released_by) WHERE released_by IS NOT NULL;

ALTER TABLE awcms_booking_resource_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_resource_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_resource_blocks_tenant_isolation
  ON awcms_booking_resource_blocks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- A block exists only on a live, active STAY resource. FOR SHARE: a concurrent
-- booking_mode / status change takes the row for UPDATE and waits for this insert.
CREATE OR REPLACE FUNCTION awcms_booking_guard_block_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  res_mode text;
  res_status text;
  res_deleted timestamptz;
BEGIN
  SELECT booking_mode, status, deleted_at
    INTO res_mode, res_status, res_deleted
  FROM awcms_booking_resources
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_id
  FOR SHARE;

  IF res_mode IS DISTINCT FROM 'stay'
     OR res_status IS DISTINCT FROM 'active'
     OR res_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_booking: a block is placed on an active stay resource (resource %)',
      NEW.resource_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'awcms_booking: a block is created active'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resource_blocks_insert_guard
  BEFORE INSERT ON awcms_booking_resource_blocks
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_block_insert();

-- Only `status` -> released (with released_at / released_by), once.
CREATE OR REPLACE FUNCTION awcms_booking_guard_block_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'awcms_booking: block % is already released', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'released_at', 'released_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'released_at', 'released_by'])
     OR NEW.status <> 'released' THEN
    RAISE EXCEPTION
      'awcms_booking: only a release (status, released_at, released_by) may change on a block (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resource_blocks_update_guard
  BEFORE UPDATE ON awcms_booking_resource_blocks
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_block_update();
CREATE TRIGGER awcms_booking_resource_blocks_no_delete
  BEFORE DELETE ON awcms_booking_resource_blocks
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();

REVOKE DELETE, TRUNCATE ON awcms_booking_resource_blocks FROM awcms_app;

-- 2. Schedule integrity -------------------------------------------------------
-- The only top-level key a schedule's `rules` may hold is `weekly` (the closed
-- schema's stricter shape check lives in the validator; this one CAN be stated
-- in SQL so a direct write cannot store a free-form object or an RRULE string).
ALTER TABLE awcms_booking_schedules
  ADD CONSTRAINT awcms_booking_schedules_rules_keys_check
  CHECK ((rules - 'weekly') = '{}'::jsonb);

-- At most ONE active schedule covers a date per (tenant, resource-or-default):
-- a new effective window supersedes rather than overlaps. `daterange` is
-- half-open and a NULL end is unbounded, exactly `effectiveRangesOverlap`.
ALTER TABLE awcms_booking_schedules
  ADD CONSTRAINT awcms_booking_schedules_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    (COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'active');

-- Exceptions span at most 366 days (the expansion cap, booking.md section 2.4).
ALTER TABLE awcms_booking_schedule_exceptions
  ADD CONSTRAINT awcms_booking_schedule_exceptions_span_check
  CHECK (local_to - local_from <= 366);

CREATE OR REPLACE FUNCTION awcms_booking_guard_schedule_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  res_timezone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
      RAISE EXCEPTION 'awcms_booking: TIMEZONE_INVALID: %', NEW.timezone
        USING ERRCODE = '22023';
    END IF;

    -- A schedule bound to a resource is written in THAT resource's zone; FOR
    -- SHARE so a concurrent timezone change waits for this insert.
    IF NEW.resource_id IS NOT NULL THEN
      SELECT timezone INTO res_timezone
      FROM awcms_booking_resources
      WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_id
      FOR SHARE;

      IF res_timezone IS DISTINCT FROM NEW.timezone THEN
        RAISE EXCEPTION
          'awcms_booking: SCHEDULE_TIMEZONE_MISMATCH: schedule % vs resource %',
          NEW.timezone, res_timezone
          USING ERRCODE = '22023';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: a new window supersedes rather than edits. The only changes are
  -- shortening `effective_to` and deactivating (active -> inactive, once).
  IF (to_jsonb(NEW) - ARRAY['effective_to', 'status', 'updated_at', 'updated_by'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['effective_to', 'status', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION
      'awcms_booking: a schedule is superseded, not edited; only effective_to (shortened) and status (deactivated) may change (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'inactive') THEN
    RAISE EXCEPTION 'awcms_booking: schedule % cannot be reactivated; create a new window', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
     AND (NEW.effective_to IS NULL
          OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to)) THEN
    RAISE EXCEPTION 'awcms_booking: effective_to may only be shortened (%)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_schedules_write_guard
  BEFORE INSERT OR UPDATE ON awcms_booking_schedules
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_schedule_write();

-- 3. Resource guard, extended -------------------------------------------------
-- The `sql/180` body plus: booking_mode / timezone cannot change while the
-- resource has a live block (stay) or an active schedule bound to it (whose zone
-- must equal the resource's). Same trigger, same name, `CREATE OR REPLACE`.
CREATE OR REPLACE FUNCTION awcms_booking_guard_resource_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
    IF EXISTS (
      SELECT 1 FROM awcms_booking_resource_allocations
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND released_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM awcms_booking_resource_blocks
      WHERE tenant_id = OLD.tenant_id AND resource_id = OLD.id
        AND status = 'active'
    ) THEN
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

COMMENT ON TABLE awcms_booking_resource_blocks IS
  'Issue #938 / ADR-0135 -- blocked nights of a stay resource, a HARD exclusion for availability. Never deleted; released once. Written by the allocator slice (#939).';

-- 4. Offering step floor ------------------------------------------------------
-- A slot step finer than five minutes has no booking meaning (the finest real
-- grain is a five-minute appointment) and only multiplies the candidates one
-- availability search evaluates (a 31-day window at 1 s would be 2.7 million).
-- `sql/180` is immutable, so its CHECK is replaced here; the offering validator
-- (`AVAILABILITY_LIMITS.minSlotStepSeconds`, `validateSlotStepSeconds`) states the same floor.
ALTER TABLE awcms_booking_service_offerings
  DROP CONSTRAINT awcms_booking_service_offerings_shape_check;
ALTER TABLE awcms_booking_service_offerings
  ADD CONSTRAINT awcms_booking_service_offerings_shape_check
  CHECK (
    (granularity = 'time'
      AND duration_seconds IS NOT NULL AND duration_seconds > 0
      AND setup_seconds IS NOT NULL AND setup_seconds >= 0
      AND cleanup_seconds IS NOT NULL AND cleanup_seconds >= 0
      AND slot_step_seconds IS NOT NULL AND slot_step_seconds >= 300
      AND min_nights IS NULL AND max_nights IS NULL)
    OR (granularity = 'stay'
      AND duration_seconds IS NULL AND setup_seconds IS NULL
      AND cleanup_seconds IS NULL AND slot_step_seconds IS NULL
      AND min_nights IS NOT NULL AND min_nights >= 1
      AND max_nights IS NOT NULL AND max_nights BETWEEN min_nights AND 366)
  ) NOT VALID; -- new and changed rows are held; no row of this unreachable table is re-scanned

-- 5. Duplicate exceptions -----------------------------------------------------
-- A retried create of the same closure is a 409, not a second row. NULL owners
-- are folded to the zero uuid so the index is one rule for both owner kinds.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_schedule_exceptions_dedupe_key
  ON awcms_booking_schedule_exceptions (
    tenant_id,
    COALESCE(schedule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind, local_from, local_to
  );
