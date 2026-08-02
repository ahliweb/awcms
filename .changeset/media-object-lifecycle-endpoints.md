---
"awcms": minor
---

Give `media_library`'s delete/restore/purge permissions the endpoints they never had (ADR-0056 §B), and fix a Postgres error-code check that could never be true.

All three permissions have been in the global catalog since `sql/052`, granted whole to every tenant owner, and enforced by nothing — no route, no application function, no job. The functions behind them were written and had zero callers. So an object uploaded by mistake, orphaned, or violating policy disappeared only if the reconciliation job happened to categorise it that way, on the job's own schedule; there was no way for an administrator to remove one, and no way to undo it if they were wrong.

- `DELETE /api/v1/media/objects/{id}` — soft delete, body `{ reason }` required and bounded at 500 characters. The reason is part of the request hash, so replaying one key with a different reason is a different request rather than a stored response describing a reason nobody sent.
- `POST /api/v1/media/objects/{id}/restore` — the undo. A live object answers 404: "there was nothing to undo" and "it worked" must not share a response.
- `POST /api/v1/media/objects/{id}/purge` — hard-deletes the registry row of an already soft-deleted object.

All three are `HIGH_RISK_ACTIONS` and require `Idempotency-Key`, each under its own scope so a delete's key cannot collide with a purge's.

**Soft delete breaks live references, deliberately.** `resolveMediaReferences` filters `deleted_at IS NULL`, so a post whose `featured_media_id` points at a deleted object resolves to nothing immediately. That is the intended outcome for the case this serves, and `restore` is what makes it recoverable. Nothing here scans for referencing rows first: that would make a System Foundation module know its own consumers.

**`purge` clears the registry, not the R2 bytes.** The `news-media:reconcile` job owns the bucket; a second writer would mean two processes with different ideas of what is safe to remove. Accepted, stated cost: a window where the R2 object outlives its registry row, closed by the next reconciliation tick.

`awcms_news_portal_ad_placements.media_object_id` is a hard NOT NULL FK, so purging a still-referenced object answers `409 MEDIA_OBJECT_REFERENCED`. That path runs inside a **savepoint** — in PostgreSQL a `23503` aborts the whole transaction, so catching it without one turns a caller-actionable 409 into a 500 at the COMMIT `withTenant` performs. Verified against a real database rather than reasoned about.

That verification turned up a second thing. **The SQLSTATE is on `error.errno`, not `error.code`** — Bun sets `code` to its own `"ERR_POSTGRES_SERVER_ERROR"` for every server error alike, so `error.code === "23505"` is not a subtly wrong check but one that can never be true, leaving everything downstream of it dead. Ten sites in this repo already used `String(error.errno)`. One did not: `tenant-provisioning.ts`, where `POST /api/v1/tenants` promises `409 duplicate_tenant_code` and served a 500 on the concurrent-duplicate race the savepoint exists for (its pre-check SELECT hid the ordinary case). Fixed here rather than filed, and `tests/postgres-sqlstate-detection.test.ts` now gates it repo-wide — mutation-proven by restoring the original defect.

`media_library` now has zero ungated permissions. ADR-0056 §C (a list function and its own route) is what remains before the screen.
