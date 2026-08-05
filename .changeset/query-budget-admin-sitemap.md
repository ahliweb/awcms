---
"awcms": patch
---

Extend the query budgets to the heaviest admin screens and the sitemap builder (gap C5 of the second-pass assessment — the first budget file covered only the public blog read paths).

Every `src/pages/admin/*.astro` screen was ranked by the number of read functions it calls inside `withTenantOrThrow`. Two stand above the rest and are now budgeted at their measured actuals: `/admin` — the dashboard's four report aggregations, 15 queries across nine tables — and `/admin/blog` — the editorial list at 2 queries, 3 with the revision panel, plus a paging-depth constancy check. Every other screen (including `/admin/media`) calls one read function issuing one or two queries, so a budget there would restate a single function's shape rather than guard an aggregation.

The sitemap builder is the other classic N+1 shape: `seo_distribution`'s discovery aggregator crosses module boundaries through injected `seo_facts` providers and resolves media in batches, on a public unauthenticated surface rebuilt on every edge-cache MISS. The index build is budgeted at 4 queries and a child page at 6, both constant across a 40-post fixture.

Budgets are ceilings set at the exact measured count — no headroom, because headroom is exactly the space a small regression hides in. Fixtures seed more rows than any budget allows (40 posts, 40 rows in each dashboard-aggregated table, 30 revisions), with time anchors taken from the database rather than a JS clock, so per-item work cannot pass unnoticed. Test infrastructure only: no ADR, no new gate in `bun run check`; the suite is DB-gated by the same `integrationEnabled` mechanism as every other integration file and runs in CI's Integration tests job.
