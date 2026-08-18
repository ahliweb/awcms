---
"awcms": minor
---

feat(blog-content): channel, institution, region and topic stop being one string

An article filed under "Legislatif" also belongs to DPRD Kotawaringin Barat, to
Kabupaten Kotawaringin Barat, and to the topic APBD. Until now `blog_content`
could express one of those four things at a time: `awcms_blog_terms` knew only
`category` and `tag`, so all four collapsed into one flat vocabulary and stopped
being distinguishable afterwards. The archive could not answer "every article
about this legislature" without a `LIKE`.

**`channel` and `topic` join the term vocabulary** (`sql/131`). They are exactly
what a term already is — a tenant-scoped, named, sluggable label — so they reuse
the whole existing surface: the dedup index, the RLS policy, the soft delete,
`awcms_blog_post_terms`, the admin screen, the endpoints. `topic` joins `tag` as
a FLAT vocabulary, because nesting cross-channel issue labels raises "is Korupsi
under Hukum or under Politik", a question with no editorial answer. `channel`
stays nestable: it is primary navigation and Olahraga → Sepak Bola is real.

**Institution becomes its own table**, not a fifth term. It carries a `branch`
(legislative/executive, which is what builds each mega menu in one query), a
region, and the SEO title and description of a public landing page. Modelling
that as a term would mean four columns that are NULL for every category and tag,
or storing them as convention inside `description` — the same untyped-string
collapse this change exists to end. `awcms_blog_post_institutions` lets one
article name several bodies, because a single event routinely involves more than
one.

**Region is a code, not a term and not a foreign key.** `region_code` holds a
dotted `idn_admin_regions` code (`62`, `62.71`, `62.71.01`). It is deliberately
not an FK: that master is dataset-versioned, the same Palangka Raya carries a
different `id` in every import, and an FK would pin each article to one
generation of the Kepmendagri list and break the next time a dataset is
activated. An unresolvable code degrades to "no region label" on render rather
than failing the read.

### What this also fixed on the way

- **`validateTermParent` compared against the literal `"tag"`.** Under that
  version a nested `topic` passed validation and failed only at the database,
  surfacing as a raw constraint violation instead of a field error. The flat set
  is now read from `FLAT_TAXONOMY_TYPES`, and `/admin/blog-taxonomy`'s parent
  control reads the same constant instead of its own copy of the literal.
- **Three validator messages hard-coded "one of category, tag"**, so the moment
  the enum widened they told callers that `channel` was invalid while the
  validator accepted it. They are derived from the vocabulary now.
- **`purgeBlogPost` would have failed with a foreign-key violation** on any post
  carrying institutions — the new join table holds a real FK to
  `awcms_blog_posts`, so the missing DELETE does not leak rows, it breaks the
  purge. Both join DELETEs are now named as load-bearing rather than tidy.

### `institutions.purge` exists because retention needed a mechanism

`data-lifecycle:table-coverage:check` asks every new table how its rows ever
leave. The easy answer was the `BOUNDED_BY_DESIGN` ledger — "there are only
thirty legislatures, it will not grow". That ledger is capped at sixteen and its
bar is a net shrink, not another argument, and the bar is right: an expectation
about growth is not a retention policy. So the mechanism was built instead.
`POST /api/v1/blog/institutions/{id}/purge` removes a soft-deleted institution
and its article links, refuses a live one (the two-step `posts` and `pages`
already require), requires an `Idempotency-Key` — unlike restore, which is
idempotent by construction — and audits at critical severity. Both new tables
carry `delegated` lifecycle descriptors adopting it.

### Client asset budget: raised to 184,000 B, after two wrong measurements

`bun run build` did fail on `main` when this work started — 181,336 B against a
180,000 B ceiling. But `astro` 7.2.0 -> 7.2.3 then shed 2,411 B of its own
output, putting `main` back under at 178,925 B, so the ceiling was NOT left at
the 190,000 it was briefly raised to. A budget raised past a breach that has
since healed has stopped measuring anything.

This change genuinely costs **2,493 B** — not the 82 B first reported, which was
measured against a stale `dist/`. A whole admin screen for that price only
because it reuses `admin-form-client` and `admin-screens.css`. The ceiling
therefore moves to 184,000 B, leaving ~2.6 kB: about one more screen, which is
the point of the gate.

Recorded for issue #590: the theory that `_astro/error-log.*.css` (24,909 B) is
bloated by duplicating `admin-screens.css` is **disproved**. It is `admin.css`,
the AdminLayout stylesheet, merely named after `error-log` because Vite names a
shared CSS chunk after one of its JS importers.
