---
"awcms": patch
---

Fix the edge-cache purge queue's tenant-isolation policy, which read a GUC the
application never sets — breaking every blog write when the cache was enabled.

`sql/068` created `awcms_edge_cache_purges_tenant_isolation` against
`current_setting('awcms.tenant_id', true)`. `withTenant()` sets
`app.current_tenant_id`, and so do the other 108 tenant policies in `sql/`.
`sql/068` was the only outlier.

The consequence was not a stale cache. `current_setting` returned NULL, so the
`WITH CHECK` predicate was NULL and every INSERT was rejected with
`new row violates row-level security policy`. `enqueueModuleContentPurge` is
awaited **inside** the content transaction (ADR-0042 §9 / ADR-0006) and is not
guarded, so that rejection aborted the publish: with `EDGE_CACHE_MODE` set to
`auto` or `on`, blog create, update, delete, and scheduled publish all returned
500. The `USING` side failed in the opposite, quieter direction — the purge
worker matched zero rows and reported `sent=0`, which reads exactly like an empty
queue.

It could not surface earlier. The subsystem defaults to `off`, where the enqueue
returns before touching the database, so no CI job, integration test, or
deployment had ever written to this table. It appeared on the first request after
the feature was switched on.

`sql/070` replaces the policy. `sql/068` is left untouched — it is applied in a
running deployment and rewriting it would change its checksum and block
`db:migrate`.

Adds `tests/migration-tenant-guc-consistency.test.ts`: a database-free gate that
scans every migration's executable SQL (comments stripped, so a repair migration
may name the wrong GUC while explaining itself) and fails on any
`current_setting` that is not `app.current_tenant_id`. It runs in the `quality`
job on every PR, which is where this class of typo needs to be caught — at
authoring time, not on the day a flag is enabled in production.
