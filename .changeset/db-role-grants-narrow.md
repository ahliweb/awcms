---
"awcms": minor
---

Narrow the `awcms_app` runtime DB role's blanket DML on the global, RLS-free
tables (Issue #160, `sql/021_awcms_db_role_grants_narrow.sql`). Closes the
residual documented by `sql/019`: `awcms_app` can no longer `DELETE`
`awcms_tenants`, `DELETE` `awcms_schema_migrations`, or write `awcms_permissions`
(now read-only), and loses `DELETE` on `awcms_setup_state`. The
`INSERT`/`UPDATE`/`SELECT` that real code paths use (setup-wizard fallback,
tenant-settings screen, module-registry sync) are kept.

Deployment-affecting: apply the new migration with the migration-owner
connection string, as usual. The worker/setup role split (mini's migration 045)
remains deferred.

Adds a `security:readiness` grant check ("Runtime role table grants match
least-privilege matrix") that fails when `awcms_app` is over-granted on a global
table or, critically, when a tenant-scoped table is RLS-forced but ungranted
(`permission denied` at runtime) — the executing-role-bound `ALTER DEFAULT
PRIVILEGES` gap that the RLS-flag check cannot see.
