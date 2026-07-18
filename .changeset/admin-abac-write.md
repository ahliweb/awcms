---
"awcms": patch
---

Admin UI: author and manage ABAC policies (Issue #171). Adds
`POST /api/v1/abac/policies` (create) and `PATCH /api/v1/abac/policies/{id}`
(update effect/description and enable/disable toggle), both gated default-deny on
`identity_access.access_control.configure` (the access-control administration
permission — that activity seeds only `read`/`assign`/`configure`, and the owner
holds only seeded permissions) and audit-logged as high-risk access-control
changes. A duplicate `policyCode` returns 409. The
`/admin/abac-policies` screen gains a create-policy form plus per-row Edit and
Enable/Disable controls (UX-only gating; the endpoint ABAC guard is the
authority).
