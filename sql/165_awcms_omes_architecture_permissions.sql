-- Issue ahliweb/omes#246 (part 3) — Architecture Control Center screen
-- permission catalog seed.
--
-- One new `omes_control` permission, `architecture.read`, guarding
-- `/admin/omes/arsitektur` (the read-only ADR-0017 layered
-- reference-architecture projection, sourced from the vendored
-- `architecture-capabilities-view` v1 contract). This is deliberately a NEW
-- permission rather than a reuse of `hermes_orchestration.read`: that
-- permission's family covers Hermes delegated-task/subagent orchestration
-- projections specifically, while this screen is a cross-cutting
-- planes/capabilities registry view (OMES, Hermes, Omarchy, AWCMS, and
-- provider authorities) with no overlap in audience or subject matter — see
-- module.ts's comment on this navigation entry.
--
-- No new schema/table migration accompanies this permission: the screen
-- renders a static, pinned, vendored JSON snapshot
-- (`src/modules/omes-control/contracts/v1/fixtures/
-- architecture-capabilities-view/valid-01-generated.json`), never a
-- database-backed projection, so there is no `awcms_omes_*` table to create.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent
-- via ON CONFLICT (module_key, activity_code, action) DO NOTHING.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omes_control', 'architecture', 'read', 'Read the pinned OMES layered reference-architecture capability snapshot')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
