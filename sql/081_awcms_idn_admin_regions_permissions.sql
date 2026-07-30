-- ADR-0046 — permission catalog seed for the `idn_admin_regions` module: the
-- read-only region/dataset lookup surface plus the two audited dataset lifecycle
-- actions (activate, rollback). Wires up the constants in
-- `idn-admin-regions/domain/idn-admin-regions-permissions.ts` and this module's
-- own `module.ts` `permissions` declaration.
--
-- Same shape/limitation as every prior permission-seed migration here (see
-- `sql/067`/`sql/075` precedents): this extends the GLOBAL ABAC catalog only.
-- Existing tenants' `owner` role does NOT retroactively gain these — only tenants
-- created after this migration runs get them via `POST /api/v1/setup/initialize`.
-- Backfilling live tenants stays a deployment step, not a migration side effect.
--
-- ## Action-literal mapping (identity-access/domain/access-control.ts)
--
-- Every `action` below is an EXISTING valid `AccessAction` literal — this module
-- adds none, deliberately. The two lifecycle actions are the reason to be
-- careful here:
--
--   * activate -> `configure`. There is no `activate` literal; inventing one
--     would widen the union AND plant a latent-authz trap (an action nobody
--     seeds into any role denies even the tenant owner while the code looks
--     correct — the trap this repo has already been bitten by).
--   * rollback -> `restore`, the existing literal for "put back the previous
--     state", which is exactly what rolling back to the previously active
--     dataset does.
--
-- Import is deliberately ABSENT from this catalog: it is a worker job
-- (`bun run idn-regions:import`) running as `awcms_worker`, never an HTTP
-- action, so there is no request-time subject for an ABAC guard to evaluate
-- (ADR-0046 §5). Seeding a permission for it would advertise a surface that does
-- not exist.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('idn_admin_regions', 'region', 'read', 'Look up Indonesia administrative regions (province/regency/district/village) from the active or a named dataset version'),
  ('idn_admin_regions', 'dataset', 'read', 'Read imported Indonesia administrative region dataset versions and their upstream provenance (repository, commit, checksum, decree reference)'),
  ('idn_admin_regions', 'dataset', 'configure', 'Activate a validated Indonesia administrative region dataset version so it becomes the one served — high-risk, idempotency-keyed, audited'),
  ('idn_admin_regions', 'dataset', 'restore', 'Roll back to the previously active Indonesia administrative region dataset version — high-risk, idempotency-keyed, audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
