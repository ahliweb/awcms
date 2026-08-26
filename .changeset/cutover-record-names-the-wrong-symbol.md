---
"awcms": patch
---

docs(adr): the cutover record named a symbol that does not exist in the file it cited, and its leave-list called unwritten code an operational step

Seven corrections to the SeputarBorneo cutover's own record. No behaviour
changes — every source edit is a comment.

**The `SLUG_PATTERN` citation was wrong in both languages, in six places, and it
is this repo's named recurring defect reproduced inside the ADR that names it.**
There is no symbol called `SLUG_PATTERN` in
`src/modules/blog-content/domain/legacy-import-record.ts`. The check there is an
inline regex literal, `if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))`. The only
`SLUG_PATTERN` in the repo is a **private** const in
`src/modules/blog-content/domain/slug-policy.ts`, exposed as `isValidSlug` and
imported by eight call sites, **none of them the legacy importer** — it carries
its own copy of the same expression. ADR-0114's §Alternatives told a reader that
the rejected option was to "relax `SLUG_PATTERN`", so an agent acting on it would
have greped that name, landed in `slug-policy.ts`, widened what a slug **is** for
every tenant's posts, pages, terms and menu keys, and left the importer refusing
all 25,029 rows exactly as before: the wrong half of a pair loosened, the right
half untouched. The ADR now names the inline literal, names the duplication as a
latent divergence (without refactoring it here), and states the trap explicitly.

**The ADRs' counts contradicted the corpus this branch commits.**
`data/seputarborneo-legacy/wayback-cdx-2026-08-26.txt` is **5,170** lines and
holds **2,301** `/news/*` paths of which **2,224** are the underscore article
form and **zero** are a hyphen form. The ADRs and both index rows still asserted
5,174 and "2,297 of 2,297". Corrected against the committed artefact, with the
old figures named so a future auditor can reconcile them, and with the
substantive conclusions stated as unchanged — zero `/cari_berita/*.html`, zero
hyphen-form.

**The rubrik map is 68 entries and 63 rules, not 67 and 62.** Counted from the
committed JSON: 68 entries, 63 carrying a `targetPath`, 33 at
`articlesAtCapture: 0`, ten distinct destinations. Corrected in ADR-0113 (68/33/
28), ADR-0114, both index rows, `blog-legacy-cutover-verify.ts` and
`cutover-verification.ts`. The **67** in "all 67 committed entries were replayed"
is kept and explained rather than restated: the 68th was added afterwards and has
not been replayed.

**ADR-0113's header still called Issue #599 "the half that was already
cutover-ready"** — the exact belief ADR-0114 exists to destroy, in the block an
agent reads first. Corrected in both languages.

**PROJECT_STATE §4's closing understated what is left**, and §4 is the entry
point this repo's own memory says to read first. It now lists **what is code**
(the id→path generator, which is unwritten — not a thing awaiting a tenant; and
an HTTP-level edge verifier, without which nothing here can assert #599's DoD for
a `/kategori/**` target) separately from **what is operational** (the ten
destination categories, the ~25,031 uploads / 4.1 GB the importer's new hard
refusal made load-bearing, and the Varnish/Coolify wiring), reusing ADR-0114's
own sentence: this repo cannot close the cutover.

**Two changesets claimed to close the issues.** Reworded to "toward closing" and
"found while working on": neither change closes either issue and, per ADR-0114,
this repo cannot.

**ADR-0114 asserted a pointer that did not exist.** Its §Consequences said the
"23,906 articles" figure appears in twenty-odd source comments and that "this
paragraph is the correction they point at" — nothing pointed at it. Every
editable source comment carrying the figure now does, in thirteen files; the two
`sql/NNN` migration headers keep the old figure with no pointer, and the ADR now
states why that is a reason rather than an omission: **an applied migration is
immutable in this repo**, so editing one — even a comment — blocks `db:migrate`
on a live deployment.
