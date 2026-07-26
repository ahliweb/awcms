-- Permission catalog seed for the self-registration approval queue (Wave 2
-- delta auth), wiring up the `registration_requests` entries declared in
-- `identity-access/module.ts`.
--
-- Same shape/limitation as every prior permission-seed migration here (see
-- `sql/061`/`sql/063`/`sql/065`): this extends the GLOBAL catalog only. An
-- existing tenant's `owner` role does NOT retroactively gain these — only
-- tenants created after this migration runs get them via
-- `POST /api/v1/setup/initialize`'s `INSERT INTO awcms_role_permissions ...
-- SELECT ... FROM awcms_permissions`. Backfilling live tenants stays a
-- deployment step, not a migration side effect.
--
-- ## Why a NEW activity rather than reusing `access_control`
--
-- `access_control` seeds `read`/`assign`/`configure` — the RBAC catalog itself.
-- Reviewing who may join the tenant is a different authority: `/api/v1/users`
-- in this repo is read-only, so approval is the FIRST admin path that
-- materializes an identity at all, and it should be delegable to whoever
-- handles onboarding without also handing them role and permission
-- administration. Overloading `access_control.configure` would have made every
-- role-editor an account-creator by side effect.
--
-- ## Why `approve` and `reject` are separate
--
-- Not symmetry for its own sake. `approve` creates a real, login-capable
-- account; `reject` closes a row and creates nothing. Default-deny on the
-- consequential one means a reviewer can be granted the ability to clear spam
-- without the ability to admit anyone — the same "holding `create` does not
-- imply `release`" reasoning `data_lifecycle.legal_hold` already applies. Both
-- actions already exist in the `AccessAction` union (`business_scope_exceptions`
-- uses them), so no new action literal is invented here — an unseeded action
-- would silently deny the owner.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'registration_requests', 'read', 'Read the pending self-registration queue for this tenant'),
  ('identity_access', 'registration_requests', 'approve', 'Approve a self-registration request, creating a real account that can sign in — audited'),
  ('identity_access', 'registration_requests', 'reject', 'Reject a self-registration request (no account is created) — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
