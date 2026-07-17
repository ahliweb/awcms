---
"awcms": minor
---

Enforce two tenant-isolation controls that were declared but never actually
applied. Both are ports of code already proven in awcms-mini.

**Disabling a module now blocks its endpoints.** `authorizeInTransaction` did
not check tenant module status, so `POST /api/v1/tenant/modules/{key}/disable`
was cosmetic: the navigation hid the module and the audit event was recorded,
but any actor still holding the module's permissions could call its API
directly and keep working. `resolveModuleEnabled` is now checked before
permissions are even looked up, so a disabled module is refused with
`403 MODULE_DISABLED` regardless of what the actor was granted, and the denial
is recorded to the decision log as `matchedPolicy: "module_disabled"`. This
covers all 70 guarded endpoints at once. `module_management` is `isCore` and
cannot be disabled, so a tenant can never lock itself out of re-enabling.

**New migration `017_awcms_enforce_rls_force.sql`** adds `FORCE ROW LEVEL
SECURITY` to the 23 tenant-scoped tables that only `ENABLE`d it (migrations
002-008, 010-012), including `awcms_identities`, `awcms_sessions`,
`awcms_access_assignments` and `awcms_profiles`. PostgreSQL bypasses RLS for a
table's owner unless `FORCE`, and the app connects as the migration owner via
`DATABASE_URL` — so those tenant-isolation policies were never evaluated, and
isolation rested entirely on application-level `WHERE tenant_id` clauses with
RLS as a non-functioning backstop. Every one of the 23 tables already had
`tenant_id` and a policy, so this only starts enforcing what was declared; all
access paths already go through `withTenant()`.

This closes the table-owner bypass only. A SUPERUSER/BYPASSRLS connection still
bypasses RLS regardless of `FORCE`; closing that needs the least-privilege
`awcms_app` role, which is deployment-affecting and tracked separately.
