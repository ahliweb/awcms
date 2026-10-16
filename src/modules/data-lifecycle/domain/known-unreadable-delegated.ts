/**
 * DELEGATED descriptors whose dry-run snapshot the worker cannot read
 * (Issue #1040). KNOWN, not accepted: shrink-only.
 *
 * `data-lifecycle:archive-purge` records a backlog snapshot for every delegated
 * descriptor, which `SELECT`s the descriptor's table as `awcms_worker`. Inventory,
 * procurement, HR and booking tables are data `awcms_worker` is deliberately NOT
 * granted `SELECT` on (the payroll boundary, #978 and #1014, exists to keep
 * worker roles away from that data). Until #1042 the job therefore recorded each
 * such snapshot as a `failed` dry-run and carried on.
 *
 * Issue #1042 landed the follow-up: a count-only SECURITY DEFINER function per
 * owning module (`sql/303`, sql/217 pattern), declared in
 * `DELEGATED_COUNT_FUNCTIONS` below. The planner calls it instead of
 * `SELECT`ing the table, so those tables left this list and it is now EMPTY.
 * The machinery stays: a future delegated descriptor that the worker may not
 * read and that has no count function is reported by the gate, and adding it
 * here is the (reviewed) last resort.
 *
 * Adding to it needs a reviewer to agree the worker should not read the table;
 * a stale entry (the table became readable, or is no longer delegated) fails
 * the gate so the list cannot rot into a lie.
 */
export const KNOWN_UNREADABLE_DELEGATED_TABLES: string[] = [];

/**
 * Delegated table -> the count-only SECURITY DEFINER function the dry-run
 * planner calls for that table's delegated descriptor (Issue #1042,
 * `sql/303`). Signature `(p_table text, p_tenant_id uuid, p_cutoff timestamptz)
 * RETURNS integer`; `EXECUTE` is granted to `awcms_worker` only.
 *
 * `data-lifecycle:worker-grants:check` proves, from `sql/`, that each named
 * function is granted to the worker and has a branch for the table. Names are interpolated into SQL as identifiers, so they must
 * match `COUNT_FUNCTION_PATTERN`.
 */
export const DELEGATED_COUNT_FUNCTIONS: Readonly<Record<string, string>> = {
  awcms_inventory_balances: "awcms_inventory_lifecycle_eligible_count",
  awcms_inventory_locations: "awcms_inventory_lifecycle_eligible_count",
  awcms_inventory_movements: "awcms_inventory_lifecycle_eligible_count",
  awcms_inventory_settings: "awcms_inventory_lifecycle_eligible_count",
  awcms_procurement_document_lines:
    "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_document_movements:
    "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_documents: "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_settings: "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_supplier_identifiers:
    "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_supplier_labels:
    "awcms_procurement_lifecycle_eligible_count",
  awcms_procurement_suppliers: "awcms_procurement_lifecycle_eligible_count",
  awcms_hr_employment_terms: "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_hr_shift_assignments: "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_hr_shift_templates: "awcms_hr_workforce_lifecycle_eligible_count",
  // Issue #970 (sql/306 replaces the function with four more branches).
  awcms_hr_geofences: "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_hr_geolocation_notices: "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_hr_geolocation_settings: "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_hr_geolocation_notice_acknowledgements:
    "awcms_hr_workforce_lifecycle_eligible_count",
  awcms_booking_reservation_items: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_reservations: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_resource_allocations: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_resource_blocks: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_resource_pools: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_resource_units: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_resources: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_schedule_exceptions: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_schedules: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_service_offerings: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_settings: "awcms_booking_lifecycle_eligible_count",
  awcms_booking_staff_assignments: "awcms_booking_lifecycle_eligible_count"
};

export const COUNT_FUNCTION_PATTERN =
  /^awcms_[a-z][a-z0-9_]*_lifecycle_eligible_count$/;
