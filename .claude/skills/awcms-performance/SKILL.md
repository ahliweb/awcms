---
name: awcms-performance
description: Audit and improve AWCMS application & database performance. Use when asked for "performance/query optimisation", when an endpoint is slow, on N+1, indexing/pagination problems, connection pool tuning, or materialized view/caching planning. Enforces the doc 16 data access patterns, pooling/backpressure, and keyset pagination.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

> **WARNING — some commands on this page DO NOT EXIST, and the §Performance
> suite below CONTRADICTS this warning.**
> `performance:suite`, `performance:query-plan:check`, `database:capacity:check`
> are listed in [`scripts/README.md`](../../../scripts/README.md) §Deferred as
> reference targets, not as real scripts. Running them will fail.
>
> **And the directory `src/lib/performance/` does not exist.** The §Performance
> suite at the bottom of this page tells its reader to "use the suite that
> already exists in `src/lib/performance/`, do not build new ad hoc tooling" —
> that is **wrong**, and it survives because `bun run skills:check` exempts this
> entire skill through a single `ASPIRATIONAL_SKILLS` entry whose reason mentions
> _commands_ while the exemption also covers _paths_. Treat the whole
> §Performance suite as a **target specification**, not a runbook.
> (Assessment 4 August 2026 §9.6.)
>
> **What is REAL today — use these:**
>
> | Tool                                                 | Coverage                                                                                                                             |
> | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
> | `bun run db:fk-index:check`                          | 182 FK columns, all index-reachable, 1 exception ([ADR-0064](../../../docs/adr/0064-foreign-key-columns-must-be-index-reachable.md)) |
> | `bun run db:work-class:check`                        | pool work-class separation                                                                                                           |
> | `tests/integration/query-budget.integration.test.ts` | ceiling of **3 queries** for the public blog listing/paging/feed, 40-post fixture                                                    |
> | `bun run db:pool:health`, `bun run redis:health`     | pool/cache health at runtime                                                                                                         |
>
> **Limits you must know before calling "CI green" a performance guarantee:** of
> the **33** gates in the `check` chain, **one** checks performance. The query
> budget is not a chain gate but a **DB-gated integration test** — on a machine
> without PostgreSQL it is `skip`ped and `bun run check` stays green. And its
> coverage is only the public blog read path: **31 admin screens and the sitemap
> builder have no budget**.
>
> **Three open performance gaps (assessment §9):**
>
> 1. **Purge reaches Varnish, NOT the tier that serves readers.** The real path
>    is three layers — `Cloudflare (proxied) -> Traefik -> varnish -> app`
>    ([`environments.md`](../../../docs/awcms/environments.md) §Edge cache) —
>    while `EDGE_CACHE_PURGE_ENDPOINT` points only at the Varnish container. Zero
>    calls to the Cloudflare zone API in `src/`. Probed: `/robots.txt` on staging
>    answers `cf-cache-status: HIT`, `age: 182`, at the moment the application
>    marks `x-edge-cache-skip: surface_not_declared`. The staleness is **bounded**
>    by `s-maxage` (`EDGE_CACHE_MAX_TTL_SECONDS=300`) so this is a lag, not a
>    leak — but the acceptance test table in `environments.md` measures `X-Cache`
>    from Varnish, the tier that is not the one answering, so that lag will never
>    show up in any test.
>
>    > **And DO NOT add compression in the application/VCL.** The second round of
>    > the assessment briefly recommended it on the grounds of "zero compression
>    > in the serving path" — true for what the repo owns, **wrong** for what the
>    > reader receives: staging and production return `content-encoding: gzip`
>    > from Cloudflare. That recommendation is **REVOKED**; adding it now creates
>    > two places deciding the same thing. What remains: a deployment of this
>    > template outside a compressing CDN gets no compression, and no gate says so.
>
> 2. **There is no client asset size budget.** 139 KB today — this is the cheapest
>    moment to gate it.
> 3. **Core Web Vitals are not measured.**
>    [ADR-0067](../../../docs/adr/0067-core-web-vitals-collection.md) `Proposed`
>    offers three options that are **all RUM** (collecting visitor data), and for
>    that reason it is waiting on a product owner decision. What has not been
>    weighed: **lab measurement** — Playwright is already installed in this repo,
>    collects zero visitor data, and answers a different question ("does this
>    change make the page slower"). Do not wait for the RUM decision to do it.

# AWCMS — Performance & Database Tuning

Source of truth: **`docs/awcms/16_backend_data_access_integration.md`** (data access layer, pooling/backpressure, transactions), **`docs/awcms/database-pooling.md`**, and **`docs/awcms/07_sprint_testing_production_readiness.md`** (performance targets). This skill is an **improvement** loop: measure → find the bottleneck → fix → measure again.

## Golden rule

**Measure before optimising.** Do not guess — run `EXPLAIN (ANALYZE, BUFFERS)` on the suspected query, and benchmark the endpoint (p50/p95/p99) before & after. Optimisation without data = speculation.

## Database

- [ ] **RLS-aware indexes** — tenant-scoped queries are always filtered by `tenant_id`; composite indexes **must** be prefixed `(tenant_id, …)` so they match the RLS predicate + the filter. Check for missing indexes via `EXPLAIN` (a Seq Scan on a big table = red).
- [ ] **Avoid N+1** — do not query inside a loop; batch with `= ANY(tx.array(ids, "uuid"))` (see the Bun SQL array binding memory) or a `JOIN`. Look for the pattern `for (…) await tx\`SELECT …\``.
- [ ] **Keyset pagination, not OFFSET** — `WHERE (created_at, id) < (:cursor)` + `LIMIT`, not a large `OFFSET n` (doc 14 §Pagination). A large OFFSET scans then throws rows away. A shared helper already exists (Issue #435): `encodeKeysetCursor`/`decodeKeysetCursor` (`src/modules/_shared/keyset-pagination.ts`, opaque base64 cursor `createdAt|id`, a corrupt cursor → `400 VALIDATION_ERROR` rather than being silently treated as "no cursor") — **reuse it**, do not reimplement per endpoint.
- [ ] **A join after LIMIT can make the planner pick the wrong plan** — if a query already has the right index but `EXPLAIN` still shows a Seq Scan, check whether `LIMIT` is applied **after** the `JOIN` (the planner estimates the join result rows, can be far off, and can consider an Index Scan more expensive than it really is). The fix: move `LIMIT`+`ORDER BY` into a **subquery before the join** (the `fetchObjectQueueEntries` pattern, `src/modules/sync-storage/application/sync-directory.ts`, Issue #435) — the planner then has no option but to satisfy the `LIMIT` straight from the index.
- [ ] **Explicit columns** — avoid `SELECT *`; take only the columns you use (less I/O + payload).
- [ ] **`count(*)::int`** for small aggregates; remember a Postgres bigint comes back as a string from Bun.SQL → explicit `Number(...)`, not `as number`.
- [ ] **jsonb** — a GIN index only if it is queried by content; do not store large payloads that are never filtered on.
- [ ] **Materialized view / read model** — for heavy aggregation reports that do not need real time; scheduled refresh. Base reports today are direct read aggregations (doc: reporting) — consider an MV as data grows.
- [ ] **Statement timeout** — `DATABASE_STATEMENT_TIMEOUT_MS` stops a runaway query from locking a connection.

## Application & connections

- [ ] **Work-class pool + backpressure** — endpoints are classified (`critical_transaction`/`interactive`/`reporting`/`background_sync`/`maintenance`, doc 16). Heavy reports & sync must **not** be in the `interactive` class; saturation → `503 DATABASE_BUSY`, instead of saturating the whole pool.
- [ ] **Keep transactions as short as possible** — CPU-bound work (argon2 hashing) & external provider calls go **outside** the DB transaction (ADR-0006); do not hold a connection/lock while waiting on external I/O.
- [ ] **PgBouncer** — when `DATABASE_PGBOUNCER=true`, prepared statements are disabled (transaction mode). Make sure `DATABASE_POOL_MAX` lines up with the server pool limit.
- [ ] **SSR reuse** — admin pages fetch via an application-layer function inside a single `withTenant`, not an HTTP round trip to our own API (the `*-directory.ts`/`*-report.ts` pattern).
- [ ] **Locking** — `FOR UPDATE` only on rows that really are mutated together (e.g. stock); avoid wide range locks.

## Verification

- `EXPLAIN ANALYZE` before/after shows a real improvement (Seq→Index Scan, plan cost down).
- Endpoint p95 benchmark improves; no functional regression (`bun run check` green).
- Light load test: saturate a pool class with queries → `503`, draining to 0 (evidence of backpressure, like the Issue 10.2 verification).
- No new N+1; no large `OFFSET`; indexes match the predicates.

## Transport & serving

- [ ] **Response compression** — see gap 1 in the banner. When closing it: **one
      place only**. The application (the `awcms-astro` pattern) OR `beresp.do_gzip`
      in VCL — two places deciding the same thing is how you get a double
      `Content-Encoding` and a cache that stores the wrong object for the wrong client.
- [ ] **`Vary: Accept-Encoding`** is already emitted by `src/lib/edge-cache/response-headers.ts`
      on cacheable responses. Once compression is on, that header becomes correct;
      before that it only multiplies the cache key space.
- [ ] **Conditional validators** (ETag/`Last-Modified` → 304) already exist on the
      discovery routes — keep them when adding a new public surface.
- [ ] **Edge cache** is OFF by default and a true no-op when off; do not turn it on
      as an "optimisation" without reading `awcms-edge-cache` §Backbone first —
      a shared cache in front of a multi-tenant application is a leak engine.

<!-- aspirational:mulai -->

## Representative performance suite (Issue #744) — TARGET SPECIFICATION, NOT A RUNBOOK

> **`src/lib/performance/` does not exist in this repo** and the three commands
> below will fail. This section is kept as the **shape** a performance suite
> should take if it is built — not as instructions. See the banner.

For a performance audit that needs more evidence than a manual `EXPLAIN` —
scaled synthetic multi-tenant fixtures, load/soak/saturation-and-recovery
scenarios, and versioned query-plan regression budgets — the intended shape is:

```bash
# Safe subset (seconds) — run in the CI job `quality` (.github/workflows/ci.yml),
# NOT part of the `bun run check` composite (same as resilience:dr-drill):
bun run performance:suite -- --confirm-non-production=<APP_ENV>
bun run performance:query-plan:check -- --confirm-non-production=<APP_ENV>

# Full lane (large scale + soak, scheduled/manual — --full):
bun run performance:suite -- --confirm-non-production=<APP_ENV> --full
```

Adding a new budget (if that suite is built)? Register it in
`src/lib/performance/query-plan-budgets.ts` (its paired SQL in
`query-plan-runner.ts`) with a clear `approval.reason` — changing an existing
threshold must be a reviewed diff, not a runtime flag.
See [`performance-suite.md`](../../../docs/awcms/performance-suite.md)
for the full architecture, safe subset vs full lane, and the artifact format.

**What CAN be done TODAY without building that suite:** extend
`countQueries` (`tests/integration/query-budget.ts`) to the heaviest admin
screens and to the sitemap builder. The pattern is proven twice already (the SoD
test #181, then #385), and a ceiling over a fixture that is bigger than the
ceiling is what proves something — a ceiling over a single row does not, because
N+1 and a constant implementation both emit about one query.

<!-- aspirational:selesai -->

## Related skills

`awcms-new-migration` (add an index via a sequential migration), `awcms-integration` (external I/O & outbox), `awcms-testing` (benchmark/load test), `awcms-production-preflight` (`db:pool:health`), `awcms-edge-cache` (surfaces & purge), `awcms-security-hardening` (shared posture).

The **live** performance status — Core Web Vitals targets, what is already
right, and the thirteen gaps with their checkers — lives in
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §8–§9.
Update that document when a gap is closed; this page is the how, that document
is the state.
