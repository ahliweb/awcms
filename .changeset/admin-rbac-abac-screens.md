---
"awcms": patch
---

Add user (tenant-users), RBAC (roles), and ABAC (policies) read APIs + admin management screens (Issue #166, Stage 3b) — porting awcms-mini's access-management reads, adapted to awcms's schema/scope. Completes the requested management surface (auth, user, profile, rbac, abac, module, template) as read-only admin screens.

- **Read layer** — `src/modules/identity-access/application/access-directory.ts`: `listTenantUsers` (users + assigned role codes, `login_identifier` **masked** via `maskIdentifierValue`), `listRoles` (non-deleted roles + permission count), `listAbacPolicies` (policies; seeded-empty by default — built-in rules apply). All bounded `LIMIT 100`, tenant-filtered, inside `withTenant`.
- **Endpoints** — `GET /api/v1/users`, `GET /api/v1/roles`, `GET /api/v1/abac/policies`, all gated on the existing `identity_access.access_control.read` permission (no new permission migration needed; mini's `user_management` activity code does not exist in awcms, so `access_control.read` is used as the gate). OpenAPI updated with matching paths + `TenantUserMasked`/`Role`/`AbacPolicy` schemas.
- **Screens** — `admin/users.astro`, `admin/roles.astro`, `admin/abac-policies.astro`, permission-gated, linked from `AdminLayout`. The authenticated E2E now navigates all three and asserts the users table shows the owner's **masked** login identifier (never the raw address).

Docs synced: doc 07, `identity-access/README.md`, `ARCHITECTURE.md`. Read-only for this slice; assign/create/edit (RBAC write) is a follow-up.
