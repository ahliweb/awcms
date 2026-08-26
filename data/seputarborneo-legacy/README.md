# SeputarBorneo legacy rubrik redirect map

> **Status, 26 August 2026 ([ADR-0116](../../docs/adr/0116-the-legacy-site-is-a-feature-reference-not-a-migration-source.md)): reference material, not a pending work order.**
> The bulk migration this map was built for is withdrawn — the legacy site is a
> reference for its FEATURES, and the archive is not imported wholesale. Nothing
> here is stale and nothing is deleted: the map and the Wayback export are
> evidence about a site still being used as a reference, they cost 565 kB, and
> they cannot be re-derived once the workstation below is gone. What changed is
> that executing these 63 rules is now **conditional on a selective import**
> rather than a prerequisite of it. A 301 may only be issued for an article that
> actually moved; for one deliberately left behind the honest answer is 410.

`rubrik-redirects.json` is the complete set of legacy rubrik/listing URLs for the
SeputarBorneo archive (Issue #711, [ADR-0113](../../docs/adr/0113-a-legacy-rubrik-pair-flattens-to-its-rubrik.md)
for the destinations, [ADR-0114](../../docs/adr/0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md)
for who executes the 301), each resolved against the legacy database and mapped
to its destination.

**It is committed because it cannot be re-derived later.** Producing it needed
two things that exist only on the migration workstation: the legacy PHP working
copy at `/home/data/dev_php/seputarborneo.com`, and the populated MariaDB volume
`seputarborneocom_db_data`. Neither ships anywhere. Re-deriving the map after
either is gone would mean guessing, which is the mass-wrong-301 outcome #711
exists to prevent.

## How it was derived (26 August 2026)

1. **Every `.html` link literal** was extracted from the PHP working copy.
   Administrative template boilerplate (`pages/*.html`), the article shape
   (`news/…`), the video shape and the three static pages (Issue #599) were
   removed, leaving **67** two-segment listing URLs. A later sweep for the
   links that step misses — relative link literals **without** `.html` — found
   exactly one more (§"One known gap"), taking the set to **68**.
2. Each URL was decomposed the way the legacy `.htaccess` decomposes it —
   `rubrik/X.html` → `?news=X`, and `A/B.html` → `?news=A&kt=B`.
3. Each was resolved against `seputa58_sbb.berita_red_tayang` with **exactly the
   query `rubriks/index.php` runs**: `WHERE jenis_rubrik = ? AND kategori = ?`,
   binding the segments raw. The volume was copied out read-only and the probe
   ran against the copy, which was then deleted; the original was never mounted
   writable.
4. `canonicalRubrik` records the actual column value(s) the first segment matched
   under MariaDB's case-insensitive `utf8mb4_unicode_ci`, and `targetPath` is
   `/kategori/{slug}` of that value.

## The three facts that make this map non-obvious

**`seo_title()` is dead code.** It is _defined_ nine times across the PHP tree
and _called zero times_ — and the nine copies do not agree: `index.php` replaces
spaces with `_` while the other eight use `-`. Any map built on the assumption
that URL segments are slugified output is wrong. They are raw column values in
the path, bound straight into the `WHERE` clause after a `trim()`.

**Casing is load-bearing here and was not on the legacy site.** MariaDB's
collation is case-insensitive, so `rubrik/Hukum.html` and `rubrik/hukum.html`
both returned the same 5,183 articles. `awcms_seo_redirects` matches
`normalized_source_path` by **equality**, and `normalizeRedirectPath` preserves
case — so both spellings need their own rule. The map carries both wherever both
were linked.

**Nothing generates these URLs.** No PHP file emits a rubrik link from a column
value; every one is a hand-typed literal. That is what makes 68 a _complete_
set rather than a sample — a crawler could only ever have reached what was
linked. Hand-typed is also why the set needed the second sweep: a generated
link cannot forget its own suffix, and a hand-typed one did.

## What the numbers say

|                                                   |     |
| ------------------------------------------------- | --- |
| URLs total                                        | 68  |
| Resolved to articles on the live site             | 35  |
| Resolved to **zero** — dead links, for years      | 33  |
| …of those, with a first segment that does resolve | 28  |
| …orphans with no resolvable parent at all         | 5   |
| Entries carrying a rule                           | 63  |

The dead links served **HTTP 200 with an empty listing**, not a 404, so search
engines will have indexed them as thin pages. Per ADR-0113 the 28 with a
resolvable parent 301 to that parent's archive — an improvement on an empty 200
for a reader and a consolidation for a crawler. The 5 orphans
(`rubrik/kuliner`, `rubrik/Olah Raga`, `rubrik/pariwisata`, `rubrik/travel`,
`rubrik/Viral`) carry `targetPath: null` and get **no rule**: there is nothing to
point them at, and 410 is not expressible (`RedirectStatusCode` is
301/302/307/308).

Eight of the dead URLs are leftovers from the template this site was built from
and name places in **South Sumatra**, not Kalimantan — `daerah/Kikim%20Area`,
`daerah/Lahat%20Kota`, `daerah/Tanjung%20Sakti`, `daerah/Pagar%20Agung`,
`daerah/Merapi%20Area`, `daerah/Gumay`, `daerah/Jarai`,
`daerah/Kota%20Agung%20Area`. They are kept because they were linked and are
therefore crawlable, and they redirect to the Kalimantan `daerah` archive on the
same reasoning as the rest.

`rubrik/Olah Raga.html` is an orphan for an instructive reason: the column value
is `OLAHRAGA`, with no space. A case-insensitive collation does not close a
whitespace difference, so that nav link returned nothing on the live site too.

## Using it

```
bun run blog:legacy:rubrik-redirects            # dry run — prints the payload
bun run blog:legacy:rubrik-redirects --emit     # write import payload chunks
```

The script only _builds_ the payload; `--emit` writes its chunks **beside this
file**, not into the working directory. Loading them is
`POST /api/v1/seo/redirects/import` (`dryRun` by default), whose per-call cap
the script now imports as `MAX_REDIRECT_IMPORT_ITEMS` rather than restating in
a comment — all 63 rules fit in one call either way.

**Three things must be true before these rules point anywhere, and only the
first is in this repo.** (1) The ten destination categories exist in the tenant.
(2) The ten section slugs are in `ahliweb/awcms-astro`'s hard-coded
`siteConfig.tabs` — `getArticles` runs once per configured tab and keeps a post
only when `readBlock(post).kategori === tab`, so a section naming no configured
tab builds nothing. (3) The archive is imported **with a `--section-map`** and
that site is rebuilt and redeployed: its pages are STATIC, and a category
archive is generated only from articles that were built.

**Do not use it before the destination categories exist in the tenant.** All
ten (`bisnis`, `budaya`, `daerah`, `hukum`, `mitra-borneo`, `nasional`,
`olahraga`, `politik`, `provinsi`, `wisata`) must resolve, or every rule 301s
into a 404 — [ADR-0111](../../docs/adr/0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.md)'s
failure one step over, and the outcome #711's Definition of Done forbids.

**That precondition governs the targets in THIS map and nothing else**, and
under [ADR-0114](../../docs/adr/0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md)
those targets are **pending**: the ten categories do not exist in the tenant
yet, and the 301s are executed at the **edge**, not by `awcms_seo_redirects`.
`bun run blog:legacy:rubrik-redirects` still builds a
`POST /api/v1/seo/redirects/import` payload, and that payload is no longer the
mechanism for this cutover — the rules would be written into a table consulted
by a middleware these requests never reach, because `/kategori/**` is served by
`ahliweb/awcms-astro`. Read the script's output as a validated map, not as a
load instruction.

## One known gap — found, and closed as a CLASS

`/Mitra-Borneo/Pemkab%20Lamandau.html` is the **68th** entry, added on
26 August 2026. Nothing about it is routine, so all of it is written down.

**What the nav actually links is `Mitra-Borneo/Pemkab Lamandau` — with no
`.html`.** It appears that way in five templates (`index.php:176`,
`rubriks/index.php:183`, `berita/index.php:293`, `img/index.php:293`,
`pencarian/index.php`). Step 1 keyed the extraction on the suffix, so the
capture never saw it.

**The class was then swept, not just the instance.** Every relative link
literal in the tree that contains a `/` and does not end in `.html` is this URL
and `./video/?video=5` — the video shape, which the derivation excludes anyway.
One URL was missing, and there is now a mechanical reason to believe it was the
only one, rather than one fix and a hope.

**The linked form 404s.** `.htaccess` rewrites only `…\.html$` (line 6), so
nothing matches a path without it: `GET /Mitra-Borneo/Pemkab%20Lamandau`
returns **404** today, and every reader who clicked that nav item got the error
page. The `.html` form the nav omits is the one that serves. That is why the
entry's `sourcePath` carries the suffix while its `legacyHref` does not, and
why it is the one entry with `hrefLacksHtmlSuffix: true` —
`tests/legacy-rubrik-redirect-map.test.ts` checks that flag **against** the
href instead of trusting it.

**It serves 200 with an EMPTY listing, not a real one.** Fetched live it is
byte-identical to `Mitra-Borneo/Pemkab%20Seruyan.html`, a known-zero sibling,
apart from the category name in `og:url`, the `<h2>` and the pager links: nine
sidebar links, no body article, where `Pemkab%20Kapuas.html` carries twelve.
The snapshot agrees —
`jenis_rubrik = 'Mitra-Borneo' AND kategori = 'Pemkab Lamandau'` returns **0**
rows against **133** for the parent. So it joins the 28 dead-but-200 URLs with
a resolvable parent and 301s to `/kategori/mitra-borneo` exactly like its 23
siblings. No new destination; the set stays at ten.

**The 404 form gets no rule of its own.** It matches none of ADR-0113's five
shapes, and a URL that answered 404 for the whole life of the legacy site
carries no ranking to move. Recorded here rather than decided away: under
ADR-0114 the edge could collapse it into the same hop in one line if the owner
wants it, and this paragraph is what makes that a choice instead of a
rediscovery.

**Why so many `Mitra-Borneo` pairs are zero.** The column holds two spellings —
`MITRA-BORNEO` (hyphen, 133 rows) and `MITRA BORNEO` (space, thousands; 476 of
them under `kategori = 'Pemkab Lamandau'` alone). Every URL says `Mitra-Borneo`,
and a case-insensitive collation does not close a hyphen/space difference, so
the larger archive was never reachable from any of them. This changes no
destination — both spellings flatten to `/kategori/mitra-borneo` — but it is
the difference between "the map recorded a zero" and "the map recorded a zero
because the legacy site had one".

## The two Wayback-only URLs get NO rule

`/aerah/Pulang pisau.html` (a typo of `Daerah`) and `/rubrik/Olah Raya.html` (a
typo of `Olah Raga`, itself already an orphan) are in the Wayback corpus and in
neither the PHP tree nor the database. Both were captured 200 from 2022 to 2026
and both still return 200 with an empty listing today. **They get no rule, and
they are not entries.** Three reasons, of which the first is sufficient:

- **ADR-0113 gives them `targetPath: null` anyway.** Its rule is "a dead URL
  goes to its first segment's archive when that segment resolves", and the
  snapshot answers **0** rows for `jenis_rubrik = 'aerah'` and **0** for
  `'Olah Raya'`. They are orphans exactly like the five already in the map, and
  an orphan carries no rule — so adding them would change nothing that runs.
- **Sending them to `daerah` / `olahraga` on the strength of the resemblance
  would be guessing**, which is the mass-wrong-301 outcome #711 exists to
  prevent. It is also not what the legacy site did: it served an empty page.
- **Adding them would cost the map the property that makes it trustworthy.**
  Its membership rule is mechanical — every listing link literal in the tree —
  which is what makes 68 a complete set for its class rather than a sample.
  Splicing in URLs from a corpus that reaches 8.87% of the archive would make
  it an arbitrary set, and would leave "what else is in Wayback, then?" as an
  open question with no answer.

## `wayback-cdx-2026-08-26.txt` — external evidence, committed because it decays

A verbatim CDX pull of every URL the Internet Archive has for this domain,
taken 26 August 2026:

```
https://web.archive.org/cdx/search/cdx?url=seputarborneo.com*&output=text&fl=original&collapse=urlkey&limit=50000
```

**5,170 distinct URLs**, one per line, exactly as the API returned them.

**Proof it is not truncated**, which is the failure this file would otherwise
hide: the same query with `showNumPages=true` answers **2** (that flag answers
`-` if you also pass `collapse` or `pageSize` — ask it on the bare query), and
the two pages hold 2,975 and 2,196 rows. They sum to 5,171 because `collapse`
is applied per page and one URL survives on both; their union is 5,170 and is
identical, as a set, to the single un-paginated pull above.

**What it is evidence of, and what it is not.** Wayback records **Internet
Archive crawls**, not indexing: a URL here was fetched by one crawler, which is
neither proof that a search engine indexed it nor a bound on what one did. It
reaches **2,219 distinct article ids — 8.87% of the 25,029 articles**. And the
bodies are frequently not the site: the 2025 captures of
`/Mitra-Borneo/Pemkab%20Lamandau` and `/rubrik/Olah%20Raya.html` are both HTTP
200 holding a bot-challenge interstitial (`<title>One moment, please...`), so
even a 200 in this corpus does not mean a page was served.

**It is not a substitute for the link-literal enumeration, and here is the
number that proves it**: **22 of this map's 68 URLs never appear in the
corpus** — including all eight South Sumatra leftovers and every lowercase
`rubrik/*` spelling. Read the other way, the only listing-shaped URLs the
corpus holds that the map does not are the two typos above and the three static
pages Issue #599 owns.

**Two families in it that no ADR covers, both correctly left alone.** 2,224 of
the corpus's 2,301 `/news/*` URLs are the underscore article form and **zero**
use a hyphen form — the external half of ADR-0114's id-keyed decision. The
other 77 are mostly a doubled segment, `/news/news/{id}_{Title}.html`: 75 of
them, a relative-link artefact of some page under `/news/`. They match no
`.htaccess` rule — line 2 wants one segment and line 6's `([^/]*)` cannot span
a slash — so they returned 404 when they were crawled and return 404 today
(verified live). A URL that 404'd for the whole life of the legacy site has no
ranking to move, so they get no rule, and the corpus is where that stays
written down.

It is committed for the same reason the map is: it cannot be reconstructed
later. Wayback's holdings change — this pull is four URLs short of one taken
the same week — its API rate-limits and times out, and a number quoted from a
pull nobody kept is a number nobody can check. It is also directly usable: the
cutover gate takes a plain URL list.

```
bun run blog:legacy:cutover:verify --tenant=… --tenant-code=… \
  --urls=data/seputarborneo-legacy/wayback-cdx-2026-08-26.txt
```

## The ARTICLE map is deliberately NOT committed

[ADR-0114](../../docs/adr/0114-the-edge-owns-the-legacy-301s-and-an-article-is-found-by-its-id.md)
resolves `/news/{id}_{Title}.html` on its **leading digits** against
`awcms_blog_posts.legacy_source_id`, never on a title-derived slug. The artefact
that serves that at the edge is an **id → post path** table, generated from the
tenant and **regenerated, not committed**.

**The generator now exists** — `bun run blog:legacy:article-paths` (preview by
default, `--emit` writes `article-paths.json` and `article-paths.tsv` beside this
file, both gitignored). It needs a live tenant to generate AGAINST, which is not
the same as being unbuilt.

Its destination is [ADR-0115](../../docs/adr/0115-the-migrated-archive-lands-on-one-origin-and-the-importer-must-say-where.md):
`/{section}/{slug}/` on `ahliweb/awcms-astro`, the same origin the rubrik map
already targets. Two things about it are not obvious and both are load-bearing:

- **`--default-locale` is required.** That site serves its DEFAULT locale
  unprefixed and prefixes only the others, which is the opposite of this repo's
  `withPublicLocalePrefix`. All 25,029 articles are in the default locale, so
  getting it wrong 301s every one of them into a 404.
- **A row with no `content_json.awcmsAstro.kategori` gets no path, and the run
  refuses to emit while any remain.** That field is what decides whether the
  consuming site builds a page for an article at all; the fix is upstream, a
  `--section-map` on `blog:legacy:import`.

The justification is the exact inverse of the rubrik map's. That map is
committed because it cannot be re-derived: it came from a PHP working copy and
a MariaDB volume that live on one workstation and ship nowhere. The article map
is re-derivable from the tenant by definition — `legacy_source_id` is a column
on every imported row — and 25,029 rows of a live newsroom's headlines are
still growing, so a committed copy would be wrong the week after it landed and
would carry an editorial archive into git history for no gain. Same question,
opposite answer, for the same reason: commit what cannot be regenerated.

## Snapshot fields

`articlesAtCapture` and `parentArticlesAtCapture` are a snapshot, not a
contract. They are recorded so a future reader can see which URLs mattered and
by how much, without needing the database back.

Re-probing that database, if the volume is still around: its redo log was
written by **MariaDB 10.11.19**, although `docker-compose.yml` beside the PHP
tree declares `mariadb:10.6`. A 10.6 server refuses a copy of it outright —
`Unsupported redo log format` — which looks like corruption and is not.
