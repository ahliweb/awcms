---
"awcms": patch
---

Fix `POST /api/v1/roles` and `POST /api/v1/offices` to return `201 Created` on success instead of `200 OK`, matching the `created()` helper already used by `POST /api/v1/abac/policies` and the REST convention for resource-creation endpoints. Updates the corresponding OpenAPI response codes to `201`.
