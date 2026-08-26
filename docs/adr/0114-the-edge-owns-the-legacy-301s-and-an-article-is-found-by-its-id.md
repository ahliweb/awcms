🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.id.md)

# ADR-0114 — The edge owns the legacy 301s, and a legacy article is found by its id

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decision maker:** ahliweb
- **Refines (partial supersede):** [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md) — its §Consequences state _"`awcms-astro` needs no change for this… the redirect is resolved in this repo before its routes are reached"_. **That sentence is false**, and it is the most consequential error in this cutover's record: the targets it chose are served by a repo whose production entrypoint contains no redirect code. What is superseded is **who executes the 301** and **how an article URL is keyed** — not the flattening itself, which stands: `/rubrik/X.html` and `/A/B.html` still land on the parent rubrik's archive, `kt` still dropped. ADR-0113's shape-4 decision is retracted in place, because the URL family it decides has never existed.
- **Related:** Issue #711 (the rubrik/listing half of the SeputarBorneo cutover); Issue #599 (the article half); [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) / [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) / [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (the public URL vocabulary is split, and the news archive is rendered by `ahliweb/awcms-astro`); [ADR-0039](0039-seo-distribution-redirect-governance.md) (redirect governance); [ADR-0042](0042-varnish-edge-cache-auto-activation.md) / [ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md) (the Varnish edge in front of the public surfaces); [ADR-0111](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.md) (a rule that cannot fire is worse than no rule); `sql/060` §2 (exact-path rules only, by design); PRD §9.2 (no chain longer than one hop)

## Context

### Three layers could carry these 301s, and no document said which

`seputarborneo.com` becomes a tenant. Its indexed URLs must reach the new pages
in **one hop**. Three layers sit on that request path — the edge
(Coolify/Varnish), `ahliweb/awcms-astro`, and this repo — and every plan written
so far assumed the third without ever saying so, because this repo is the one
that has a redirect table.

### The shipped map's targets are served by an origin that has no redirect code

`awcms_seo_redirects` is applied at **exactly one call site**:
`resolvePublicRedirectForRequest`, called from `src/middleware.ts:341`. That
middleware runs in **this** application. Everything it can redirect is a request
this application received.

ADR-0113 chose `/kategori/{slug}` as the destination for all 62 rubrik rules.
`/kategori/**` is served by `ahliweb/awcms-astro`, which is `output: "static"`,
has **no middleware file at all**, declares no `redirects:` key, and whose
production entrypoint `server/penyaji.mjs` contains **zero** occurrences of
`301` or `Location`. `grep -rn seputarborneo` over the whole of that repo's
`src/` and `docs/` returns **nothing**.

This was not reasoned about — it was executed. All 67 committed rubrik entries
were replayed against the real built server: **404 on every one, with zero
`Location` headers**. A rule written into this repo's table is never consulted
for a request that never arrives here.

So the sentence in ADR-0113 §Consequences was exactly backwards. `awcms-astro`
does not "need no change because the redirect is resolved here" — under that
plan it is the only place the redirect could be resolved, and it resolves
nothing.

### And the article shape, which #599 believed was solved, matches nothing either

The legacy article URL is `rawurlencode(str_replace(' ', '_', judul))`, so every
segment carries `_`. All **25,029** legacy titles contain at least one space, so
all 25,029 segments carry at least one `_`. `SLUG_PATTERN` at
`src/modules/blog-content/domain/legacy-import-record.ts:117` is
`/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — it **forbids** `_` and forbids capitals.
`normalizeRedirectPath` preserves case and decodes nothing, and matching is by
equality (`application/redirect-directory.ts:133`).

**No slug that can pass the validator can ever equal the indexed segment.** The
two slugs are disjoint by construction, not by accident. Externally confirmed:
of 2,297 archived `/news/*.html` URLs, 2,297 use the underscore form and 0 use a
hyphen form.

And the miss is worse than a miss. An unmatched `/news/**` falls through to
`resolveRetiredNewsRedirect`
(`src/modules/seo-distribution/application/redirect-resolution-service.ts:126`),
which 301s to `/blog/{code}/{id}_{Raw_Slug}.html` — a path no post has. That is
`CUTOVER_VERDICT_REASON.target_missing` in its own words: _"a 301 into a 404,
which is worse than the 404 it replaces"_.

The inference error is worth naming so it stops recurring. `berita/index.php:9`
reads `(int) $_GET['news']`, so on the **legacy** router the id is the leading
digits and the slug is decorative. That is true, and it says nothing whatever
about this repo, whose rule keys are **exact strings**. A fact about one router
was carried across as a fact about another.

## Decision

**1. The edge (Coolify/Varnish) owns the SeputarBorneo legacy 301s.** When
`seputarborneo.com` becomes a tenant, the redirects execute at the edge, before
either application sees the request.

**2. A legacy article URL resolves on its LEADING DIGITS.**
`/news/{id}_{Title}.html` is keyed on `{id}` against
`awcms_blog_posts.legacy_source_id`, never on a title-derived slug. It is
materialised for the edge as a generated id→path table.

### Why the edge, and not either application

Only the edge can collapse the three redirects a reader actually needs —
`http→https`, `www→apex`, and `legacy→new` — into **one** 301. That is what PRD
§9.2 requires, and neither application layer can deliver it: an application only
sees a request after TLS termination and after whatever the edge already did
with the host, so a rule it writes is at best the **second** hop of a chain the
edge started. One hop is not an optimisation here; it is the requirement.

Everything else follows from that. The edge is also the only layer that sits in
front of **both** origins, so it does not need to know which of the two would
have served the URL — which is precisely the knowledge whose absence produced
the falsified claim above.

### Why id-keyed, and not one rule per URL

- **It is immune to title drift.** An exact-path rule encodes the title as it
  stood on the day the map was built. An editor fixing a typo in 2027 does not
  invalidate a leading-digit match; it invalidates 1 of 25,029 exact rules,
  silently.
- **It is immune to both historical encodings.** The archive contains
  `%20`-form and `_`-form segments from different eras of the legacy site. Both
  carry the same leading digits.
- **It is one rule shape instead of roughly 33,779 rows** — the number of exact
  source paths an equality-matched map would have to carry to cover the archive
  as it was actually indexed. A table that size is not reviewable, and every row
  of it is a chance to be wrong in a way nobody can see.
- **An unknown id yields a genuine 404**, not a 301 into a 404. That is the
  single property `CUTOVER_VERDICT_REASON.target_missing` exists to protect, and
  exact-path matching over a slug that cannot match loses it by default.

### What this makes INERT, stated plainly so nobody reaches for it

**`awcms_seo_redirects` is not the mechanism for this cutover.** Neither is the
`--path-template` flag on `blog:legacy:redirects:import`. Both work, both are
tested, and both write rules into a table consulted by a middleware that these
requests will never reach. They remain the right tool for a tenant redirecting a
path **this** application serves; they are the wrong tool here, and the record
until now said otherwise.

The deliverable from this repo is therefore **a generated artefact plus its
provenance** — the id→path table and the rubrik map, derived here, committed
here, loaded by the edge. Wiring it into Varnish/Coolify is an operational step,
not a commit.

## Consequences

- **This repo cannot close the cutover.** It can produce and verify the
  artefact; the last step happens in infrastructure configuration that lives
  outside both repositories. Any issue that claims the cutover is "done" when
  the artefact is committed is claiming the wrong thing.
- **The 62 rubrik rules keep their targets and change their carrier.** No
  destination changes, so the ten destination categories are still a
  precondition — but they are now a precondition for the **edge** map, not for
  a table load here.
- **`blog:legacy:cutover:verify` is verifying the wrong layer** for these URLs
  as long as it models this repo's resolution. What it predicts is what
  `src/middleware.ts` would do, and for a `/kategori/**` target that is not what
  a crawler will see. Correcting it is code, and it belongs to the phase after
  this one.
- **A generated table is a generated table.** The id→path artefact is derived
  from the legacy database and the imported posts; it is regenerated, never
  hand-edited, and it carries the provenance that says which snapshot produced
  it — the same rule `data/seputarborneo-legacy/rubrik-redirects.json` already
  follows.
- **A count the record gets wrong, corrected once, here.** "23,906 articles"
  appears in Issue #599's body, in four changesets, in ADR-0111, in two
  migration headers and in twenty-odd source comments. The measured snapshot is
  **25,029**, and the live legacy site is at id ≥ 25,474. Documents that make a
  live claim are corrected; changesets and merged ADRs are **not** rewritten,
  because they record what was believed when they were written and rewriting
  them would destroy the only evidence of when the belief changed. This
  paragraph is the correction they point at.

## Alternatives considered

**`ahliweb/awcms-astro` carries the redirects.** It is the origin that serves
the targets, so this is the option that looks obvious once the defect above is
seen. Rejected on cost and on hop count. It needs a build-time redirect table
compiled into `server/penyaji.mjs`, which today contains no redirect code at
all, plus the full three-step cross-repo contract dance (a surface committed
there, called here, then consumed) for every change to the map. And it still
cannot deliver one hop, because `http→https` and `www→apex` happen in front of
it. There is a trap worth recording for whoever revisits this: Astro's
`redirects:` config key under `output: "static"` emits **meta-refresh HTML, not
301s** — a redirect a browser follows and a crawler treats as a page, which
would pass a casual manual check and lose the ranking equity the whole cutover
exists to preserve.

**This repo carries the redirects, as ADR-0113 assumed.** It works exactly as
built — the table, the importer and the middleware are all correct — but only
for paths this application serves. Buying that means moving all 62 rubrik
targets from `/kategori/{slug}` to `/blog/{tenantCode}/category/{slug}`, which
sends every legacy rubrik URL to the **wrong half of the split vocabulary** and
would require restating ADR-0071's `/blog/**` here, `/news/**` there boundary
for this domain. Rejected: a redirect layer chosen because it is the layer we
already own is how a URL vocabulary decision gets made by accident.

**Write the 25,029 exact article rules anyway, with the slugs fixed.** Rejected
by arithmetic before it is rejected by taste: the fix would be to relax
`SLUG_PATTERN` to admit `_` and capitals, which changes what a slug **is** for
every tenant in the product in order to serve one migration. And it would still
be 25,029 rows that go stale the first time an editor renames an article.
