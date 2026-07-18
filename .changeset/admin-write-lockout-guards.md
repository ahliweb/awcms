---
"awcms": patch
---

Harden the admin access-control write surface against privilege-escalation and
lockout foot-guns (Issue #171 review follow-up):

- **System-role permission set is immutable via the API.** `POST`/`DELETE
  /api/v1/roles/{id}/permissions` now refuse `is_system` roles (409
  `ROLE_SYSTEM_PROTECTED`) — a delegated `configure` holder can no longer strip
  the seeded `owner` role's grants and lock the tenant out (parity with
  `softDeleteRole`, which already blocked system roles).
- **System roles cannot be hand-assigned/unassigned.** `POST`/`DELETE
  /api/v1/access/assignments` refuse `is_system` roles (409
  `ROLE_SYSTEM_PROTECTED`) — the `assign` permission can no longer be used to
  self-assign `owner` (escalation) or strip it from the sole owner (lockout).
- **Deactivation lockout guards.** `PATCH /api/v1/users/{id}` refuses to
  deactivate the actor's own account (409 `CANNOT_DEACTIVATE_SELF`) or the last
  active member of a system role (409 `USER_LAST_ADMIN_PROTECTED`), so a tenant
  can never be left with no active administrator and no in-app recovery.

All guards are checked before any write, audited on the success path only, and
scoped to the tenant (no cross-tenant existence oracle).
