---
"awcms": patch
---

fix(seo): the import chunk size was tied to the endpoint's cap by a comment, and the rubrik map was missing the one nav link that forgot its own suffix

Hygiene and evidence-capture **toward closing** Issue #599 / Issue #711,
alongside ADR-0114 — which records that this repo cannot close either one: the
last step is edge configuration outside both repositories. No behaviour changes
for a reader; three things that could have gone wrong later cannot now.

**A comment is not a call.** `scripts/blog-legacy-rubrik-redirects.ts` carried
its own `IMPORT_CHUNK_SIZE = 200` under the comment "Mirrors `MAX_IMPORT_ITEMS`
in `src/pages/api/v1/seo/redirects/import.ts`" — the third instance in this repo
of a coupling asserted in prose and enforced nowhere. Lowering the endpoint's cap
would have left the builder emitting chunks the endpoint rejects, with nothing
failing until an operator posted one mid-cutover. The constant now lives once, as
`MAX_REDIRECT_IMPORT_ITEMS` in
`src/modules/seo-distribution/domain/redirect-rule.ts`, and both sides import it;
the test asserts the two by identity rather than by value. The mutation that
proves the test — re-hardcode the builder's `200` and move the endpoint's cap to
150 — was applied and run red.

`--emit` also writes its payload chunks beside the map instead of into the
working directory, and the map path is anchored to the script, so the script now
runs from anywhere instead of failing on a relative read. The emitted chunks are
gitignored: they are derived, and they land inside a committed data directory
where `git add -A` would otherwise sweep them up.

**The rubrik map was missing a URL, and the sweep that found it closed the
class.** The nav links `Mitra-Borneo/Pemkab Lamandau` in five templates **without
`.html`**, and the original extraction keyed on that suffix. Every relative link
literal in the legacy tree that lacks `.html` was then enumerated: this URL, plus
`./video/?video=5`, which the derivation already excludes. The map is 68 entries
and 63 rules; no `targetPath` was rewritten and the destination set is still ten.

The entry is not what the gap was reported to be, and the difference is written
down. `/Mitra-Borneo/Pemkab%20Lamandau.html` returns 200 with an **empty**
listing — byte-identical to a known-zero sibling apart from the category name,
and a re-probe of the same snapshot answers 0 rows against 133 for the parent —
while the form the nav actually links, without `.html`, returns **404**, because
the legacy `.htaccess` rewrites only `…\.html$`. `sourcePath` is therefore the
form that serves, `legacyHref` is the literal that was written, and the one entry
where they differ carries `hrefLacksHtmlSuffix: true`, checked against the href
by a test rather than trusted.

**The Wayback CDX corpus is committed** as
`data/seputarborneo-legacy/wayback-cdx-2026-08-26.txt` — 5,170 distinct URLs,
verbatim, with the query, the pagination proof (`showNumPages=true` answers 2,
and only on the bare query) and its limits recorded beside it. It is committed
for the same reason the rubrik map is: it cannot be reconstructed later. It is
stated as what it is — Internet Archive crawls, not indexing, reaching 8.87% of
the 25,029 articles, with many captures returning 200 over a bot-challenge
interstitial, and with 22 of the map's own 68 URLs missing from it entirely.

Three URL families are decided rather than left open, each with its reason in
`data/seputarborneo-legacy/README.md`: the two Wayback-only typos and the 75
`/news/news/{id}_…` doubled-segment URLs get no rule, and the article map stays
uncommitted — 25,029 rows re-derivable from `legacy_source_id` and still growing
is the exact inverse of the rubrik map's justification.
