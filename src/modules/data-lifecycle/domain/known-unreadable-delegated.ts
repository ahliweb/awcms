/**
 * DELEGATED descriptors whose dry-run snapshot the worker cannot read
 * (Issue #1040). KNOWN, not accepted: shrink-only.
 *
 * `data-lifecycle:archive-purge` records a backlog snapshot for every delegated
 * descriptor, which `SELECT`s the descriptor's table as `awcms_worker`. These
 * tables are inventory, procurement, HR and booking data, and `awcms_worker` is
 * deliberately NOT granted `SELECT` on them (the payroll boundary, #978 and
 * #1014, exists to keep worker roles away from that data). The job therefore
 * records each snapshot as a `failed` dry-run and carries on. The follow-up is a
 * count-only SECURITY DEFINER snapshot per owning module (sql/217 pattern),
 * after which entries leave this list.
 *
 * Adding to it needs a reviewer to agree the worker should not read the table;
 * a stale entry (the table became readable, or is no longer delegated) fails
 * the gate so the list cannot rot into a lie.
 */
export const KNOWN_UNREADABLE_DELEGATED_TABLES: readonly string[] = [
  "awcms_booking_reservation_items",
  "awcms_booking_reservations",
  "awcms_booking_resource_allocations",
  "awcms_booking_resource_blocks",
  "awcms_booking_resource_pools",
  "awcms_booking_resource_units",
  "awcms_booking_resources",
  "awcms_booking_schedule_exceptions",
  "awcms_booking_schedules",
  "awcms_booking_service_offerings",
  "awcms_booking_settings",
  "awcms_hr_employment_terms",
  "awcms_hr_shift_assignments",
  "awcms_hr_shift_templates",
  "awcms_inventory_balances",
  "awcms_inventory_locations",
  "awcms_inventory_movements",
  "awcms_inventory_settings",
  "awcms_procurement_document_lines",
  "awcms_procurement_document_movements",
  "awcms_procurement_documents",
  "awcms_procurement_settings",
  "awcms_procurement_supplier_identifiers",
  "awcms_procurement_supplier_labels",
  "awcms_procurement_suppliers"
];
