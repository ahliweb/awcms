# SeputarBorneo legacy rubrik redirect map

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
   removed, leaving **67** two-segment listing URLs.
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
value; every one is a hand-typed literal. That is what makes 67 a _complete_
set rather than a sample — a crawler could only ever have reached what was
linked.

## What the numbers say

|                                                   |     |
| ------------------------------------------------- | --- |
| URLs total                                        | 67  |
| Resolved to articles on the live site             | 35  |
| Resolved to **zero** — dead links, for years      | 32  |
| …of those, with a first segment that does resolve | 27  |
| …orphans with no resolvable parent at all         | 5   |
| Entries carrying a rule                           | 62  |

The dead links served **HTTP 200 with an empty listing**, not a 404, so search
engines will have indexed them as thin pages. Per ADR-0113 the 27 with a
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

The script only _builds_ the payload. Loading it is
`POST /api/v1/seo/redirects/import` (200 rules per call, `dryRun` by default).

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

## One known gap

`https://seputarborneo.com/Mitra-Borneo/Pemkab%20Lamandau.html` returns 200 with
a real listing and is **not** among the 67. The homepage emits it **without**
`.html`, and step 1 above keyed the extraction on that suffix, so the capture
skipped it. Two further URLs exist in Wayback only —
`/aerah/Pulang pisau.html` and `/rubrik/Olah Raya.html`, both typos — and appear
in neither the PHP tree nor the database.

Separately, Wayback CDX holds **5,174 distinct URLs** for this domain (verified
untruncated). That is roughly **8.86%** of the archive: real external evidence
about what was indexed, and **not** a substitute for the indexed set itself.

`articlesAtCapture` and `parentArticlesAtCapture` are a snapshot, not a
contract. They are recorded so a future reader can see which URLs mattered and
by how much, without needing the database back.
