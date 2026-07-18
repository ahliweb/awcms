---
"awcms": patch
---

Add opt-in least-privilege `awcms_worker`/`awcms_setup` database roles (Issue #163) — the second half of the mini-045 role split; the first half (narrowing `awcms_app`) shipped as sql/021.

`sql/022_awcms_db_worker_setup_roles.sql` creates two purpose-specific runtime roles alongside `awcms_app`:

- **`awcms_worker`** — the seven unattended cron workers (`logs:audit:purge`, `sync:objects:dispatch`, `email:dispatch`, `domain-events:dispatch`, `workflow:escalations:dispatch`, `reporting:projections:refresh`, `reporting:exports:dispatch`). Granted exactly the per-write-path verbs each script uses across 25 tables — traced from THIS repo's actual SQL, not copied from mini (mini's worker set is visitor-analytics/blog/form-drafts, none of which exist here) — and zero access to the crown-jewel global catalogs (`awcms_permissions`, `awcms_schema_migrations`, `awcms_setup_state`, the module registry).
- **`awcms_setup`** — the one-time `POST /api/v1/setup/initialize` bootstrap only. Granted exactly what `bootstrapPlatformTenant` writes across 11 tables, with SELECT accompanying INSERT on every `RETURNING id` (Postgres requires SELECT for a column to appear in RETURNING), `awcms_permissions` read-only, and no DELETE anywhere.

Both are NOLOGIN + passwordless (a deployment activates LOGIN and a secret, exactly like `awcms_app`), non-superuser/non-BYPASSRLS/non-owner (so FORCE RLS applies), and carry the same fail-closed all-zero `app.current_tenant_id` default.

**Opt-in, NOT breaking.** `getWorkerDatabaseClient`/`getSetupDatabaseClient` still fall back to `DATABASE_URL` (the `awcms_app` connection) when `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are unset — a deployment that manages one connection string keeps working unchanged; the roles simply sit unused until an operator points a URL at one.

A new `security:readiness` check ("Worker/setup least-privilege role grants match matrix") verifies each provisioned role holds exactly its matrix and nothing more (non-blocking when the roles are absent, i.e. on the fallback). The grant matrix, the migration's GRANTs, and the readiness check are pinned to one another by contract tests; the full matrix was validated empirically against PostgreSQL 18. Also corrects several stale comments/docs that referenced these roles as belonging to nonexistent migrations (mini's numbering 045/060/069).

Migration only — no schema/data change, no API/event change.
