🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.id.md)

# ADR-0113 — A legacy rubrik pair flattens to its rubrik, and a legacy search URL keeps its query

- **Status:** Accepted
- **Date:** 2026-08-25
- **Decision maker:** ahliweb
- **Amended:** 26 August 2026 — the normalisation section was factually wrong (`seo_title()` is never called); the decision is unchanged. See below.
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

### AMENDED 26 August 2026 — the normalisation section below was WRONG

The decision above is unchanged. Its stated mechanics were not, and the
correction matters because it changes what gets built.

**This ADR said the map keys on `seo_title(jenis_rubrik)`. `seo_title()` is dead
code.** It is _defined_ nine times across the legacy PHP tree and **called zero
times** — and the nine copies do not even agree: `index.php` replaces spaces
with `_` while the other eight use `-`. `rubriks/index.php` binds the URL
segments **raw**, after a `trim()`, straight into
`WHERE jenis_rubrik = ? AND kategori = ?`. A legacy rubrik URL segment is the
column value, not a slug of it.

**So the `MITRA BORNEO` / `MITRA-BORNEO` warning was wrong too.** Without
slugification they are `/rubrik/MITRA%20BORNEO.html` and
`/rubrik/MITRA-BORNEO.html` — different paths that never collapse. Neither is
linked from anywhere on the site, so neither needs a rule at all.

**How the error happened, because it is the reusable part.** The claim entered
as prose in an issue comment, was carried into this ADR, and was never checked
against a call site — the same shape as the `replaceMenuItems` function that
did not exist (NAME ROUND) and the `awcms_blog_pages.legacy_source_*` columns
that had no reader. A function that is quoted but never called reads exactly
like a function that runs. **Grep for the CALL, not the definition.**

### What the URLs actually are

Nothing in the legacy tree generates a rubrik link from a column value. Every
one is a hand-typed literal, which is what makes them **enumerable and
complete** rather than a sample — a crawler could only ever reach what was
linked. There are **67**, and they are committed with their provenance at
`data/seputarborneo-legacy/rubrik-redirects.json`.

Two properties of that set decide the work:

- **Casing is load-bearing here and was not on the legacy site.** MariaDB's
  `utf8mb4_unicode_ci` made `rubrik/Hukum.html` and `rubrik/hukum.html` the same
  page (5,183 articles each). `awcms_seo_redirects` matches
  `normalized_source_path` by **equality** and `normalizeRedirectPath` preserves
  case, so **both spellings need their own rule**. Five rubriks were linked in
  both casings.
- **32 of the 67 resolved to ZERO articles** — dead nav and footer links, for
  years, serving HTTP 200 with an empty listing rather than a 404, so search
  engines will have indexed them as thin pages. Eight are leftovers from the
  template this site was built from and name places in **South Sumatra**
  (`daerah/Kikim%20Area.html`, `daerah/Lahat%20Kota.html`, …).
  `rubrik/Olah Raga.html` is dead for an instructive reason: the column value is
  `OLAHRAGA`, with no space, and a case-insensitive collation does not close a
  whitespace difference.

**A dead URL 301s to its first segment's archive when that segment resolves** —
27 of the 32, an improvement on an empty 200 for a reader and a consolidation
for a crawler. The remaining **5 orphans** (`rubrik/kuliner`,
`rubrik/Olah Raga`, `rubrik/pariwisata`, `rubrik/travel`, `rubrik/Viral`) have
nothing to point at and get **no rule**; 410 is not expressible, since
`RedirectStatusCode` is 301/302/307/308 only, so the alternative to a rule is a 404.

That leaves **62 rules over 10 destination categories** — and because the
decision drops `kt`, every URL of either shape lands on its parent rubrik's
archive, so the whole map is a function of the first segment alone.

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

**What remains on #711 is loading, not deriving.** The map is built and committed (`data/seputarborneo-legacy/`), `bun run blog:legacy:rubrik-redirects` turns it into `POST /api/v1/seo/redirects/import` payload chunks, and every source path and target in it is checked against the write path's own `normalizeRedirectPath` / `validateRedirectTarget` / `isValidSlug` on every test run. What is left is the `cari_berita` rules from the legacy sitemap, creating the ten destination categories, loading, and verifying with `blog:legacy:cutover:verify` that nothing resolves to a 404 or to a chain longer than one hop.
