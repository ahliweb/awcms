---
"awcms": patch
---

Admin roles CRUD + role↔permission management (Issue #171). Adds
`POST /api/v1/roles` (create), `PATCH`/`DELETE /api/v1/roles/{id}` (rename /
soft-delete), `POST /api/v1/roles/{id}/restore`, and `POST`/`DELETE
/api/v1/roles/{id}/permissions` (grant / revoke), plus write controls on the
`/admin/roles` screen (create form, per-row rename / soft-delete, restore, and
a manage-permissions panel). All writes are HIGH-RISK: authorized on the
existing `identity_access.access_control.configure` permission and audited.
System roles (e.g. `owner`) cannot be soft-deleted (409). Duplicate role code
(409) and duplicate permission grant (409) are caught inside the tenant
transaction.
