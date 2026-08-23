---
"awcms": patch
---

docs(site-search): the reader's search box exists, so its two paths stop being a promise (#607, #597 item 3)

`GET /api/v1/site-search/query` and `/suggest` were frozen as **COMMITTED** in
#681 (ADR-0107) — a shape this repo had agreed to keep for a consumer that did
not exist yet. `ahliweb/awcms-astro` now publishes the box (its ADR-0043), so
both move to **CONSUMED**, which is the direction the cross-repo Definition of
Done requires: freeze here first, call there second.

### "Consumed" stopped meaning "the build calls it"

The seven entries that were already there are called by `astro build` over
there, from a machine holding a read-only credential. These two are called by
the **reader's browser**, anonymously and cross-origin, and that difference is
invisible from this side: both are `GET`s against this API, and the gate over
there extracts string literals from `src/` without knowing who executes them.

It is written into `CONSUMED_PATHS`' own docblock because it changes what
breaking one costs. A shape change on a build-called path reddens a build
somebody is watching. A shape change on these two fails **silently in a
stranger's browser**, on a site that was published weeks ago and will not be
rebuilt on account of it.

### What the consumer actually relies on, beyond the result shape

Recorded here so it is not discovered by breaking it:

- **No `OPTIONS` handler is the contract, not an omission.** The box calls both
  paths with `fetch` and no custom headers, which keeps them *simple requests*.
  A header added on either side turns them into preflighted ones, and the
  preflight has nothing to answer it.
- **The facet payload is load-bearing.** The chips render from
  `facets.resourceTypes` and `facets.terms`, and they rely on each facet being
  counted WITHOUT its own filter — that is what keeps a reader who narrowed to
  one channel able to click back out.
- **`suggest`'s own limits still apply.** The consumer debounces and enforces a
  minimum length client-side; both are courtesies, not controls, and this repo's
  `min_query_length` and per-IP limit remain the only enforcement.
