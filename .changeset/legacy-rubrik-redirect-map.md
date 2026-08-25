---
"awcms": patch
---

feat(blog): the SeputarBorneo rubrik 301 map is built and committed — and ADR-0113's stated normalisation was wrong because it named a function nothing calls

ADR-0113 settled #711's decision three days into its own life and got the
mechanics wrong. The decision is unchanged; how the map is derived is not.

## `seo_title()` is dead code

The ADR said the map keys on `seo_title(jenis_rubrik)`. That function is
**defined nine times** across the legacy PHP tree and **called zero times** —
and the nine copies do not agree: `index.php` replaces spaces with `_` while the
other eight use `-`. `rubriks/index.php` binds the URL segments **raw**, after a
`trim()`, straight into `WHERE jenis_rubrik = ? AND kategori = ?`.

A legacy rubrik URL segment is the column value, not a slug of it. So the
`MITRA BORNEO` / `MITRA-BORNEO` collapse warning was wrong too — as raw
segments they are different paths that never collapse, and neither is linked
from anywhere, so neither needs a rule.

The claim entered as prose in an issue comment, was carried into a merged ADR,
and was never checked against a call site. Same shape as the `replaceMenuItems`
function that did not exist and the `awcms_blog_pages.legacy_source_*` columns
that had no reader: **a function that is quoted but never called reads exactly
like one that runs.** Grep for the call, not the definition.

## What the URLs actually are, and why the set is complete

Nothing in the legacy tree generates a rubrik link from a column value — every
one is a hand-typed literal. That is what makes the set **enumerable and
complete rather than a sample**: a crawler could only reach what was linked.
There are **67**, now committed with their provenance at
`data/seputarborneo-legacy/rubrik-redirects.json`.

Each was resolved against the legacy database with exactly the query
`rubriks/index.php` runs. The volume was copied out read-only, probed, and the
copy deleted; the original was never mounted writable.

**Casing is load-bearing here and was not on the legacy site.** MariaDB's
`utf8mb4_unicode_ci` made `rubrik/Hukum.html` and `rubrik/hukum.html` the same
page (5,183 articles each). This repo matches `normalized_source_path` by
equality and `normalizeRedirectPath` preserves case, so **both spellings need
their own rule**. Five rubriks were linked in both.

**32 of the 67 resolved to zero articles** — dead nav and footer links for
years, serving HTTP 200 with an empty listing rather than a 404, so search
engines will have indexed them as thin pages. Eight are leftovers from the
template this site was built from and name places in South Sumatra
(`daerah/Kikim%20Area.html`). `rubrik/Olah Raga.html` is dead because the column
value is `OLAHRAGA` with no space, and a case-insensitive collation does not
close a whitespace difference.

Per ADR-0113 the 27 with a resolvable first segment 301 to that parent's
archive. The **5 orphans** carry `targetPath: null` and get no rule — 410 is not
expressible (`RedirectStatusCode` is 301/302/307/308), so the alternative to a
rule is a 404.

**62 rules over 10 destination categories.** Because the decision drops `kt`,
every URL of either shape lands on its parent rubrik's archive, so the map is a
function of the first segment alone.

## What ships

- `data/seputarborneo-legacy/` — the map plus a README recording how it was
  derived and why it cannot be re-derived (it needed a PHP working copy and a
  MariaDB volume that exist on one workstation and ship nowhere).
- `bun run blog:legacy:rubrik-redirects` — builds the
  `POST /api/v1/seo/redirects/import` payload, preview by default, `--emit` to
  write chunks. It does not write to the database: the import endpoint already
  owns conflict/loop/chain safety and the audit row, and a bulk redirect load
  should carry an operator's credential rather than a script's role.
- Tests that push every entry through the write path's own
  `normalizeRedirectPath`, `validateRedirectTarget` and `isValidSlug`.

That last part is deliberate. This file's cautionary sibling,
`tests/legacy-redirect-map.test.ts`, asserted that a migration's *source text*
contained `ALTER TABLE awcms_blog_pages` — which proved a column existed and
could not notice that nothing read it, and those columns were dropped months
later in `sql/147`. A map that cannot be re-derived deserves assertions about
whether it would actually work, not about whether it parses. `findMapProblems`
is itself tested against three deliberately corrupted entries, because a
validator nobody has seen fail is a validator nobody has tested.

Loading still requires the ten destination categories to exist in the tenant
first, or every rule 301s into a 404 — ADR-0111's failure one step over.
