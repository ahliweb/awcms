---
"awcms": patch
---

Query budgets on the hot public read paths.

An N+1 is invisible to every other kind of test: the rows are right, the
assertions pass, the response is byte-identical, and only the number of round
trips differs. It surfaces in production as latency that grows with content,
months after the code landed.

`tests/integration/query-budget.ts` extracts the Proxy-apply-trap the SoD suite
already proved out into a reusable `countQueries`, and the accompanying
integration test binds the listing, paging and feed paths to a ceiling of three
queries against a 40-post fixture.

The fixture size is the point: a bound asserted against one row proves nothing,
since an N+1 and a constant-query implementation both issue about one query.
Mutation-proven by injecting a real N+1 into `listPublicBlogPosts` — two budgets
turn red. A fourth test guards the instrument itself, because a Proxy that
silently stopped counting would make every budget pass vacuously.

These are the paths the edge cache fronts, which is why the count matters: a
cache MISS pays the full cost, and auto-activation only engages once the origin
is already under pressure.

No ADR: this adds no standing rule and no gate to `bun run check`.
