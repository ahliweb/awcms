-- Issue #171 (Admin UI: complete write/CRUD actions) — seed the
-- `tenant_admin.office_management.delete` permission that gates the new office
-- soft-delete endpoint (`DELETE /api/v1/offices/{id}`).
--
-- WHY A SEPARATE SEED MIGRATION: `awcms_offices` already carries the
-- soft-delete columns (`deleted_at`/`deleted_by`/`delete_reason`), so no schema
-- change is needed — but the permission CATALOG in sql/005 seeded
-- `office_management` with only `read`/`create`/`update`. The owner role is
-- granted every row of `awcms_permissions` at bootstrap
-- (`platform-bootstrap.ts`), and the e2e-smoke seed runs migrations THEN
-- `POST /setup/initialize` with no module permission-sync in between — so a
-- guard on an un-seeded action would default-deny even the owner. Declaring the
-- action in `tenant-admin/module.ts` alone is not enough; it must exist as a
-- catalog row before bootstrap. sql/005 is an APPLIED, immutable migration, so
-- the row is added here as a forward migration (idempotent) instead of editing
-- it. This mirrors the `profile_management.delete` precedent already seeded in
-- sql/005 and keeps the module descriptor and DB catalog in agreement.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('tenant_admin', 'office_management', 'delete', 'Soft-delete office records')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
