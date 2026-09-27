-- Issue ahliweb/omes#249 — Repository progress projection permission catalog
-- seed.
--
-- Read access REUSES the existing `omes_control.hermes_orchestration.read`
-- permission (precedent: module.ts's "one read permission for a family of
-- related read-only projections", already covering
-- `/admin/omes/orkestrasi-langsung`, `/admin/omes/hermes`, AND
-- `/admin/omes/progres-hermes` itself since issue #246 part 2 — this issue
-- only replaces that screen's explicit empty state with a real projection,
-- it does not change who may VIEW the screen). No new read permission is
-- added.
--
-- Configuring WHICH repository a tenant observes is a distinct, NEW write
-- capability with no existing precedent to reuse (it is not a Hermes
-- orchestration concern, and it is the only mutating action this issue
-- adds), so it gets its own permission, `repository_progress.configure`.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent
-- via ON CONFLICT (module_key, activity_code, action) DO NOTHING.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omes_control', 'repository_progress', 'configure', 'Set or clear the GitHub repository a tenant observes for the Progres Hermes view')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
