-- `hr_workforce` workforce metrics permission catalog seed (Issue #953,
-- `docs/awcms/workforce-metrics.md`).
--
-- Verbatim match to `src/modules/hr-workforce/domain/hr-workforce-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_workforce/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why two powers, and who holds neither
--
--   * `workforce_metrics.read` is the HR power: the transparent attendance, hours,
--     shift-coverage and productivity FACTS of any employee, and the tenant-wide
--     event-volume projection. An employee reads their OWN facts and a supervisor
--     their DIRECT reports' without it, through an `ownershipGrant` (ADR-0063)
--     computed from the persisted login link and the current manager link; the
--     grant widens only this READ and never applies to a machine credential.
--   * `workforce_metrics.analyze` is the AGGREGATE power: per-office group
--     figures, every group passed through small-group suppression (fewer than
--     five contributing employees returns no number at all). It exists so a
--     manager or executive who is NOT HR can be shown how a site is staffed
--     without being shown any individual -- which is only worth anything if the
--     aggregate cannot be narrowed to one person, hence the suppression.
--     It reads no individual row out. `analyze` is the platform's read-only
--     analysis action (not high-risk, like a dry-run).
--
-- Neither key implies `attendance.read`, `corrections.read` or any
-- compensation, commission or payroll power, and nothing here grants a location,
-- photo, biometric or device power: none of those exists (owner decision O6,
-- ADR-0138). Nothing grants these keys to any role; HR is a role a tenant builds.
--
-- ## The cursor index
--
-- The `hr_workforce.attendance_events` reporting projection polls the events
-- table in `recorded_at` order (the database's insert-time clock; `occurred_at`
-- is a CLAIMED instant and an offline replay writes it in the past, so it cannot
-- be a cursor). Without an index leading with `tenant_id, recorded_at` every
-- pass of `reporting:projections:refresh` would scan the whole table per tenant.
-- `awcms_worker` already holds SELECT on the table (`sql/280`); nothing to grant.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` (the limitation every permission-seed migration carries --
-- see sql/170). An EXISTING tenant 403s until an operator grants them; run
-- `bun run identity-access:permissions:backfill` (dry-run by default,
-- `--tenant <code>`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_workforce', 'workforce_metrics', 'read',
   'Read the attendance, hours, shift-coverage and productivity facts of any employee, and the workforce event-volume projection; an employee reads their own and a supervisor their direct reports'' without this'),
  ('hr_workforce', 'workforce_metrics', 'analyze',
   'Read per-office workforce aggregates; a group with fewer than five contributing employees is withheld entirely')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

CREATE INDEX IF NOT EXISTS awcms_hr_attendance_events_recorded_idx
  ON awcms_hr_attendance_events (tenant_id, recorded_at);
