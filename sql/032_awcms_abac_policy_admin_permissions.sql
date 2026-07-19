-- Issue #179 (epic #177, Wave 2 authorization) — permission catalog rows for
-- the DSL ABAC policy authoring + read-only simulation admin surface
-- (`/api/v1/access/policies/*`). Ported from awcms-mini migration 082
-- (`082_awcms_mini_abac_policy_admin_permissions.sql`, same issue). Seeded here
-- (mirroring how sql/005 seeds identity_access's other permissions directly,
-- rather than via a module descriptor `permissions` array which this module
-- does not use) so the new endpoints are reachable by a role explicitly granted
-- them.
--
-- These are DISTINCT from the pre-existing `identity_access.access_control.*`
-- permissions (sql/005) that guard the flat #171 CRUD at `/api/v1/abac/policies`
-- and role/assignment administration: the DSL surface has its own
-- `abac_policies` activity so authoring/simulating the condition DSL can be
-- granted or withheld independently of the broader access-control admin rights.
--
-- `awcms_permissions` is a GLOBAL catalog (no tenant_id, no RLS — the action
-- VOCABULARY is process-wide; the tenant-scoped grant lives in
-- `awcms_role_permissions`). Idempotent via ON CONFLICT DO NOTHING.
--
-- Actions reuse the existing `AccessAction` vocabulary (access-control.ts):
--   * read      — list/read stored policies.
--   * configure — create/update/enable/disable a policy (HIGH-RISK: authoring
--                 an access-control rule is security-sensitive; audited, and
--                 SoD-checked at the chokepoint). A role that can `read`
--                 policies is NOT implicitly able to author them — separate
--                 action, default-deny.
--   * analyze   — run the read-only simulation/preview (hypothetical
--                 subject/resource/action -> decision). Its OWN action, held
--                 separately from `read`, so previewing decision logic can be
--                 granted or withheld independently. Read-only, not high-risk.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'abac_policies', 'read', 'Read stored ABAC policies (DSL surface)'),
  ('identity_access', 'abac_policies', 'configure', 'Author (create/update/enable/disable) ABAC policies (DSL surface)'),
  ('identity_access', 'abac_policies', 'analyze', 'Run the read-only ABAC policy simulation/preview')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
