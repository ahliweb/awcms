-- `hr_workforce` / `hr_commission` employee self-service permission seed
-- (Issue #952, `docs/awcms/workforce-self-service.md`).
--
-- Verbatim match to `src/modules/hr-workforce/domain/hr-workforce-permissions.ts`,
-- `src/modules/hr-commission/domain/hr-commission-permissions.ts` and to each
-- module's `permissions` array (`GET /api/v1/modules/<key>/permissions` reports
-- `missing`/`mismatched_description` otherwise).
--
-- ## Why two new keys, and what they do NOT widen
--
--   * `hr_workforce.self_service.read` opens the employee and supervisor SCREENS
--     (`/admin/hr/my-work`, `/my-metrics`, `/team`) and `GET /api/v1/hr-workforce/
--     me`. The sidebar needs a seeded permission to show an entry, and an
--     employee holds no HR permission by design. It grants NO data: every list
--     the screens show is still bound by the existing ownership grants (the
--     persisted login link; the manager chain), computed in the query. Holding
--     this key without a linked employment shows an empty page.
--   * `hr_commission.my_accruals.read` opens `/admin/hr/my-commission` and
--     `GET /api/v1/hr-commission/my-accruals[/{id}]`. The query joins the live
--     employment linked to the caller's login, so another person's accrual is
--     a 404 and there is no parameter that names a person.
--
-- Neither implies `attendance.read`, `corrections.read`, `workforce_metrics.*`
-- or `accruals.read`. Nothing grants these keys to any role: the tenant decides
-- which staff may open the screens (the usual answer is every staff role).
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
-- `--tenant <code>`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('hr_workforce', 'self_service', 'read',
   'Open the employee self-service and supervisor screens and read your own employment summary; the data itself stays bound to your linked employment and your reports, not to this permission'),
  ('hr_commission', 'my_accruals', 'read',
   'Read your own commission accruals (the earning, how it was computed and its status); another person''s are never returned')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
