---
"awcms": patch
---

fix(identity-access): the flat ABAC policy update (`PATCH /api/v1/abac/policies/{id}`, and activate/deactivate via `setPolicyActive`) now only matches rows with `is_dsl_managed = false`, so it returns not-found for DSL-managed policies instead of flipping their effect or active flag without DSL validation.
