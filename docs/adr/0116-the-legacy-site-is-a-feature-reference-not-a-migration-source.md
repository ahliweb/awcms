🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0116-the-legacy-site-is-a-feature-reference-not-a-migration-source.id.md)

# ADR-0116 — The legacy site is a feature reference, not a migration source

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decision maker:** ahliweb
- **Amends:** [ADR-0113](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md), [ADR-0114](0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md), [ADR-0115](0115-the-migrated-archive-lands-on-one-origin-and-the-importer-must-say-where.md) — their **mechanics stand unchanged**; the **obligation** each of them serves is withdrawn. See §What is amended, and what is not.
- **Related:** Issue #599 (the article half of the SeputarBorneo cutover); Issue #711 (the rubrik half); [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (capabilities are built here); [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (the public URL vocabulary is split per repo); PRD §41 and FR-DSC-007 (the migration requirement this ADR withdraws); PRD §9.2 (no chain longer than one hop)

## Context

### Both open issues rest on one premise, and the premise has been withdrawn

Issue #599 opens with it in a single sentence: _"Bila SeputarBorneo masuk sebagai
tenant kedua (PRD §41), yang dipindahkan adalah 23.906 artikel yang sudah
diindeks mesin pencari selama bertahun-tahun."_ Everything both issues ask for
descends from that: the `legacy_source_id` column, the bulk redirect import, the
HTML→Portable Text converter, the pre-cutover crawl, the rubrik map, the edge
verifier. Each exists to move a decade of search-engine equity without dropping
any of it.

On **26 August 2026** the product owner withdrew that premise: **not all articles
from the legacy site need to be migrated or imported, and the site is to be used
as a reference for its features and functionality.**

This is not a technical correction, and nothing below argues with it. It is a
scope decision, and its consequences run further than "skip the import" — far
enough that leaving them unwritten would strand two issues and six CLI jobs on a
requirement nobody holds any more.

### The requirement was carried on a count nobody had checked

Worth recording once, because it is the same class this repo keeps finding.
#599, #597 and several documents say **23,906** articles. The legacy database
says **25,029** (`data/seputarborneo-legacy/rubrik-redirects.json`,
`source.totalArticles`, read from `seputa58_sbb.berita_red_tayang`). Both numbers
were quoted as the size of the obligation, in the same repo, for weeks. A
requirement expensive enough to justify six jobs was never expensive enough for
anyone to count its subject.

## Decision

### 1. The archive is not migrated in bulk. The legacy site is a feature reference.

`seputarborneo.com` is a source of **requirements**, not of **rows**. Its
features — rubrik navigation, search, related articles, ad placements, bylines,
static pages — are the reference that drove the #588–#599 round, and that use is
unaffected and already largely harvested.

### 2. The 301 cutover obligation is withdrawn with it.

This is the load-bearing consequence, and the reason this ADR exists rather than
a comment on an issue. **A 301 is a promise that the content moved.** If the
content did not move, there is no honest destination for it to name.

This repo has already refused exactly that trade once. ADR-0113 declined to
redirect legacy search URLs to any article, in these words: _"Sebuah query
sembarang tidak punya satu tujuan yang benar, dan mengarahkannya ke artikel mana
pun adalah 301 yang berbohong."_ The same reasoning applied consistently gives
the rule for the whole cutover:

> **You cannot carry the URLs without carrying the content.** For a legacy URL
> whose article is deliberately not imported, the honest status is **410 Gone**
> (or 404) — never a 301 to a category listing, a homepage, or any other page
> that is not the thing that was asked for.

A blanket redirect of 25,029 URLs to a category index is a soft-404 farm. It is
worse than the 404s it is trying to avoid, and it would be built by tooling that
this repo wrote specifically to make lying redirects hard.

### 3. The capability stays. Only the obligation goes.

Per ADR-0055 capabilities live here, and every job in this family is built,
tested and gated:

| Job                            | Still true under this ADR                               |
| ------------------------------ | ------------------------------------------------------- |
| `blog:legacy:import`           | imports whatever subset is chosen, with `--section-map` |
| `blog:legacy:redirects:import` | derives one rule per **imported** post                  |
| `blog:legacy:article-paths`    | emits the id→path artefact for imported rows            |
| `blog:legacy:cutover:verify`   | DB-level resolution check over a supplied corpus        |
| `blog:legacy:edge:verify`      | HTTP-level check that the edge issues one hop           |
| `blog:legacy:rubrik-redirects` | builds the rubrik map from the legacy DB                |

None of them changes. A **selective import is the same pipeline with a smaller
input**, and the reason it needs no new code is a property already in the query:

```sql
SELECT legacy_source_id, slug, locale
FROM awcms_blog_posts
WHERE tenant_id = $1
  AND legacy_source_system = $2
  AND legacy_source_id IS NOT NULL
  …
```

`listLegacyRedirectMappings`
(`src/modules/blog-content/application/blog-post-directory.ts`) derives the map
**from rows that exist**. Import ten articles and it emits ten rules; import
none and it emits none. **A partial import cannot produce a dangling rule** —
not by discipline, by construction. That is what makes the withdrawn obligation
safe to withdraw without touching a line of the tooling.

### 4. What is amended, and what is not.

ADR-0113, ADR-0114 and ADR-0115 are **not superseded**. Their mechanics were
right when written and are still right:

- **ADR-0113** — a rubrik pair flattens to `/kategori/{jenis_rubrik}`; shape 4
  never existed. Unchanged.
- **ADR-0114** — the edge owns the 301s; an article resolves on its leading
  digits. Unchanged.
- **ADR-0115** — the archive lands on ONE origin, `/{section}/{slug}/`, and the
  importer declares the section. Unchanged.

What is withdrawn from all three is the single clause each inherits from PRD
§41 / FR-DSC-007 and states as a Definition of Done: **that _every_ legacy URL
must resolve to a live target in one hop.** Read them as conditional from now
on — _if_ an article is imported, this is where it goes and this is how its 301
is issued and verified.

## Consequences

- **Issues #599 and #711 can close.** Their DoD items divide cleanly into
  delivered and withdrawn; the division is enumerated on each issue rather than
  duplicated here.
- **The media blocker dissolves.** ~25,031 uploads / 4.1 GB was a hard blocker
  only because the importer refuses a row whose `featuredImageSrc` is unmapped
  and 25,029 of 25,029 have one. Nothing is imported by default, so nothing is
  refused. A selective import still needs images for the rows it takes — the
  same gate, over a set the operator chose.
- **The ten destination categories are no longer a prerequisite.** They become
  a prerequisite of a selective import, not of the platform.
- **`data/seputarborneo-legacy/` is kept as reference material.** The Wayback
  CDX export (`wayback-cdx-2026-08-26.txt`) and the rubrik map — 68 entries, 63
  of them carrying a target across 10 destination categories — are evidence
  about a site that is still being used as a feature reference, and evidence
  that decays if discarded. Keeping it costs 565 kB.
- **No gate changes, and no test changes.** None of the six jobs is in the
  `check` chain — they are operator tools that need a database and a corpus. The
  suites that cover them test the tools' behaviour, which is unchanged. This
  ADR is a requirements change with **zero behaviour change**.

### A boundary this ADR does not cross

`blog:legacy:cutover:verify` reports `no_rule` for a legacy URL with no
redirect. Under the withdrawn obligation that was a failure; under this ADR it
is the **expected** state for an article that was deliberately not imported, and
a full-corpus run would therefore report the intended outcome as a failing one.

That is a property of the **corpus you hand it**, not a defect in the job: fed
the URLs of the rows actually imported — which `blog:legacy:article-paths`
emits — it answers the question that still matters. The verdict vocabulary has
no member meaning _"deliberately gone"_, and none is added here, because no
obligation now requires the full-corpus run that would need one. If a selective
import is ever run at a scale where that distinction earns its keep, it is a
small addition to `CutoverVerdict` and a fresh decision, not a silent widening
of this one.

### What this ADR does not decide

**The fate of the legacy domain.** Whether `seputarborneo.com` is retired,
parked, or served is an infrastructure decision outside both repositories, and
ADR-0114 already placed the 301s at the edge rather than in this application. If
the domain is kept and served, §2 above gives the rule its edge configuration
must follow: 410 for what did not move, one-hop 301 only for what did.
