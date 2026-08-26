---
"awcms": patch
---

docs(adr): the cutover map was right about its destinations and wrong about who would serve them (#599, #711)

ADR-0113 §Consequences said, in both languages, _"`awcms-astro` needs no change
for this… the redirect is resolved in this repo before its routes are reached."_
That sentence is false, and until now it was the most consequential error in the
SeputarBorneo cutover's record — an agent following it would have built the wrong
thing.

`awcms_seo_redirects` is applied at **exactly one call site**:
`resolvePublicRedirectForRequest`, from `src/middleware.ts:341`, which runs in
**this** application. ADR-0113's 62 rubrik rules target `/kategori/**`, served by
`ahliweb/awcms-astro` — `output: "static"`, no middleware file at all, no
`redirects:` key, and a production entrypoint `server/penyaji.mjs` containing zero
occurrences of `301` or `Location`. All 67 committed entries were replayed against
that repo's real built server: **404 on every one, zero `Location` headers.**

### ADR-0114 records the two decisions this forced

**The edge (Coolify/Varnish) owns the legacy 301s.** It is the only layer that can
collapse `http→https` + `www→apex` + `legacy→new` into the ONE hop PRD §9.2
demands; an application only sees a request after the edge has acted on scheme and
host, so any rule it writes is at best hop two.

**Article resolution is id-keyed, not exact-path.** `/news/{id}_{Title}.html`
matches on its leading digits against `legacy_source_id`. The shipped exact-path
template matches **0 of 25,029** URLs — every legacy title contains a space, so
every segment carries `_`, which `SLUG_PATTERN` forbids, and matching is by
equality, so no slug that passes the validator can ever equal the indexed segment.
Worse than a miss: an unmatched `/news/**` falls through to
`resolveRetiredNewsRedirect` and 301s into a path no post has — which is
`CUTOVER_VERDICT_REASON.target_missing` in its own words.

The ADR also states plainly what this makes inert, so nobody reaches for it:
**`awcms_seo_redirects` and `--path-template` are not the mechanism for this
cutover.**

### ADR-0113 is amended in place, for the second time

Its **shape-4 decision is retracted**: `/cari_berita/{q}.html` has never existed.
The two-segment catch-all is `.htaccess` line 6 and `cari_berita` is line 7, and
shape 4's language is a strict subset of the catch-all's, so line 7 has never been
reached in any commit that ever touched the file. It is rule ORDER, not the `[L]`
flag. Brute-forced over 3,375 candidate paths (0 matches, with a self-test that
did find a counterexample when shape 4 was artificially widened), confirmed live,
and confirmed against 5,174 archived URLs of which zero are `/cari_berita/*.html`.
`/cari_berita/X.html` still serves 200 — as a shape-3 URL — and must never become
a `/cari?q=` redirect.

"47-or-fewer target categories" is corrected to the built map's **10**. 47 was an
upper bound on `jenis_rubrik` under MariaDB's case-insensitive collation (a JS map
keyed by exact name sees 48/45), never the go-live checklist.

### Everywhere else the false claims lived

The ADR index rows (both languages), `docs/PROJECT_STATE.md` §4's DECISION /
SHAPE / #599-split entries, the `legacy-import-record.ts` comment claiming the
slug is "half of the legacy URL and half of the new one" (they are disjoint by
construction), the `blog-legacy-import.ts` docstring claiming every CKEditor row
was residue (measured: 4 of 25,029), and `data/seputarborneo-legacy/README.md`,
which now records the map's one known gap (`/Mitra-Borneo/Pemkab%20Lamandau.html`)
and the Wayback CDX corpus with its decay caveat.

The **23,906 → 25,029** count correction is made once, in ADR-0114, and applied to
documents that make a live claim. Merged changesets and merged ADRs are
deliberately not rewritten: they record what was believed when they were written.

Documentation only. No behaviour changes; the code defects this round found —
`blog:legacy:cutover:verify` exiting 0 on every usage error, `classifyCutoverOutcome`
returning `ok` for every target it cannot check, the importer dropping all 25,029
lead photographs — are recorded in PROJECT_STATE §4's ORIGIN ROUND and fixed in a
later change.
