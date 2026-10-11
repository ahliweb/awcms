-- `hr_commission` accrual permission catalog seed (Issue #951, ADR-0132).
--
-- Verbatim match to `src/modules/hr-commission/domain/hr-commission-permissions.ts`
-- and to `module.ts`'s `permissions` array (`GET /api/v1/modules/hr_commission/
-- permissions` reports `missing`/`mismatched_description` otherwise).
--
-- ## Why the powers are split the way they are
--
--   * `accruals.read` reads the ledger (it shows earnings; list views carry the
--     amount, so it is its own permission and never implied by `rules.read`).
--   * `accruals.accrue` posts an accrual — the permission a downstream adapter's
--     composition root (or an operator) needs. HIGH-RISK and a NEW action rather
--     than `create`: an accrual is a payable earnings claim on a person's behalf,
--     and `create` is not high-risk (the classification is per action), so the
--     action-time SoD check could not be authored over who may post. It never
--     approves.
--   * `accruals.approve` moves pending -> approved. HIGH-RISK; the beneficiary
--     and the creator are refused, also by trigger.
--   * `accruals.release` moves approved -> payable: the point from which payroll
--     may pay it. HIGH-RISK.
--   * `accruals.cancel` voids a pending or approved accrual (no money moved, so
--     no compensating row). HIGH-RISK, and an existing action (the design's
--     "cancel = void").
--   * `accruals.pay` records that a payable accrual has been paid. HIGH-RISK and a
--     NEW action: paying is a different power from releasing.
--
-- Nothing here grants any rule, payroll or compensation power: `rules.*` never
-- implies `accruals.*` or the reverse.
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
  ('hr_commission', 'accruals', 'read',
   'Read commission accruals and their transition history (amounts are earnings)'),
  ('hr_commission', 'accruals', 'accrue',
   'Post a commission accrual for an employment from a source event (idempotent by source) — audited, high-risk'),
  ('hr_commission', 'accruals', 'approve',
   'Approve a pending commission accrual; the beneficiary cannot approve their own — audited, high-risk'),
  ('hr_commission', 'accruals', 'release',
   'Release an approved commission accrual as payable to payroll — audited, high-risk'),
  ('hr_commission', 'accruals', 'cancel',
   'Void a pending or approved commission accrual (no money has moved) — audited, high-risk'),
  ('hr_commission', 'accruals', 'pay',
   'Record that a payable commission accrual has been paid — audited, high-risk')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
