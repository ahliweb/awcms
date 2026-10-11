-- `booking` permission catalog seed (Issue #937, ADR-0131).
--
-- Verbatim match to `src/modules/booking/domain/booking-permissions.ts` and to
-- `module.ts`'s `permissions` array (`GET /api/v1/modules/booking/permissions`
-- reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are (booking.md section 6)
--
--   * `reservations.create` / `.confirm` / `.cancel` are the everyday verbs and
--     are separately grantable, so a maker/checker rule can separate placing a
--     hold from confirming it.
--   * `reservations.reschedule` / `.check_in` / `.complete` / `.no_show` are the
--     other transitions. Each is reversible by cancel or compensated by an
--     event, so none is high-risk.
--   * `reservations.override` lifts a business rule (book or reschedule outside
--     schedule hours or lead time). HIGH-RISK; it NEVER overrides the exclusion
--     constraint.
--   * `reservation_notes.read` reads the redacted customer note: an audited read.
--   * `blocks.create` removes sellable inventory (stay resources).
--   * `policy.configure` changes holds, lead time, horizon and no-show grace.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` (the limitation every permission-seed migration carries, see
-- sql/170). An EXISTING tenant 403s until an operator grants them; run
-- `bun run identity-access:permissions:backfill` (dry-run by default,
-- `--tenant <code>`). Nothing here grants any permission to any role.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('booking', 'resources', 'read',
   'Read resources, their capacity units and resource pools'),
  ('booking', 'resources', 'create',
   'Create a resource (and its capacity units) or a resource pool'),
  ('booking', 'resources', 'update',
   'Edit a resource, its units or a resource pool'),
  ('booking', 'resources', 'delete',
   'Soft-delete a resource or a resource pool (reservations keep referencing it)'),
  ('booking', 'resources', 'restore',
   'Restore a soft-deleted resource or resource pool'),
  ('booking', 'offerings', 'read',
   'Read service offerings'),
  ('booking', 'offerings', 'create',
   'Create a service offering'),
  ('booking', 'offerings', 'update',
   'Edit a service offering'),
  ('booking', 'offerings', 'delete',
   'Soft-delete a service offering (reservations keep their snapshot)'),
  ('booking', 'offerings', 'restore',
   'Restore a soft-deleted service offering'),
  ('booking', 'schedules', 'read',
   'Read schedules and schedule exceptions'),
  ('booking', 'schedules', 'create',
   'Create a schedule or a schedule exception'),
  ('booking', 'schedules', 'update',
   'Edit a schedule or a schedule exception'),
  ('booking', 'schedules', 'delete',
   'Delete a schedule exception or deactivate a schedule'),
  ('booking', 'blocks', 'read',
   'Read blocked nights of stay resources'),
  ('booking', 'blocks', 'create',
   'Block nights of a stay resource; removes sellable inventory'),
  ('booking', 'blocks', 'release',
   'Release a block and return its nights to sale'),
  ('booking', 'availability', 'read',
   'Search availability and quote a slot or stay; persists nothing'),
  ('booking', 'reservations', 'read',
   'Read reservations, items, allocations and the transition history (the customer note excluded)'),
  ('booking', 'reservation_notes', 'read',
   'Read the redacted customer note of a reservation; audited'),
  ('booking', 'reservations', 'create',
   'Place a hold or create a reservation'),
  ('booking', 'reservations', 'confirm',
   'Confirm a held reservation'),
  ('booking', 'reservations', 'cancel',
   'Cancel a held or confirmed reservation and release its allocations'),
  ('booking', 'reservations', 'reschedule',
   'Reschedule a confirmed reservation into a new one, preserving the lineage'),
  ('booking', 'reservations', 'check_in',
   'Mark a confirmed reservation as checked in'),
  ('booking', 'reservations', 'complete',
   'Mark a checked-in reservation as completed'),
  ('booking', 'reservations', 'no_show',
   'Mark a confirmed reservation as a no-show after its start plus the grace period'),
  ('booking', 'reservations', 'override',
   'Book or reschedule outside schedule hours or lead time; never overrides an allocation conflict; high-risk'),
  ('booking', 'reservations', 'reconcile',
   'Run the read-only reconciliation of reservations against their allocations'),
  ('booking', 'policy', 'read',
   'Read the hold, lead-time, horizon and no-show-grace policy'),
  ('booking', 'policy', 'configure',
   'Change the hold, lead-time, horizon and no-show-grace policy'),
  ('booking', 'reports', 'read',
   'Read occupancy, utilization and reservation aggregates')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
