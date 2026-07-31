-- Permission catalog seed for machine credentials (ADR-0049), wiring up the
-- `machine_credentials` entries declared in `identity-access/module.ts`.
--
-- Same shape/limitation as every prior permission-seed migration here (see
-- `sql/075`/`sql/081`): this extends the GLOBAL catalog only. An existing
-- tenant's `owner` role does NOT retroactively gain these — only tenants
-- created after this migration runs get them via
-- `POST /api/v1/setup/initialize`'s `INSERT INTO awcms_role_permissions ...
-- SELECT ... FROM awcms_permissions`. Backfilling live tenants stays a
-- deployment step, not a migration side effect.
--
-- ## Why a NEW activity rather than reusing `access_control`
--
-- `access_control` seeds `read`/`assign`/`configure` — the RBAC catalog itself.
-- Issuing a credential that reads tenant data with no human behind it is a
-- different authority: folding it into `access_control.configure` would make
-- every role editor a credential issuer by side effect. Same reasoning
-- `sql/075` recorded for `registration_requests`.
--
-- ## Why `create` and `revoke` are separate
--
-- Only one of them creates a new capability. Default-deny on the consequential
-- one means an operator can be granted the ability to kill a leaked credential
-- without also being able to mint one — the direction that matters during an
-- incident. Both actions already exist in the `AccessAction` union
-- (`business_scope_assignments` uses them), so no new action literal is
-- invented here; an unseeded action would silently deny the owner.
--
-- `create` and `revoke` are both HIGH-RISK actions, so they additionally pass
-- the SoD chokepoint in `authorizeInTransaction` — no extra wiring needed.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'machine_credentials', 'read', 'List machine credentials for this tenant (never their secrets)'),
  ('identity_access', 'machine_credentials', 'create', 'Issue a read-only machine credential bound to a service account — audited'),
  ('identity_access', 'machine_credentials', 'revoke', 'Revoke a machine credential, effective on its next request — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
