-- ADR-0040 §6 (ported from awcms-micro Issue #270) — permission catalog seed for
-- the `site_search` admin API (index status/rebuild/reconcile, settings,
-- failed-item diagnostics), wiring up the constants in
-- `site-search/domain/site-search-permissions.ts` and this module's own
-- `module.ts` `permissions` declaration.
--
-- Same shape/limitation as every prior permission-seed migration here (see
-- `sql/061`/`sql/063`): this extends the global ABAC catalog only. Existing
-- tenants' `owner` role does NOT retroactively gain these — only tenants created
-- after this migration runs get them via `POST /api/v1/setup/initialize`'s
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`.
-- Backfilling live tenants stays a deployment step, not a migration side effect.
--
-- ## Why the activities/actions are split the way they are
--
-- Reading the index status/freshness, running an incremental reconcile, and
-- forcing a full rebuild have different blast radii — a `rebuild` DELETEs and
-- re-extracts every document, a `reconcile` is a bounded idempotent sweep, and a
-- `read` mutates nothing — so they are separately grantable (`index.read`,
-- `index.reconcile`, `index.rebuild`). `rebuild` is a high-risk action
-- (`identity-access/domain/access-control.ts` `HIGH_RISK_ACTIONS`, shared with
-- reporting's projection rebuild); `reconcile` is deliberately NOT classified
-- high-risk (an idempotent index-projection sync, fully regenerable) but its
-- route still requires `Idempotency-Key` and is audited. `settings.read`/
-- `settings.update` and `diagnostics.read` follow the same read-vs-mutate split
-- — an update to the search config changes what the public search surface
-- returns.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('site_search', 'index', 'read', 'Read this tenant''s search index status, freshness, and recent index runs'),
  ('site_search', 'index', 'reconcile', 'Run an idempotent index reconciliation (upsert current public documents, remove stale ones) — idempotency-keyed, audited'),
  ('site_search', 'index', 'rebuild', 'Force a full search index rebuild (delete + re-extract every document) — high-risk, idempotency-keyed, audited'),
  ('site_search', 'settings', 'read', 'Read this tenant''s search configuration (enabled types, result limit, min query length, analytics opt-in)'),
  ('site_search', 'settings', 'update', 'Update this tenant''s search configuration — changes the public search surface (high-risk, audited)'),
  ('site_search', 'diagnostics', 'read', 'Read the search index failed-item diagnostics')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
