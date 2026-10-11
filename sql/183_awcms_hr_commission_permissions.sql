-- `hr_commission` permission catalog seed (Issue #950, ADR-0132).
--
-- Verbatim match to `src/modules/hr-commission/domain/hr-commission-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_commission/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
--   * `rules.read` reads the rule versions.
--   * `rules.create` writes a new draft version; `rules.update` edits a DRAFT.
--     Neither makes a rule take effect.
--   * `rules.publish` makes a draft immutable and eligible to apply. HIGH-RISK
--     and separately grantable: whoever writes the terms need not be whoever
--     puts them into force.
--   * `rules.retire` withdraws a draft or published version. HIGH-RISK.
--
-- Nothing here grants any accrual, payroll or compensation power: those keys do
-- not exist in this phase, and `rules.*` never implies them.
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
  ('hr_commission', 'rules', 'read',
   'Read commission rule versions (calculation, rate or fixed amount, currency, rounding, effective window)'),
  ('hr_commission', 'rules', 'create',
   'Create a draft commission rule version'),
  ('hr_commission', 'rules', 'update',
   'Edit a DRAFT commission rule version; a published version is immutable'),
  ('hr_commission', 'rules', 'publish',
   'Publish a draft commission rule version, making it immutable and eligible to apply — audited, high-risk'),
  ('hr_commission', 'rules', 'retire',
   'Retire a draft or published commission rule version so it no longer applies — audited, high-risk')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
