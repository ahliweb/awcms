🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.id.md)

# ADR-0113 — A legacy rubrik pair flattens to its rubrik, and a legacy search URL keeps its query

- **Status:** Accepted
- **Date:** 2026-08-25
- **Decision maker:** ahliweb
- **Related:** Issue #711 (the half of the SeputarBorneo cutover this unblocks); Issue #599 (the half that was already cutover-ready); ADR-0045 / ADR-0070 (the public URL vocabulary is split, and the news archive is rendered by `ahliweb/awcms-astro`); ADR-0039 (redirect governance); ADR-0111 (a rule that cannot fire is worse than no rule); `sql/060` §2 (exact-path rules only, by design); PRD §9.2 (no chain longer than one hop)

## Context

The legacy `.htaccess` at `/home/data/dev_php/seputarborneo.com/.htaccess` has **five** rewrite shapes, not the two every version of the plan named:

```
^news/([^/]*)\.html$          -> /berita/?news=$1          # article  — #599
^rubrik/([^/]*)\.html$        -> /rubriks/?news=$1         # rubrik   — HERE
^([^/]*)/([^/]*)\.html$       -> /rubriks/?news=$1&kt=$2   # catch-all — HERE
^cari_berita/([^/]*)\.html$   -> /pencarian/…              # search   — HERE
^([^/]*)\.html$               -> /data/?halaman=$1         # page     — #599
```

Shapes 2, 3 and 4 were blocked, and the issue named two blockers. **The first does not exist.** The rubrik list was believed missing because the working copy's dump `seputa58_sbb.sql` is 0 bytes. It is — and it is not where the data lives: `docker-compose.yml` mounts that file only as an initdb seed while the datadir is the named volume `seputarborneocom_db_data`, which holds 411 MB. An initdb script runs only against an empty datadir, so the empty file has been inert since the volume was first populated.

There is also no rubrik _table_, because there was never meant to be one. `include/rubrik.php` answers with `SELECT … FROM berita_red_tayang WHERE jenis_rubrik = ? AND kategori = ?` — `jenis_rubrik` and `kategori` are **columns on `berita_red`**. Measured against a throwaway copy of the volume: **25,029 articles, 47 distinct `jenis_rubrik`, 46 distinct `kategori`, 102 distinct pairs.**

**The second blocker is the real one, and it is this ADR.** Where those URLs should land is a question about a vocabulary this repo does not own: ADR-0045/ADR-0070 put the news archive in `ahliweb/awcms-astro`. That repo's routes are `/kategori/[slug]` (with `/halaman/[nomor]`), `/tag/[slug]`, `/[tab]` and `/[tab]/[...slug]`, and `/cari` — **one** level of category, where the legacy archive has two.

## Decision

**1. Shapes 2 and 3 both 301 to `/kategori/{seo_title(jenis_rubrik)}`. The `kt` segment is dropped.**

**2. Shape 4 301s to `/cari?q={percent-encoded query}`.**

### Why flattening, and not the three alternatives

- It targets a route `awcms-astro` **already has**, so the cutover needs no new route there, no new list-API surface here, and no fourth cross-repo contract step.
- It is one hop, which PRD §9.2 requires.
- A reader lands on a list that is **broader** than the one they asked for, never a wrong one. That is the property the alternatives lose.

**Category + tag** (`jenis_rubrik` → category, `kategori` → tag) also needs no new routes, and both exist in `awcms-astro`. It was rejected because it drops the AND: `/hukum/pidana.html` would land on every article tagged `pidana` across every rubrik, which is a genuinely wrong page rather than a wide one.

**A composite slug per pair** (`/kategori/hukum-pidana`) keeps the exact granularity and is still one hop. It was rejected because it invents a 102-entry vocabulary no editor ever chose, and a category list that size stops being navigation.

**A nested `/kategori/[slug]/[sub]` route** in `awcms-astro` is the only option that preserves the pair exactly. It was rejected as the most expensive thing on the list — a new route, a two-level taxonomy or composite filter on this repo's list API, and a fresh ADR-0045/0070 contract — bought for a refinement the archive has not been shown to need.

### The normalisation is load-bearing, and only the data could have said so

Both **`MITRA BORNEO` (11,767 articles)** and **`MITRA-BORNEO` (133)** exist in `berita_red`.

Shape 3's URL segments are `seo_title()` output — punctuation stripped, spaces replaced by `-` — so the two spellings collapse to the **same** URL segment while a plain `SELECT DISTINCT` reports two rubriks. A map built from the distinct list without normalising through the same `seo_title()` the legacy site used therefore mis-keys **the largest rubrik in the archive**.

So the map keys on `seo_title(jenis_rubrik)`, not on the raw column value, and the 47 distinct values may yield fewer than 47 slugs. This is the shape-3 warning one level down: enumerating the shapes is not enough if the values inside them are not normalised the way the legacy code normalised them.

### Shape 4 stays exact-path, and this ADR does NOT admit a pattern engine

`awcms_seo_redirects` is exact-path only **by design**. `sql/060` says so in its own header: _"there is NO pattern/regex/rewrite column anywhere in this table. Prefix/pattern rules are deferred to a future ADR precisely because they would introduce a pattern engine (ReDoS)."_

`/cari_berita/{anything}.html` is an unbounded family, so it cannot be enumerated in principle — which reads at first like a reason to admit prefix rules. It is not. **Only the `cari_berita` URLs present in the legacy sitemap get a rule.** Those are the ones carrying accumulated equity; a URL nobody ever indexed needs no redirect, and a pattern engine bought to serve URLs that do not exist is a ReDoS surface bought for nothing. The sitemap is already required for the pre-cutover crawl (`blog:legacy:cutover:verify`), so this adds no artefact that was not already on the list.

Redirecting a search-result URL to the **search page** is not the thing #711 forbade. That issue rules out 301-ing these onto _content_, because no single article is the right destination for an arbitrary query. `/cari` is the same function the legacy URL performed, with the reader's own query preserved.

### Two mechanical constraints, both verified against the code rather than assumed

- **The query must be percent-encoded.** `validateRedirectTarget` accepts `/cari?q=banjir%20sampit` and **rejects** `/cari?q=banjir sampit` — `normalizeRedirectPath` refuses whitespace as a CRLF/header-injection defence. Legacy `seo_title()` output uses `-` where the query had spaces, so the un-slugify step must be followed by encoding, or every multi-word query rule fails to import.
- **A trailing slash is not stored.** `/kategori/hukum/` normalises to `/kategori/hukum`. Recorded so the stored value is not later read as a different rule from the one that was written.

## Consequences

**Term provenance is not needed, and that answers #711's third Definition-of-Done item by dissolving it rather than by building it.** That item offered a choice between adding `legacy_source_id` to `awcms_blog_terms` and hand-writing a `--term-map`. Under this decision, shapes 2 and 3 become exact-path → exact-path rules that resolve without ever looking up a term row, so neither is required. This matters beyond convenience: `sql/147` has just deleted the `awcms_blog_pages.legacy_source_*` pair that was added on the same reasoning and never wired to a reader. Adding a second dead provenance column to answer a requirement that no longer exists would have repeated that exactly.

**The 47-or-fewer target categories must exist in the tenant before cutover.** If they do not, every rule 301s into a 404 — ADR-0111's failure one step over, and the outcome #711's own Definition of Done forbids. The map is derivable, but it is not safe to load until the destinations are real.

**`awcms-astro` needs no change for this.** It reads menus, terms and posts; the redirect is resolved in this repo before its routes are reached. The one thing it cannot do is render a category that does not exist, which is the consequence above.

**What remains on #711 is data work, not decisions.** Extract the 102 pairs, normalise through `seo_title()`, build 47-or-fewer shape-2 rules plus one rule per observed pair for shape 3, add the sitemap-present `cari_berita` rules, and verify with `blog:legacy:cutover:verify` that nothing resolves to a 404 or to a chain longer than one hop. The bulk importer takes 200 rules per call and dry-runs by default.
