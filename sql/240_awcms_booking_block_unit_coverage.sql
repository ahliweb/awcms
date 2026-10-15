-- `booking` blocks: a resource-wide block covers units added LATER (Issue #1012,
-- finding N1 of the #940 review; docs/awcms/booking.md sections 4 and 8.1 rule 7).
--
-- ## The gap this closes
--
-- A resource-wide block (`resource_unit_id IS NULL`) is stored as one allocation
-- row per unit THAT EXISTS when it is placed (`sql/204`). Availability reads the
-- blocks table and treats a NULL unit as covering every unit, so a unit added
-- afterwards was reported `BLOCKED` while `placeHold` could still win it: the
-- exclusion constraint only sees rows, and the new unit had none. The same hole
-- opened for a unit inserted concurrently with the block, because the block
-- service read the unit list without a lock.
--
-- ## The fix, in two halves that must agree
--
--   1. An AFTER INSERT trigger on `awcms_booking_resource_units` inserts one
--      block row, for the new unit, for every ACTIVE resource-wide block on its
--      resource. A new unit has no allocations, so the rows cannot conflict with
--      a guest's nights; two active resource-wide blocks cannot overlap on any
--      unit (they would already have conflicted on the existing ones), so they
--      cannot conflict with each other. A conflict that nevertheless occurs
--      raises 23P01 and rolls the unit insert back: loud, never silent. The unit
--      status is not consulted (as in `sql/204`: a unit put back in service later
--      is still blocked).
--   2. The trigger first takes the RESOURCE row `FOR NO KEY UPDATE`. The block
--      guard (`sql/186`), every allocation guard (`sql/204`) and the block
--      service's `readBlockUnits` take it `FOR SHARE`, which that mode
--      conflicts with. So a unit insert and a block insert/claim serialise on
--      the resource, and READ COMMITTED gives the statement that follows the
--      lock a fresh snapshot:
--        * unit commits first   -> the block's unit read sees the new unit;
--        * block commits first  -> the trigger's block read sees the block.
--      Neither order leaves a unit uncovered. (`FOR NO KEY UPDATE`, not `FOR
--      UPDATE`, so the foreign-key checks of unit and allocation inserts, which
--      take `FOR KEY SHARE`, do not queue behind it.)
--
-- Runs as the invoking role: RLS (FORCE) applies, only the session tenant's rows
-- are touched, and no privilege is added. The reconciliation check
-- `block_missing_allocation` stays as the after-the-fact detector for a direct
-- write that bypassed this trigger.

CREATE OR REPLACE FUNCTION awcms_booking_cover_new_unit_with_blocks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Its own statement, so the INSERT below takes a snapshot AFTER the wait.
  PERFORM 1
  FROM awcms_booking_resources
  WHERE tenant_id = NEW.tenant_id AND id = NEW.resource_id
  FOR NO KEY UPDATE;

  INSERT INTO awcms_booking_resource_allocations
    (tenant_id, block_id, resource_id, resource_unit_id, granularity,
     stay_from, stay_to)
  SELECT b.tenant_id, b.id, b.resource_id, NEW.id, 'stay',
         b.block_from, b.block_to
  FROM awcms_booking_resource_blocks b
  WHERE b.tenant_id = NEW.tenant_id
    AND b.resource_id = NEW.resource_id
    AND b.resource_unit_id IS NULL
    AND b.status = 'active'
  ORDER BY b.id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER awcms_booking_resource_units_cover_blocks
  AFTER INSERT ON awcms_booking_resource_units
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_cover_new_unit_with_blocks();

COMMENT ON FUNCTION awcms_booking_cover_new_unit_with_blocks() IS
  'Issue #1012 / N1 -- a unit added to a resource gets a block row for every active resource-wide block on it, after locking the resource FOR NO KEY UPDATE (serialises with block placement, which takes it FOR SHARE).';
