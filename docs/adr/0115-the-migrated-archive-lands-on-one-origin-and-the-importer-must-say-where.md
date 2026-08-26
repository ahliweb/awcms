🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0115-the-migrated-archive-lands-on-one-origin-and-the-importer-must-say-where.id.md)

# ADR-0115 — The migrated archive lands on ONE origin, and the importer has to say where each article goes

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decision maker:** ahliweb
- **Completes:** [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md) — it decided that a legacy article resolves on its **leading digits** and that the 301 is issued at the **edge**, and it left the id→path table's **destination** unstated. The only article derivation in the repo hard-codes `/blog/{tenantCode}/{slug}`, so the two committed halves of one cutover pointed at **two different origins**. This ADR states the destination and closes that.
- **Related:** Issue #599 (the article half of the SeputarBorneo cutover); Issue #711 (the rubrik half); [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md) (the rubrik listings flatten to `/kategori/{slug}`); [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (the public URL vocabulary is split per repo); [ADR-0100](0100-portable-text-is-the-canonical-body-format.md) (`content_json.blocks` is a derived projection, and `contentJson.awcmsAstro` is a sidecar this repo must preserve); [ADR-0098](0098-the-cache-key-carries-the-locale-in-the-path.md) (this repo's public surface is locale-prefixed); [ADR-0111](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.md) (a rule that cannot fire is worse than no rule); PRD §9.2 (no chain longer than one hop)

## Context

### The importer produced articles the serving repo builds no page for

`importLegacyBlogPost` wrote `content_json` as a hard-coded `{ blocks: [] }`. Its
own docblock said that was _"the same lossy projection every other write path
produces … so an imported row is indistinguishable in shape from an authored
one"_. It was not: `blog-post-directory.ts` and `blog-page-directory.ts` both
call `withProjectedBlocks`, and this file called nothing. **A comment is not a
call** — this repo's recurring class, and here it decided the whole cutover.

That one literal controls two separate things in `ahliweb/awcms-astro`:

1. `renderContentBlocks(post.contentJson)` reads `contentJson.blocks` and
   returns `""` for anything that is not a non-empty array. Every imported
   article would have been a **blank page**.
2. `getArticles(tab, locale)` keeps a post only when
   `readBlock(post).kategori === tab`, reading `contentJson.awcmsAstro`. With no
   such key that comparison is `undefined === tab` for every configured tab, so
   the post is **not built at all** — and neither is any category archive,
   because `artikelSemuaSeksi` assembles those from the same tab-filtered set.

Not argued — run. Against that repo's real adapter, a post carrying the sidecar
builds **1** article; a post written exactly as this importer wrote it builds
**0**, in every configured tab.

So ADR-0113's 63 rubrik rules and ADR-0114's id-keyed article map would each
have redirected onto a page that was never generated —
`CUTOVER_VERDICT_REASON.target_missing` in its own words, _"a 301 into a 404,
which is worse than the 404 it replaces"_, and the one outcome both issues'
Definition of Done forbids.

**Why no gate here could see it.** This repo renders `/blog/{code}/{slug}` from
`body_portable_text` and falls back to the projection only for un-backfilled
rows (`blog-body-rendering.ts`), so an imported post looks perfect **here**. The
consumer that reads the projection is in another repository. That is ADR-0114's
lesson one level down: the check is not only _"is this symbol called"_ and not
only _"is the caller in the request path"_, but **"does the repo that SERVES
this read the field this writer skipped"**.

### And the destination had never been chosen

ADR-0113 sent the rubrik listings to `/kategori/{slug}`, served by
`awcms-astro`. Nothing then said where the ARTICLES go. The only article
derivation in the repo, `listLegacyRedirectMappings`, builds
`` `/blog/${tenantCode}/${row.slug}` `` — **this** repo's surface. One cutover,
two origins, and a reader clicking an article out of a category archive would
have crossed between them.

### A prefix rule that is right here and wrong there

`withPublicLocalePrefix` (ADR-0098) prefixes **every** locale, the default one
included: `/id/hukum/x`. `awcms-astro`'s `localePath` does the opposite — it
returns the path **unchanged** for its default locale and prefixes only the
others. All 25,029 SeputarBorneo articles are in the default locale, so an
artefact built with this repo's rule would 301 every one of them into a 404. The
committed rubrik map already says so out loud: its targets are
`/kategori/daerah`, not `/id/kategori/daerah`.

## Decision

**1. Both halves of the migrated archive land on ONE origin: `ahliweb/awcms-astro`.**
An article's path is `/{section}/{slug}/` in the consuming site's default locale
and `/{locale}/{section}/{slug}/` otherwise, where `{section}` is that site's tab
slug. `/blog/{tenantCode}/**` is not the destination for this cutover.

The trailing slash is that site's CANONICAL form — its build emits
`{tab}/{slug}/index.html`, its sitemap lists the slashed form and each page's
`<link rel="canonical">` names it. It is deliberately not justified as a hop:
probed against the real built server, both spellings answer 200 with no
`Location`. 25,029 permanent redirects onto a non-canonical spelling is the
problem, and for a migration whose whole purpose is preserving ranking that is
enough.

**2. `blog:legacy:import` writes the envelope the consumer reads.**
`content_json.blocks` is the DERIVED projection (`withProjectedBlocks`, the same
call the two authoring directories make), and `content_json.awcmsAstro.kategori`
carries the section, supplied by a new `--section-map`.

**3. The section is DECLARED, never derived.** A section is a tab slug in the
consuming repo's `siteConfig.tabs`. Nothing in this database can be checked
against it, so the map is the one map with no verification sweep behind it, and
the run PRINTS the vocabulary it was handed instead of pretending to check it.

**4. A missing `--section-map` WARNS; a row that map cannot place is REFUSED.**

### Why one origin, and not the two the code currently implies

ADR-0071 splits the public URL vocabulary **one family per repo, never both in
one repo**. A site whose category archives are served by one origin and whose
articles are served by another is that rule broken at the seam a reader actually
crosses: every link out of `/kategori/hukum` would leave the origin it was
rendered by. `/blog/{tenantCode}/**` also carries a tenant code in the public URL
of a site that has its own domain — a shape ADR-0071 keeps only because it was
once advertised, not one to migrate 25,029 indexed URLs onto.

### Why declared and not derived

A term is a row in this database; a section is a value in another repository's
config file. They look alike and are not, and the failure from conflating them
is silent: an article filed under a term that names no configured tab imports
cleanly, reports nothing, and is built by nobody. `--term-map` and `--media-map`
are each verified against a table here. This one cannot be, and saying so is
more useful than inventing a check that would pass while being wrong.

### Why a missing map warns rather than refusing

A tenant served by **this** repo at `/blog/{tenantCode}/{slug}` needs no sidecar
at all. Refusing 25,029 rows over a repository the operator may not be using
would be the wrong failure. Supplying the map is the declaration that the
sibling site serves this archive — and under that declaration a row it cannot
place is refused, because importing past it produces precisely the 301-into-a-404
this whole cutover exists to prevent.

## Consequences

- **The artefact generator exists.** `bun run blog:legacy:article-paths` derives
  the id→path table from the tenant and emits it with provenance, preview by
  default. It **refuses to emit while any row lacks a section**: an artefact
  that is 96% right is one nobody audits.
- **`--default-locale` is a required flag on it**, not a constant. It is the
  consuming repo's value, and baking one deployment's configuration into a
  generator whose wrong answer is silent is the ADR-0114 mistake with a
  different subject.
- **An HTTP-level verifier exists.** `bun run blog:legacy:edge:verify` requests
  the legacy URLs and reads the `Location` headers a reader would get. It is the
  only tool in this repo that can say anything about the edge, and it is the
  replay that falsified ADR-0113, made repeatable — an operator command that
  exits non-zero, deliberately NOT in the `bun run check` chain, because it
  only means anything once the edge is wired. `blog:legacy:cutover:verify`
  is unchanged and still makes zero HTTP requests; the two answer different
  questions about different layers and both keep saying which.
- **Two new verdicts.** `unsafe_redirect` — a hop pointing at a non-HTTP
  scheme, a credentialed URL, or a private/loopback/link-local literal is
  refused rather than followed, because `Location` is written by whatever
  answered the previous request. Before the guard, `file:` and `data:` hops were
  both followed and classified **`ok`**. It reuses `isBlockedAddress` from
  `ssrf-guard.ts`; `validateOutboundUrl` cannot be reused whole because it
  refuses `http:`, which is the shape a crawler holds, and `ssrfSafeFetch`
  follows redirects internally, which destroys the hop-by-hop visibility the job
  exists to produce. Hostnames are deliberately not resolved — a stated
  boundary for an operator-run CLI that sends no credentials and reads no body,
  not a hole. And `unreachable`: A request that never produced an answer
  used to classify as `no_rule`, whose reason text is the confident _"this URL
  will answer 404 after cutover, and its ranking is lost"_. A 502 while the
  origin restarts would have sent an operator to fix a rule that is already
  correct. It is the `target_unverifiable` argument one row over.
- **`listLegacyRedirectMappings` now uses the route's full predicate.** It
  promised _"only PUBLISHED, non-deleted posts"_ over exactly those two
  conditions, while the route that serves the target requires four — so a
  `private` post and a future-dated one each got a rule whose destination
  answers 404. The paragraph named the failure its own function produced.
- **No VCL, no nginx `map`, no bulk-redirect CSV is generated.**
  `infra/varnish/default.vcl` is the file that runs in production
  (`docs/awcms/environments.md`: "copied verbatim … checksums matched") and it
  imports `std` and nothing else — Varnish OSS has no dictionary vmod there, so
  25,029 keyed lookups are not expressible in it. Two neutral forms are written
  instead, JSON with provenance and a two-column TSV, and choosing the tier stays
  the operator's. Guessing it would be the same class of error as assuming which
  repo would serve a path.
- **The rubrik map's targets are slashless, and that is a property of the
  mechanism ADR-0114 made inert — not an inconsistency to paper over.** All 63
  non-null targets in `data/seputarborneo-legacy/rubrik-redirects.json` read
  `/kategori/daerah` while the consuming site's archive page canonicalises to
  `/kategori/daerah/`. The map cannot say otherwise: run
  `validateRedirectTarget("/kategori/daerah/", [])` and it returns
  `/kategori/daerah` — `awcms_seo_redirects` structurally cannot hold a
  trailing-slash target, and that builder validates every entry through it.
  So the stored form is the only form that table can express, and the table is
  the mechanism this ADR's predecessor declared inert. **The canonical slash
  therefore belongs to the EDGE artefact, not to the committed map**, and an
  edge emitter derived from that map must add it exactly as
  `consumerArticlePath` does. Recorded rather than fixed in place: rewriting a
  committed derivation record to suit a consumer it was not derived for would
  destroy the provenance that makes it auditable.
- **The section vocabulary must exist in the CONSUMING repo's `siteConfig.tabs`
  before any of this renders.** `getArticles` is called once per configured tab
  and keeps a post only when `readBlock(post).kategori === tab`, so a section
  slug that names no configured tab builds nothing — the same zero-page outcome
  as no sidecar at all. "Import the archive and rebuild" is therefore NOT
  sufficient: the tabs are a hard-coded list in that repository, and adding the
  ten SeputarBorneo sections to it is a code change there, ordered BEFORE the
  rebuild. Nothing here can check it, which is why the importer prints the
  vocabulary it was handed and says to compare it against that file.
- **The media blocker is unchanged and still hard.** ~25,031 uploads / 4.1 GB:
  the importer refuses any row whose `featuredImageSrc` the `--media-map` does
  not cover, and 25,029 of 25,029 rows have one.
- **This repo still cannot close the cutover**, and this ADR does not change
  that. It can now produce every artefact and verify the result over HTTP; the
  edge wiring and the `awcms-astro` rebuild remain operational steps outside
  both repositories.
