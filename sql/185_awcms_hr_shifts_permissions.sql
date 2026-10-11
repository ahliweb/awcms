-- `hr_workforce` shift permission catalog seed (Issue #946, ADR-0132).
--
-- Verbatim match to `src/modules/hr-workforce/domain/hr-workforce-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_workforce/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
--   * `shifts.read` reads every assignment in the tenant, DRAFTS included. An
--     employee does NOT need it for their OWN published schedule: that is an
--     `ownershipGrant` (ADR-0063) on the persisted `tenant_user_id` and shows
--     published assignments only, so the base role can stay empty of HR keys.
--   * `shifts.create` writes a DRAFT (nothing is visible to the availability port
--     yet). `shifts.publish` makes it visible, so a scheduler who drafts need not
--     be able to publish; it is HIGH-RISK (the platform classification) because a
--     published shift is what a booking system trusts. `shifts.cancel` withdraws
--     a draft or a published assignment; HIGH-RISK for the same reason.
--   * There is deliberately NO `shifts.update`: a draft is replaced by cancelling
--     it and creating another, a published shift is immutable. A permission
--     nothing enforces would be one that denies even owner while the code looks
--     right.
--   * `templates.*` manage the patterns; `templates.delete` is a soft delete and
--     HIGH-RISK. A template carries no person.
--
-- Nothing here grants compensation, payroll or attendance power: `shifts.*` never
-- implies `compensation.*` (those keys do not exist in this phase).
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
  ('hr_workforce', 'shifts', 'read',
   'Read shift assignments, drafts included; an employee reads their own published schedule without this'),
  ('hr_workforce', 'shifts', 'create',
   'Create a draft shift or time-off assignment for an employment'),
  ('hr_workforce', 'shifts', 'publish',
   'Publish a draft shift assignment so scheduling consumers can see it — high-risk'),
  ('hr_workforce', 'shifts', 'cancel',
   'Cancel a draft or published shift assignment — high-risk'),
  ('hr_workforce', 'templates', 'read',
   'Read shift templates'),
  ('hr_workforce', 'templates', 'create',
   'Create a shift template'),
  ('hr_workforce', 'templates', 'update',
   'Edit a shift template; existing assignments are not moved'),
  ('hr_workforce', 'templates', 'delete',
   'Soft-delete a shift template — high-risk')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
