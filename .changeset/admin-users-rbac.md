---
"awcms": patch
---

Add tenant-user activate/deactivate + role assign/unassign to the admin UI (Issue #171) — the next slice of admin write actions, backed by new guarded, audited endpoints in the identity-access module.

- **`user-admin.ts`** (new application layer) — `setTenantUserStatus` (activate/deactivate; `awcms_tenant_users` has no `deleted_at`, so deactivate = `status='inactive'` / reactivate = `status='active'`), `assignRole` (DB-idempotent via the `(tenant_id, tenant_user_id, role_id)` unique index; a repeat assign raises 23505 → 409), and `unassignRole`. Each writes a high-risk audit event; login identifiers (PII) are never logged — the audit row references the stable `tenant_user_id`.
- **`PATCH /api/v1/users/{id}`** (new) — set a tenant user's status. Guarded on `identity_access.access_control.configure`.
- **`POST` / `DELETE /api/v1/access/assignments`** (new) — assign / revoke a role. Guarded on `identity_access.access_control.assign`. 23505 → 409 is caught INSIDE `withTenant`; target-not-found → 404 is raised before any write.
- **`admin/users.astro`** — now renders per-user activate/deactivate and assign-role (with per-role remove) controls, each UX-gated on the same permission its endpoint enforces (the endpoint guard is the authority). Login identifiers stay masked in the render. The client script is external (CSP-safe) and uses the shared `sendJson` PATCH/DELETE helper.

GUARD NOTE (no migration): the seed (`sql/005`) provides `identity_access.access_control.{read,assign,configure}` but no `.update`, and the owner role is granted only SEEDED permissions — so guarding on `update` would deny even the owner. Role assignment therefore uses the exactly-named `assign` permission; user activate/deactivate uses `configure` (the broadest identity-access admin permission), since deactivating revokes all of a user's access. A future migration adding a dedicated `access_control.update` (or a `user_management` activity) would let user-status be gated independently of role/permission administration.
