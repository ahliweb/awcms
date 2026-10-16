-- `booking` consumes the hr_workforce `StaffAvailabilityPort` (Issue #949,
-- epic ahliweb/awcms-one#280 item 20; ADR-0131, ADR-0132, ADR-0011;
-- docs/awcms/booking.md section 10.3).
--
-- ## What this migration adds
--
--   1. `awcms_booking_resources.required_staff_refs` -- the OPAQUE references of
--      the people who can serve a resource. Empty (the default) means the
--      resource needs no staff and the staff path never runs. Booking never
--      resolves a reference: only the workforce port does.
--   2. `awcms_booking_staff_assignments` -- the person a claim is served by, one
--      row per (item, resource), written in the SAME savepoint as the unit
--      allocation. ONE exclusion constraint on (tenant, staff_ref, occupied
--      range) refuses two LIVE overlapping assignments of one person from any
--      writer, so a staff conflict between recorded claims is a database fact,
--      not a read-then-write guess. Its limits are stated, not hidden: it sees
--      only assignments that were WRITTEN (none are while `hr_workforce` is off
--      for the tenant), and a hold stays live until it is released, so the claim
--      path reclaims elapsed holds by staff reference first (no reaper needed). The
--      allocator wins units all-or-none first; if no eligible person can be
--      claimed the whole savepoint rolls back (nothing partial survives).
--   3. A release trigger on `awcms_booking_resource_allocations`: when the last
--      live allocation of an (item, resource) is released (cancel, expiry,
--      reschedule) its staff assignment is released with the same reason, so no
--      release path (request, lazy reclaim, the worker sweep of `sql/200`) needs
--      to know staff exists.
--   4. The lifecycle count function of `sql/303` learns the new table (the
--      worker may not read booking tables; count-only, column-scoped).
--
-- No personal data: `staff_ref` is an opaque text reference (an employment id
-- today), never a name. The table holds no price, payment state or customer.

ALTER TABLE awcms_booking_resources
  ADD COLUMN IF NOT EXISTS required_staff_refs text[] NOT NULL DEFAULT '{}';
ALTER TABLE awcms_booking_resources
  ADD CONSTRAINT awcms_booking_resources_staff_refs_check
  CHECK (cardinality(required_staff_refs) <= 50);

CREATE TABLE IF NOT EXISTS awcms_booking_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  item_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  staff_ref text NOT NULL,
  occupied_from timestamptz NOT NULL,
  occupied_to timestamptz NOT NULL,
  released_at timestamptz,
  released_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_staff_assignments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_booking_staff_assignments_ref_check
    CHECK (char_length(staff_ref) BETWEEN 1 AND 128),
  CONSTRAINT awcms_booking_staff_assignments_range_check
    CHECK (occupied_from < occupied_to),
  CONSTRAINT awcms_booking_staff_assignments_released_check
    CHECK ((released_at IS NULL) = (released_reason IS NULL)),
  CONSTRAINT awcms_booking_staff_assignments_reason_check
    CHECK (released_reason IS NULL
           OR released_reason IN ('cancelled', 'expired', 'rescheduled')),
  CONSTRAINT awcms_booking_staff_assignments_item_fkey
    FOREIGN KEY (tenant_id, item_id)
    REFERENCES awcms_booking_reservation_items (tenant_id, id),
  CONSTRAINT awcms_booking_staff_assignments_resource_fkey
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES awcms_booking_resources (tenant_id, id),
  -- A person serves one live, overlapping interval at a time (half-open).
  CONSTRAINT awcms_booking_staff_assignments_staff_excl
    EXCLUDE USING gist (
      tenant_id WITH =,
      staff_ref WITH =,
      tstzrange(occupied_from, occupied_to, '[)') WITH &&
    ) WHERE (released_at IS NULL)
);

-- One live person per claimed (item, resource).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_booking_staff_assignments_live_key
  ON awcms_booking_staff_assignments (tenant_id, item_id, resource_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_staff_assignments_item_idx
  ON awcms_booking_staff_assignments (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS awcms_booking_staff_assignments_resource_idx
  ON awcms_booking_staff_assignments (tenant_id, resource_id, occupied_from)
  WHERE released_at IS NULL;

ALTER TABLE awcms_booking_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_staff_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_staff_assignments_tenant_isolation
  ON awcms_booking_staff_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Only `released_at` / `released_reason` may change, and only once.
CREATE OR REPLACE FUNCTION awcms_booking_guard_staff_assignment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'awcms_booking: staff assignment % is already released', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['released_at', 'released_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['released_at', 'released_reason']) THEN
    RAISE EXCEPTION
      'awcms_booking: only released_at / released_reason may change on a staff assignment (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_staff_assignments_update_guard
  BEFORE UPDATE ON awcms_booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_staff_assignment_update();
CREATE TRIGGER awcms_booking_staff_assignments_no_delete
  BEFORE DELETE ON awcms_booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();

REVOKE DELETE, TRUNCATE ON awcms_booking_staff_assignments FROM awcms_app;

-- Release follows the allocation. SECURITY INVOKER on purpose: it runs with the
-- privileges and the tenant context of whoever released the allocation, so RLS
-- applies to it exactly as to the release itself (an owner-privileged function
-- would add a second, different RLS subject). The one non-request releaser, the
-- hold-expiry sweep of `sql/200` (the memberless `awcms_booking_expiry` role),
-- is given the narrow privilege it needs below.
CREATE OR REPLACE FUNCTION awcms_booking_release_staff_with_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.item_id IS NULL OR NEW.released_at IS NULL OR OLD.released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM awcms_booking_resource_allocations a
    WHERE a.tenant_id = NEW.tenant_id AND a.item_id = NEW.item_id
      AND a.resource_id = NEW.resource_id AND a.released_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE awcms_booking_staff_assignments s
  SET released_at = NEW.released_at, released_reason = NEW.released_reason
  WHERE s.tenant_id = NEW.tenant_id AND s.item_id = NEW.item_id
    AND s.resource_id = NEW.resource_id AND s.released_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_resource_allocations_release_staff
  AFTER UPDATE OF released_at ON awcms_booking_resource_allocations
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_release_staff_with_allocation();

GRANT SELECT, UPDATE (released_at, released_reason)
  ON awcms_booking_staff_assignments TO awcms_booking_expiry;

COMMENT ON TABLE awcms_booking_staff_assignments IS
  'Issue #949 / ADR-0131, ADR-0132 -- the person (opaque staff_ref, resolved only by the hr_workforce port) serving a claimed (item, resource). One exclusion constraint makes a double-booked person unrepresentable. Released with the allocation; never deleted; no name, price or customer.';

-- Lifecycle backlog count (pattern of `sql/303`): the new table, count-only.
GRANT SELECT (tenant_id, created_at) ON awcms_booking_staff_assignments TO awcms_booking_lifecycle_counter;

CREATE OR REPLACE FUNCTION awcms_booking_lifecycle_eligible_count(
  p_table text,
  p_tenant_id uuid,
  p_cutoff timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_table = 'awcms_booking_reservation_items' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_reservation_items AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_reservations' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_reservations AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_resource_allocations' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_resource_allocations AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_resource_blocks' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_resource_blocks AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_resource_pools' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_resource_pools AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_resource_units' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_resource_units AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_resources' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_resources AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_schedule_exceptions' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_schedule_exceptions AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_schedules' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_schedules AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_service_offerings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_service_offerings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_booking_staff_assignments' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_booking_staff_assignments AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_booking_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;
