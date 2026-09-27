-- Issue ahliweb/omes#246 — Hermes orchestration observability permission
-- catalog seed.
--
-- One new `omes_control` permission, `hermes_orchestration.read`, shared by
-- all three new screens this issue adds (`/admin/omes/orkestrasi-langsung`,
-- `/admin/omes/hermes`, `/admin/omes/progres-hermes`) — the same "one read
-- permission covers a family of related read-only projections" precedent
-- `servers.read` already sets for the `health` screen (see module.ts's
-- comment on why `health` has no separate `health.read`). None of these
-- three screens accepts a write/control action, so no `.approve`/`.operate`
-- counterpart is added.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent
-- via ON CONFLICT (module_key, activity_code, action) DO NOTHING.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omes_control', 'hermes_orchestration', 'read', 'Read Hermes delegated-task/subagent orchestration projections')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
