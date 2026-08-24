-- Issue #599 — remove the half of `sql/138` that nothing ever wrote or read.
--
-- `sql/138` gave BOTH `awcms_blog_posts` and `awcms_blog_pages` a
-- `legacy_source_system`/`legacy_source_id` pair, on the reasoning that "a
-- legacy archive has static pages too, and giving only posts provenance would
-- make half the 301 map underivable". The posts half was then built:
-- `blog:legacy:import` writes it and `listLegacyRedirectMappings` derives the
-- redirect map from it. The pages half never was. No importer writes these two
-- columns, no query reads them, and no code path anywhere in `src/`, `scripts/`
-- or `tests/` mentions them.
--
-- ## Why they are dropped rather than wired
--
-- Reading the legacy site's actual `.htaccess` (SHAPE ROUND, 24 August 2026)
-- settled the question these columns were speculating about. Its static-page
-- rewrite is `^([^/]*)\.html$ -> /data/?halaman=$1`, and `data/index.php`
-- switches on a CLOSED SET OF THREE: `tentang_kami`, `pedoman_media_cyber`,
-- `disclimer`. Three URLs is three exact-path rules in `awcms_seo_redirects`,
-- which has supported them since `sql/060` — admin data entry, not an importer
-- and not a backfill. There is no volume here for a derived map to solve.
--
-- ## Why leaving them was not the cheap option
--
-- `tests/legacy-redirect-map.test.ts` asserted that the MIGRATION FILE'S TEXT
-- contained `ALTER TABLE awcms_blog_pages` and the dedup index name, under the
-- title "pages get the same treatment as posts". That reads as coverage. A test
-- over a migration's source proves a column EXISTS; it cannot notice the column
-- is never used, and this one sat next to a comment stating the stakes. So the
-- dead pair was not inert — it was actively answering "is the static-page half
-- handled?" with "yes".
--
-- ## Safety
--
-- Nothing has ever written these columns, so every row's value is NULL in every
-- deployment; there is no data to lose and no backfill to plan. The posts
-- columns, its index, and its CHECK are deliberately untouched — they are the
-- live half.
--
-- If a future legacy source really does bring thousands of static pages, this
-- comes back as its own migration alongside the importer that fills it, which
-- is the order that would have avoided the problem the first time.

ALTER TABLE awcms_blog_pages
  DROP CONSTRAINT IF EXISTS awcms_blog_pages_legacy_provenance_check;

DROP INDEX IF EXISTS awcms_blog_pages_legacy_source_dedup;

ALTER TABLE awcms_blog_pages
  DROP COLUMN IF EXISTS legacy_source_system,
  DROP COLUMN IF EXISTS legacy_source_id;
