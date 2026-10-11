-- `hr_workforce` permission catalog seed (Issue #945, ADR-0132).
--
-- Verbatim match to `src/modules/hr-workforce/domain/hr-workforce-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_workforce/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
--   * `employments.read` reads every employment in the tenant (the person
--     reference, employee number, hire date and current terms). An employee
--     does NOT need it for their OWN employment: that is an `ownershipGrant`
--     (ADR-0063) computed from the persisted `tenant_user_id`, so the base role
--     can stay empty of HR permissions.
--   * `employments.create` / `.update` write the header and append terms.
--     `update` is what appends a terms change, including the terminal
--     `terminated` one.
--   * `employments.assign` links the LOGIN that is the employee. It is the basis
--     of self-service ownership, so it is HIGH-RISK and not implied by
--     `update`.
--   * `employments.delete` / `.restore` soft-delete an employment entered by
--     mistake and undo it. HIGH-RISK; a real end of employment is a terminated
--     term, not a delete.
--   * `settings.configure` changes the clock-skew bound and the correction
--     workflow key. HIGH-RISK.
--
-- Nothing here grants compensation, payroll or attendance power: those keys
-- do not exist in this phase, and `employments.*` never implies them.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` (the limitation every permission-seed migration carries — see
-- sql/170). An EXISTING tenant 403s until an operator grants them; run
-- `bun run identity-access:permissions:backfill` (dry-run by default,
-- `--tenant <code>`). Nothing here grants any permission to any role.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_workforce', 'employments', 'read',
   'Read employments (person reference, employee number, hire date, current terms); an employee reads their own without this'),
  ('hr_workforce', 'employments', 'create',
   'Create an employment for an existing profile_identity party'),
  ('hr_workforce', 'employments', 'update',
   'Append the next effective-dated terms of an employment (office, manager, title, type, status), including terminating it'),
  ('hr_workforce', 'employments', 'delete',
   'Soft-delete an employment entered by mistake — high-risk'),
  ('hr_workforce', 'employments', 'restore',
   'Restore a soft-deleted employment — high-risk'),
  ('hr_workforce', 'employments', 'assign',
   'Link or unlink the login that is the employee (the basis of self-service ownership) — audited, high-risk'),
  ('hr_workforce', 'settings', 'read',
   'Read the workforce settings (clock-skew bound, correction workflow key)'),
  ('hr_workforce', 'settings', 'configure',
   'Change the workforce settings — high-risk')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
