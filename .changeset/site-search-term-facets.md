---
"awcms": minor
---

feat(site-search): a reader can narrow a search by channel, topic, institution and region (#633)

PRD FR-DSC-002 asks for six facets. #632 landed **content type** alone, and not
for want of time: the other dimensions had nowhere to come from.

`awcms_site_search_documents` carries `tags text[]`, filled from the search-source
descriptor's `tagsColumn` — and `tagsColumn` names **one column on the source
table**. Since `sql/131`, channel and topic are `awcms_blog_terms` rows reached
through `awcms_blog_post_terms`, and institution is `awcms_blog_institutions`
reached through `awcms_blog_post_institutions`. A column name cannot express a
join, so there was no value `tagsColumn` could have been given that was correct.
Both descriptors read `tagsColumn: null`, and that was the honest answer.

### The descriptor learned to say "join"

`SearchSourceTermFacet` has two shapes, because the data has two. A `join` facet
names a link table, a value table, and the columns tying them together; a
`column` facet names a column on the source row. `region` is the second kind —
PRD §8.5 gives an article exactly one region, and declaring it through a join it
does not have would be a fiction the query builder would then have to honour.

One shared vocabulary table becomes two facets through `valueEquals`
(`taxonomy_type = 'channel'` vs `'topic'`), and `valueNullColumns` is the
soft-delete gate. Values are **slugs**, labels are names: renaming a channel must
not break every saved filter, and it does not, because the name travels
separately.

### The gate grew in the same change, because it had to

Every name in a term facet is interpolated into SQL. `site-search:sources:check`
now validates the join shape field by field — and, more importantly, walks
**every table a descriptor names**, including the ones it only reaches through a
facet join. That last part is #625 one layer deeper: a descriptor whose join
touches a table `awcms_worker` cannot `SELECT` passes every check here and fails
at 03:00 with `permission denied`. `sql/140` adds the four grants; removing any
one of them turns the gate red, which is how it was verified rather than assumed.

### Where the facets live, and why not in `tags`

A `term_facets jsonb` column on the document, written by the **same upsert** as
the document itself. A separate table would mean a delete/insert cycle that can
succeed halfway, and the failure mode is a facet count that disagrees with the
documents it claims to describe — the same drift the issue warns about for the
trigger-maintained variant. As one column they cannot drift, and they are covered
by the same checksum.

They are deliberately **not** folded into `tags`, which feeds `tags_text` and
therefore the weighted `search_vector`. Putting facet values there would change
relevance ranking as a side effect of adding a facet, and would let a reader
match a filter value as free text.

The checksum change matters more than it looks: moving a post between channels
touches no column of the post itself, so without the facets in the checksum the
reconcile sweep would report `unchanged` and the facet would keep counting it
under the old channel forever. A document with **no** facets hashes exactly as it
did before, so deploying this does not rewrite every document in every tenant.

### The "don't narrow a facet by its own filter" rule, generalized

#632 encoded it in the type — `Omit<…, "resourceType">` made the filter
unrepresentable. That was right with one facet and wrong the moment there were
five, because a facet must apply every filter **except its own**. So the type
counts now do apply the term filters, each term facet applies the type filter and
the other term filters, and a facet the reader has actively filtered on gets its
own pass with only that filter removed. That is one extra query per active term
filter, and there is no way to fold them into the first.

Filtering is by `?channel=politik&topic=pemilu`, ANDed, matched with a single
GIN-backed `@>` containment. Parameter names come from the registry, so an
undeclared one is **ignored** rather than passed through — otherwise an anonymous
caller could probe the index's shape by watching the count. Ignoring beats
rejecting: `utm_source` and `fbclid` ride along on every shared link, and a search
that 400s because somebody arrived from Facebook is a search that looks broken.

The cross-tenant negative is tested against real Postgres for term facets
specifically, rather than inherited from the type facet's assumption — both
tenants in the fixture use the slug `politik`, so a leak reads as a wrong number
rather than passing quietly.
