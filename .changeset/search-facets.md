---
"awcms": minor
---

feat(site-search): a search result set can say what else is in it (#607)

`GET /api/v1/site-search/query` returned a ranked list and nothing about the
shape of the set it came from. A reader could not narrow by content type, and a
build client had nothing to render a filter from. `search-query.ts` emitted no
aggregation at all, which the issue named as the one item of its scope that
might need backend work — it did.

`countSearchFacets` counts per `resource_type` over the same result set, and the
endpoint returns them on every page.

### The filter is deliberately not applied to its own counts

A facet answers *"what else is there"*, so it is computed BEFORE the facet's own
filter narrows the set. Applying `resourceType` would zero every other value the
moment a reader picks one — and a reader looking at a list of zeroes has no way
back to results that still exist, because the interface has stopped saying they
do.

Every OTHER predicate is shared with the result query character for character:
same tenant, same locale, same `websearch_to_tsquery`, same admitted-type
allow-list. A count derived from a wider predicate advertises documents the
reader cannot reach. The signature is an `Omit<…, "resourceType">`, so passing
the filter is unrepresentable rather than merely unused.

### It cannot become a cross-tenant oracle

A COUNT leaks the existence of content without displaying it, so a facet that
escaped its tenant would be a disclosure with nothing on screen to notice it by.
The explicit `tenant_id` predicate and RLS FORCE both bind it, and the
integration suite asserts it negatively against a real database with both tenants
holding rows that match the same query — non-vacuously, since tenant B holds
more than tenant A.

Counts are computed on every page, including cursor pages: they describe the
whole result set rather than the page, so omitting them after the first would
make them look like they had changed. The value list is bounded.

### The neutral payload stays one shape

`facets` is present and `required` in every response — an unresolved host, a
disabled tenant, a rejected query and a real answer. A key present in one shape
and absent in another re-opens exactly the distinction that neutral payload
exists to close.

Two of the issue's three scope items are unchanged by this and belong elsewhere:
the reader search box and autocomplete consumer are `awcms-astro`'s under
PRD §27.1, and the endpoints they need already exist. Term facets — channel,
institution, region, topic — need the index to carry them first; see the
follow-up issue for why `tagsColumn` cannot express a join table.
