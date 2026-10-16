-- Count-only retention-backlog functions for the delegated lifecycle descriptors
-- the worker may not read (Issue #1042, follow-up to #1040; pattern `sql/217`).
--
-- ## The problem
--
-- `data-lifecycle:archive-purge` records a dry-run backlog snapshot for every
-- delegated descriptor as `awcms_worker`. Twenty-five inventory, procurement,
-- HR-workforce and booking tables are deliberately NOT readable by that role
-- (the payroll boundary, #978/#1014: a cron job should not be able to read
-- stock, supplier, shift or reservation data). Those snapshots failed with
-- 42501 on every run and were carried as a known-unreadable baseline (#1040),
-- so operators had no retention-backlog visibility for them.
--
-- ## What this adds
--
-- One SECURITY DEFINER function per owning module. Each takes
-- `(p_table, p_tenant_id, p_cutoff)` and returns ONE integer: how many rows of
-- that table belong to the tenant and are older than the cutoff. Held,
-- purgeable and blocked are derived by the planner (TypeScript) from that
-- number plus the legal-hold records it already holds, so no hold key crosses
-- into SQL. Every one of these 25 descriptors is non-archivable, so eligible
-- is also purgeable (the planner's own rule).
--
-- ## Safeguards (the sql/217 list, restated)
--
--   1. A dedicated NOLOGIN, NOSUPERUSER, NOBYPASSRLS owner role per module with
--      NO members, so nothing outside the function can act as it.
--   2. COLUMN-level SELECT on exactly (tenant_id, cursor column) of that
--      module's tables. Even a defect in the function could not read a
--      quantity, a price, a supplier name or a pay term.
--   3. NO policy is added and RLS is untouched. The function runs in the
--      caller's tenant transaction and its owner is NOBYPASSRLS, so the
--      FORCE'd tenant-isolation policy compares the caller's own
--      `app.current_tenant_id`; the function additionally filters on
--      `p_tenant_id`. The worker already iterates every tenant, one tenant
--      context at a time, so this adds no capability beyond that existing
--      per-tenant iteration. It is NOT a boundary against the worker.
--   4. Static SQL only: one branch per table; an unknown table name raises
--      22023. No dynamic SQL, so the argument cannot select a table that is
--      not in the list.
--   5. Returns an integer, never a row.
--   6. `SET search_path = public, pg_temp` (db:function-search-path:check).
--   7. EXECUTE revoked from PUBLIC and granted to `awcms_worker` only.
--   8. STABLE: it only reads.
--
-- No table in the list is a payroll table (`payroll:sql-boundary:check` stays
-- green), and no payroll relation is reachable: the worker gains an integer
-- per tenant and table, not a row and not a column.

-- ===== inventory =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_inventory_lifecycle_counter') THEN
    CREATE ROLE awcms_inventory_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_inventory_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_inventory_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_inventory_balances TO awcms_inventory_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_inventory_locations TO awcms_inventory_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_inventory_movements TO awcms_inventory_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_inventory_settings TO awcms_inventory_lifecycle_counter;

CREATE OR REPLACE FUNCTION awcms_inventory_lifecycle_eligible_count(
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
  IF p_table = 'awcms_inventory_balances' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_inventory_balances AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_inventory_locations' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_inventory_locations AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_inventory_movements' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_inventory_movements AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_inventory_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_inventory_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_inventory_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_inventory_lifecycle_eligible_count(text, uuid, timestamptz) IS
  '#1042. Count-only retention-backlog read for the inventory lifecycle descriptors: how many rows of the named table (one of this module''s, anything else raises 22023) belong to the tenant and are older than the cutoff. Returns one integer, never a row. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE with a NOBYPASSRLS owner) plus p_tenant_id; it adds no capability beyond the worker''s existing per-tenant iteration and is not a boundary against the worker. The owner role holds column-level SELECT on (tenant_id, cursor column) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_inventory_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_inventory_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_inventory_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_inventory_lifecycle_counter;

-- ===== procurement =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_procurement_lifecycle_counter') THEN
    CREATE ROLE awcms_procurement_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_procurement_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_document_lines TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_document_movements TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_documents TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_settings TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_supplier_identifiers TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_supplier_labels TO awcms_procurement_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_procurement_suppliers TO awcms_procurement_lifecycle_counter;

CREATE OR REPLACE FUNCTION awcms_procurement_lifecycle_eligible_count(
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
  IF p_table = 'awcms_procurement_document_lines' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_document_lines AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_document_movements' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_document_movements AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_documents' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_documents AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_settings' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_settings AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_supplier_identifiers' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_supplier_identifiers AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_supplier_labels' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_supplier_labels AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_procurement_suppliers' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_procurement_suppliers AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_procurement_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_procurement_lifecycle_eligible_count(text, uuid, timestamptz) IS
  '#1042. Count-only retention-backlog read for the procurement lifecycle descriptors: how many rows of the named table (one of this module''s, anything else raises 22023) belong to the tenant and are older than the cutoff. Returns one integer, never a row. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE with a NOBYPASSRLS owner) plus p_tenant_id; it adds no capability beyond the worker''s existing per-tenant iteration and is not a boundary against the worker. The owner role holds column-level SELECT on (tenant_id, cursor column) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_procurement_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_procurement_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_procurement_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_procurement_lifecycle_counter;

-- ===== hr_workforce =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_hr_workforce_lifecycle_counter') THEN
    CREATE ROLE awcms_hr_workforce_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_hr_workforce_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_hr_employment_terms TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, starts_at) ON awcms_hr_shift_assignments TO awcms_hr_workforce_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_hr_shift_templates TO awcms_hr_workforce_lifecycle_counter;

CREATE OR REPLACE FUNCTION awcms_hr_workforce_lifecycle_eligible_count(
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
  IF p_table = 'awcms_hr_employment_terms' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_employment_terms AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_shift_assignments' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_shift_assignments AS x
    WHERE x.tenant_id = p_tenant_id AND x.starts_at < p_cutoff;
  ELSIF p_table = 'awcms_hr_shift_templates' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_hr_shift_templates AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;
  ELSE
    RAISE EXCEPTION 'awcms_hr_workforce_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) IS
  '#1042. Count-only retention-backlog read for the hr_workforce lifecycle descriptors: how many rows of the named table (one of this module''s, anything else raises 22023) belong to the tenant and are older than the cutoff. Returns one integer, never a row. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE with a NOBYPASSRLS owner) plus p_tenant_id; it adds no capability beyond the worker''s existing per-tenant iteration and is not a boundary against the worker. The owner role holds column-level SELECT on (tenant_id, cursor column) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_hr_workforce_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_hr_workforce_lifecycle_counter;

-- ===== booking =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_booking_lifecycle_counter') THEN
    CREATE ROLE awcms_booking_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_booking_lifecycle_counter NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_reservation_items TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_reservations TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_resource_allocations TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_resource_blocks TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_resource_pools TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_resource_units TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_resources TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_schedule_exceptions TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_schedules TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_service_offerings TO awcms_booking_lifecycle_counter;
GRANT SELECT (tenant_id, created_at) ON awcms_booking_settings TO awcms_booking_lifecycle_counter;

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
  ELSE
    RAISE EXCEPTION 'awcms_booking_lifecycle_eligible_count: table is not one of this module''s lifecycle descriptors'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION awcms_booking_lifecycle_eligible_count(text, uuid, timestamptz) IS
  '#1042. Count-only retention-backlog read for the booking lifecycle descriptors: how many rows of the named table (one of this module''s, anything else raises 22023) belong to the tenant and are older than the cutoff. Returns one integer, never a row. Tenant scoping relies on the caller''s own app.current_tenant_id (RLS FORCE with a NOBYPASSRLS owner) plus p_tenant_id; it adds no capability beyond the worker''s existing per-tenant iteration and is not a boundary against the worker. The owner role holds column-level SELECT on (tenant_id, cursor column) only. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_booking_lifecycle_eligible_count(text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_booking_lifecycle_eligible_count(text, uuid, timestamptz) TO awcms_worker;
ALTER FUNCTION awcms_booking_lifecycle_eligible_count(text, uuid, timestamptz) OWNER TO awcms_booking_lifecycle_counter;
