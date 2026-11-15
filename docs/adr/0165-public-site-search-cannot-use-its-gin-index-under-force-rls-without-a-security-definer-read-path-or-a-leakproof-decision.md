🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0165-public-site-search-cannot-use-its-gin-index-under-force-rls-without-a-security-definer-read-path-or-a-leakproof-decision.id.md)

# ADR-0165 — Public site search cannot use its GIN index under FORCE RLS without a SECURITY DEFINER read path or a LEAKPROOF decision

- **Status:** Proposed (awaiting the owner's decision, question Q1)
- **Date:** 2026-11-15
- **Decision maker:** ahliweb (owner)
- **Resolves (when accepted):** Issue #1321.
- **Related:** [ADR-0040](0040-site-search-module-admission.md) amendment (prefix matching, #1305), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (authorization chokepoint). Tests: `tests/integration/site-search-prefix-plan.integration.test.ts`.

**Nothing is implemented by this ADR.** No migration, no route, no behaviour change. It records measurements and the security analysis so the owner can choose.

## Context

`searchSiteContent` filters `awcms_site_search_documents` with `search_vector @@ to_tsquery('simple', $q)`. The table has a GIN index on `search_vector`, and the table is `FORCE ROW LEVEL SECURITY` with the policy `tenant_id = current_setting('app.current_tenant_id')::uuid`.

PostgreSQL treats a row-level security policy as a **security barrier**: a user-supplied qual may be evaluated before the policy qual (and therefore be used as an index condition) only when its function is `LEAKPROOF`. `ts_match_vq`, the function behind `@@`, is not (`pg_proc.proleakproof = false`; so are `arrayoverlap`, `arraycontains` and the GIN support functions; only `texteq` among the candidates is). Under the runtime role the planner therefore cannot use the GIN index and instead reads the tenant's rows through the tenant btree index and filters them, computing nothing cheaper than a per-row `@@` recheck. A superuser connection bypasses RLS and does use the GIN index, which is why this is easy to miss.

## Measurements

PostgreSQL 18.7, 4 tenants x 50,000 documents (200,000 rows), one selective prefix query (`sungai & kapu:*`, 100 hits per tenant), `VACUUM ANALYZE`d, `enable_seqscan` left on, runtime role `NOLOGIN` non-owner with `FORCE` RLS and the production policy text. `EXPLAIN (ANALYZE)` of the production query shape (`ORDER BY ts_rank DESC, id LIMIT 20`):

| Variant                                                        | Plan                                                                    | Execution time |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| A. Status quo, runtime role                                    | Bitmap scan of the tenant btree index, `Rows Removed by Filter: 49,900` | 13 to 24 ms    |
| B. `SECURITY DEFINER` read function, tenant taken from the GUC | Function scan; inside it the GIN index                                  | 0.8 ms         |
| C. `ts_match_vq` marked `LEAKPROOF` (throwaway database only)  | Bitmap Index Scan on the GIN index, `Rows Removed by Filter: 300`       | 7.7 ms         |
| (reference) superuser, RLS bypassed                            | Bitmap Index Scan on the GIN index                                      | 0.8 ms         |

Variant A is **linear in the size of one tenant's corpus**, not of the table: a tenant with ten times the documents costs about ten times as much. At 50,000 documents per tenant it is tens of milliseconds, bounded by the public rate limit and `statement_timeout`. It is a scalability limit, not a correctness or security defect today.

## Options

### 0. Do nothing, keep the pinned plan

Accept A. The existing integration test pins that the GIN index is unused under the runtime role. Cost: linear per-tenant growth; the public endpoint is the one place where an unauthenticated caller drives it (rate-limited).

### 1. A query shape the planner can index under the barrier

**None exists.** Everything that can serve a full-text predicate from an index (`@@`, `&&`/`@>` on a lexeme array, `ts_rank` ordering) is non-leakproof; only `texteq` is leakproof, and it cannot express stemmed or prefix matching. A CTE, `OFFSET 0`, a subquery or a LATERAL join does not change the security level of the user qual relative to the policy qual. A separate non-RLS lookup table would hold tenant data outside RLS and is a boundary change, not a query shape. This option was investigated and is **not available** without changing a boundary.

### 2. `SECURITY DEFINER` read function (variant B)

A function owned by the table owner that takes the tenant from `current_setting('app.current_tenant_id')`, filters by it itself, and returns rows. About 20 to 30 times faster than A, and independent of `LEAKPROOF` catalog state.

Security analysis: the function runs **with the owner's privileges and therefore bypasses RLS on that table**. Tenant isolation then depends on the function body alone (the `tenant_id` predicate and a pinned `search_path`), not on a policy PostgreSQL enforces on every statement. This is a real weakening of defence in depth, it needs `awcms_app` `EXECUTE` only on that function, and it needs a gate that proves the body contains the tenant predicate and that `search_path` is pinned (the repository's RLS probes would have to learn this exception). ADR-0063 requires authorization to go through `authorizeInTransaction` at the handler; that stays, the function replaces only the data read.

### 3. Mark `ts_match_vq` `LEAKPROOF` (variant C)

About 2 to 3 times faster than A in the test (index used for the full-text predicate, tenant filtered after). It is a change to a **system catalog function** that requires a superuser, is not reproduced by a restore or a major-version upgrade on its own, and would have to be re-applied by the deploy procedure. Leakproof means the function never reveals its arguments through errors or side effects; `ts_match_vq` can raise errors depending on the data (for example on very large vectors or malformed input), so marking it is a claim about the PostgreSQL implementation that the project cannot verify. Under RLS the point of the barrier is exactly that such a function must not see another tenant's rows first. **Not recommended**, and it must never be done without this ADR.

## Recommendation

Option 0 now (it is bounded by a rate limit and a timeout) and, if a tenant corpus grows past the point where tens of milliseconds per public search matters, **option 2** with the gate described above, because it is local to one function, has the best measured result, and keeps the boundary reviewable in one place. Option 3 is rejected. This is a recommendation, not a decision.

## Open questions

- **Q1 (owner):** accept option 0 as the standing decision (close #1321 as "accepted, measured, pinned"), or authorise option 2 with its gate (a follow-up migration and tests)? Option 3 is not on offer.

## Consequences

If accepted as option 0: `tests/integration/site-search-prefix-plan.integration.test.ts` stays the pin and this ADR is its recorded reason. If option 2: a migration adds the function and grants, the search service calls it, the RLS probes and the plan test are updated in the same change, and the ADR becomes Accepted with its own security review.
