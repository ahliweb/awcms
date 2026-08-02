---
"awcms": minor
---

Add the `/admin/sync` operator console and put `sync_storage` in the admin sidebar.

The module shipped node management, conflict resolution and the object upload queue with no screen, so an operator could see on the dashboard that sync was unhealthy and had no way to act on it except `curl`. `application/sync-directory.ts` has named "the future `/admin/sync` SSR page" in its own header comment since it was written. Under ADR-0051 this is that page.

All six of the module's permissions are driven here: the node list with activate/deactivate, the conflict list with the three resolutions and an optional note, and the object queue with retry on `failed` entries, keyset-paginated. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially.

`fetchSyncConflicts` is new in `sync-directory.ts`, and `GET /api/v1/sync/conflicts` now calls it too — the query used to be inline in that route, which was fine while it was the only reader; a screen that re-wrote it would be free to drift from the endpoint it is meant to mirror. The endpoint keeps its exact wire format: `fetchSyncConflicts` returns `null` for an unresolved conflict's resolution fields, and the route maps them back to `undefined` so they stay absent from the JSON rather than becoming `null` — that is a contract change, not a refactor.

**None of the three mutations sends an `Idempotency-Key`**, because none of the endpoints requires one: all three are naturally idempotent state transitions (`status = 'active'`, `'resolved'`, `'pending'`) rather than requests that do fresh work per call. Sending one would imply a replay contract they do not have. `tests/admin-sync-page-contract.test.ts` pins that in both directions, so an endpoint that later starts requiring a key turns the contract red instead of failing silently at runtime.

The HMAC node protocol (`push`/`pull`/`objects`/`status`) gets no controls, and the test asserts the page never names those paths: they authenticate a node by signature, not an administrator by session, so a button for them would be a control no browser can legitimately use and whose failure would read as a bug rather than a category error.

The module-specific latent-authz trap the test also pins: resolving a conflict is `conflict_resolution.approve`. Both `conflict_resolution.resolve` and `.update` read better than the permission that exists, and neither is seeded anywhere.
