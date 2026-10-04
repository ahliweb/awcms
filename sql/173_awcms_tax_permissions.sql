-- Issue #889 / ADR-0127 — permission catalog seed for the `tax` module.
--
-- Verbatim match to `TAX_PERMISSIONS` in
-- `src/modules/tax/domain/tax-permissions.ts` and to `tax/module.ts`'s
-- `permissions` array: the single source of truth the route guards call
-- `authorizeInTransaction` with.
--
-- Extends the global ABAC permission catalog only. A tenant's `owner` role is
-- seeded with every permission that exists when the tenant is created; for a
-- tenant that already exists, `identity_access`'s owner-permission backfill
-- (`owner-permission-backfill-job.ts`) grants a permission newer than the role —
-- so nothing here wires roles, and nothing here may be assumed to have reached an
-- existing tenant until that job has run.
--
-- ## Why nine keys
--
-- Authoring a rule is not publishing it (`configure` vs `publish`): publishing is
-- what changes what every future sale is taxed at. Finalising a document's tax is
-- not refunding it (`create` vs `reverse`), and either of them with a tax date outside
-- the server-date window is a third power (`backdate`). The stateless quote is `analyze` — a
-- read-only computation that records nothing. See `tax-permissions.ts`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('tax', 'rules', 'read',
   'Read this tenant''s tax rule versions and their rule definitions'),
  ('tax', 'rules', 'configure',
   'Author a draft tax rule version (rates, categories, rounding, effective date)'),
  ('tax', 'rules', 'publish',
   'Publish a draft tax rule version — changes what every sale on or after its effective date is taxed at'),
  ('tax', 'calculations', 'analyze',
   'Compute a stateless tax quote; nothing is recorded'),
  ('tax', 'snapshots', 'read',
   'Read finalised tax snapshots'),
  ('tax', 'snapshots', 'create',
   'Finalise a document''s tax into an immutable snapshot'),
  ('tax', 'snapshots', 'reverse',
   'Reverse (refund / return) a finalised document''s tax from its original snapshot — high-risk, audited'),
  ('tax', 'snapshots', 'backdate',
   'Finalise or reverse with a tax date outside the server-date window — posts into a period that may already be reported; high-risk, audited'),
  ('tax', 'reports', 'read',
   'Read the tax reconciliation report')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
