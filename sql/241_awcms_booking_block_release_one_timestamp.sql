-- `booking` blocks: one release timestamp (Issue #1012, finding N4 of the #940
-- review; docs/awcms/booking.md section 4).
--
-- `sql/204` released a block's nights with their own `clock_timestamp()`, so the
-- block's `released_at` and its rows' differed by microseconds. The AFTER UPDATE
-- trigger now copies the block's `released_at` onto its rows: one release, one
-- instant. Behaviour is otherwise unchanged (same predicate, same reason).
CREATE OR REPLACE FUNCTION awcms_booking_release_block_allocations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE awcms_booking_resource_allocations
  SET released_at = NEW.released_at, released_reason = 'block_released'
  WHERE tenant_id = NEW.tenant_id
    AND block_id = NEW.id
    AND released_at IS NULL;
  RETURN NULL;
END;
$$;
