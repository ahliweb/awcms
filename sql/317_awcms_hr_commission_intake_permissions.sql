-- `hr_commission` intake permission catalog seed (Issue #1189, ADR-0147).
--
-- Verbatim match to `src/modules/hr-commission/domain/hr-commission-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_commission/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## The two powers and why they are split
--
--   * `intake.read` reads the intake EXCEPTIONS (refused and failed requests:
--     an outcome code, a masked id, never an amount) and the poster's
--     diagnostics (counts). It does not open the accrual ledger: holding it
--     reveals no earnings.
--   * `intake.configure` switches the tenant's `commission_intake_enabled`. It
--     is HIGH-RISK (`configure` is in `HIGH_RISK_ACTIONS`), separately
--     grantable, idempotency-keyed and audited at `warning`: turning it on lets
--     a registered system consumer queue commission requests that a job then
--     posts with no signed-in person. It never approves or pays an accrual
--     (the maker/checker and beneficiary-SoD controls of the ledger still bind
--     every posted accrual).
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS). Idempotent via
-- ON CONFLICT (module_key, activity_code, action) DO NOTHING.
--
-- ## Existing tenants
--
-- ONLY tenants created AFTER this migration pick these up automatically, via
-- `createTenantWithOwner`'s blanket `SELECT ... FROM awcms_permissions WHERE
-- scope = 'tenant'` (the limitation every permission-seed migration carries --
-- see sql/170). An EXISTING tenant 403s until an operator grants them; run
-- `bun run identity-access:permissions:backfill` (dry-run by default,
-- `--tenant <code>`). Nothing here grants any permission to any role.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_commission', 'intake', 'read',
   'Read the commission intake exceptions (refused and failed requests: an outcome code and masked ids, never an amount) and the poster job counts'),
  ('hr_commission', 'intake', 'configure',
   'Switch the tenant''s commission intake on or off (lets a registered system consumer queue commission requests that a job posts) — audited at warning, high-risk')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
