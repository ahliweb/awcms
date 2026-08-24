---
"awcms": patch
---

chore(db): drop the half of `sql/138` that nothing ever wrote or read

`sql/138` gave BOTH `awcms_blog_posts` and `awcms_blog_pages` a
`legacy_source_system`/`legacy_source_id` pair, reasoning that "a legacy archive
has static pages too, and giving only posts provenance would make half the 301
map underivable". The posts half was then built — `blog:legacy:import` writes it
and `listLegacyRedirectMappings` derives the redirect map from it. The pages half
never was: no importer writes those two columns and no query reads them,
anywhere in `src/`, `scripts/` or `tests/`.

Reading the legacy site's actual `.htaccess` settled the question they were
speculating about. The static-page rewrite is
`^([^/]*)\.html$ -> /data/?halaman=$1`, and `data/index.php` switches on a
CLOSED SET OF THREE — `tentang_kami`, `pedoman_media_cyber`, `disclimer`. Three
URLs is three exact-path rules in `awcms_seo_redirects`, supported since
`sql/060`: admin data entry, not an importer and not a backfill.

**Leaving them was not the cheap option, which is the part worth keeping.**
`tests/legacy-redirect-map.test.ts` asserted that the MIGRATION FILE'S TEXT
contained `ALTER TABLE awcms_blog_pages`, under the title "pages get the same
treatment as posts". That reads as coverage and is not: a test over a
migration's source proves a column exists, and cannot notice the column is dead.
So the pair was not inert — it was answering "is the static-page half handled?"
with "yes". That test is replaced by one that searches for a READER, which is
the assertion the old one could not make.

Safe by construction: nothing has ever written these columns, so every row's
value is NULL in every deployment. There is no data to lose and no backfill to
plan. The posts columns, their index and their CHECK are untouched — they are
the live half, and the 301 map is derived from them.
