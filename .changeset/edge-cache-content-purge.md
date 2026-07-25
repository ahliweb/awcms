---
"awcms": minor
---

Emit edge-cache invalidation from blog content changes (ADR-0042).

`enqueueEdgeCachePurge` previously had no callers, so a published edit stayed
visible at the edge until its TTL expired. The four blog write paths — create,
update, soft-delete, and scheduled publish — now enqueue a purge inside the same
transaction as the content change, so a rolled-back write leaves no stray purge
and a committed one cannot lose its invalidation.

Purges are module-scoped, not resource-scoped: cached responses carry
tenant/surface/module surrogate keys only, so a resource-scoped ban would match
no object and leave the page stale while reporting success.

No-op when `EDGE_CACHE_MODE` is off, so deployments that have not adopted the
edge cache do not accumulate queue rows.
