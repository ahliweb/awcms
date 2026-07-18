---
"awcms": patch
---

Admin offices lifecycle: soft-delete + restore (Issue #171). Adds
`DELETE /api/v1/offices/{id}` (audited soft-delete; optional/bodyless reason)
and `POST /api/v1/offices/{id}/restore` (audited restore, 409 when a live
office has retaken the code). The `/admin/offices` screen gains permission-gated
per-row inline edit (name + status via the existing PATCH), soft-delete, and a
deleted-offices section with restore controls. Seeds the new
`tenant_admin.office_management.delete` permission via migration
`sql/023_awcms_seed_office_management_delete_permission.sql` (so the owner,
granted only catalogued permissions at bootstrap, can actually delete); restore
reuses `office_management.update`.
