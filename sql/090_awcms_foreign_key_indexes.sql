-- 090 — Index every foreign-key column that no index could reach (ADR-0064).
--
-- Postgres indexes the REFERENCED side of a foreign key automatically (it is a
-- unique constraint) and the REFERENCING side not at all. Each column below is
-- a foreign key that `bun run db:fk-index:check` found unreachable: not the
-- leading column of any index, and not the second column of a
-- `(tenant_id, …)` composite either.
--
-- Two costs were being paid for each, and both surface late:
--   * every DELETE/UPDATE of a parent row sequentially scans the child table to
--     enforce the constraint, on a table that only grows;
--   * the join from parent to child has no index to use.
--
-- `IF NOT EXISTS` throughout: these are additive and safe to re-run. No data is
-- moved, no constraint changes, nothing is dropped.
--
-- NOT included, and deliberately: `awcms_setup_state.tenant_id`. That table is a
-- hard singleton (`id boolean PRIMARY KEY` + `CHECK (id)`), so it holds exactly
-- one row and an index on it is pure write overhead against a scan of one page.
-- It is carried as the single reasoned entry in `UNINDEXED_FK_EXEMPTIONS`.

-- identity_access -------------------------------------------------------------

-- Join from a role to its permissions, and the reverse lookup a permission
-- revocation performs across every role that holds it.
CREATE INDEX IF NOT EXISTS awcms_role_permissions_permission_idx
  ON awcms_role_permissions (permission_id);

-- `(tenant_id, tenant_user_id, role_id)` exists but leads elsewhere, so
-- deleting a role scanned every assignment row in the deployment.
CREATE INDEX IF NOT EXISTS awcms_access_assignments_role_idx
  ON awcms_access_assignments (role_id);

-- The decision log is the fastest-growing table in the schema, and this is the
-- column an "what did this user do" audit query filters on.
CREATE INDEX IF NOT EXISTS awcms_abac_decision_logs_tenant_user_idx
  ON awcms_abac_decision_logs (tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_identity_mfa_recovery_codes_identity_idx
  ON awcms_identity_mfa_recovery_codes (identity_id);

CREATE INDEX IF NOT EXISTS awcms_oidc_auth_requests_provider_idx
  ON awcms_oidc_auth_requests (provider_id);

CREATE INDEX IF NOT EXISTS awcms_oidc_auth_requests_identity_idx
  ON awcms_oidc_auth_requests (identity_id);

CREATE INDEX IF NOT EXISTS awcms_external_identities_identity_idx
  ON awcms_external_identities (identity_id);

CREATE INDEX IF NOT EXISTS awcms_external_identities_provider_idx
  ON awcms_external_identities (provider_id);

-- Both sides of registration review: the reviewer, and the account the approval
-- created. Deactivating a reviewer scanned the whole request history.
CREATE INDEX IF NOT EXISTS awcms_registration_requests_reviewed_by_idx
  ON awcms_registration_requests (reviewed_by_tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_registration_requests_created_identity_idx
  ON awcms_registration_requests (created_identity_id);

-- theming ---------------------------------------------------------------------

-- Retiring a theme version checks both of these; without them each retire read
-- every row of both tables.
CREATE INDEX IF NOT EXISTS awcms_theming_tenant_state_active_version_idx
  ON awcms_theming_tenant_state (active_version_id);

CREATE INDEX IF NOT EXISTS awcms_theming_preview_sessions_version_idx
  ON awcms_theming_preview_sessions (version_id);

-- blog_content ----------------------------------------------------------------

-- Menu items are self-referential; rendering a menu walks parent -> children.
CREATE INDEX IF NOT EXISTS awcms_blog_menu_items_parent_item_idx
  ON awcms_blog_menu_items (parent_item_id);

-- `awcms_blog_ads` has NO index at all beyond its primary key — the only table
-- in the schema in that state. Its write path is closed (#303) and ADR-0044 §4
-- plans its removal, but it is still read while the ingest completes, and one
-- index costs nothing next to a sequential scan per render.
CREATE INDEX IF NOT EXISTS awcms_blog_ads_tenant_idx
  ON awcms_blog_ads (tenant_id);

-- visitor_analytics -----------------------------------------------------------

CREATE INDEX IF NOT EXISTS awcms_visitor_sessions_identity_idx
  ON awcms_visitor_sessions (identity_id);
