-- blog_content — Issue #783: `awcms_news_portal_ad_placements` had no way to
-- disclose that a placement is paid/sponsored content, as opposed to a plain
-- ad or organic content. Disclosing paid/sponsored content is an
-- editorial-ethics requirement — and in many jurisdictions a regulatory one —
-- for a news outlet specifically.
--
-- ## Why the placement row, not the media object
--
-- The same creative can run as "standard" in one slot and "sponsored" in
-- another (e.g. a brand's banner booked as a plain ad in `sidebar_top` but as
-- disclosed sponsored content in `article_top`), so the classification is a
-- property of the BOOKING (the placement row), not of the asset
-- (`awcms_news_media_objects`, owned by `media_library`). Putting it on the
-- media object would force one classification onto every slot a creative is
-- reused in.
--
-- ## Vocabulary
--
-- `standard` — a plain ad/organic content, no disclosure needed.
-- `advertorial` — editorial-styled content that is actually paid for.
-- `sponsored` — content explicitly sponsored/underwritten by a third party.
--
-- `NOT NULL DEFAULT 'standard'` so every existing row backfills to the
-- unambiguous "no special disclosure" case with a pure catalog change — same
-- reasoning migration 078's `target_type` column documents: `ADD COLUMN ...
-- NOT NULL DEFAULT` is catalog-only on PostgreSQL 11+, so this needs no
-- separate UPDATE statement even on a populated FORCE-RLS table.
--
-- No RLS change: this is a column added to an already tenant-scoped,
-- FORCE-RLS table (migration 045) — the existing
-- `awcms_news_portal_ad_placements_tenant_isolation` policy already covers
-- every column on the row, this one included.
--
-- GRANTS: none needed. `sql/019` set default privileges for `awcms_app` in
-- schema public, and this migration creates no new table.

ALTER TABLE awcms_news_portal_ad_placements
  ADD COLUMN IF NOT EXISTS content_class text NOT NULL DEFAULT 'standard';

ALTER TABLE awcms_news_portal_ad_placements
  DROP CONSTRAINT IF EXISTS awcms_news_portal_ad_placements_content_class_check;
ALTER TABLE awcms_news_portal_ad_placements
  ADD CONSTRAINT awcms_news_portal_ad_placements_content_class_check
    CHECK (content_class IN ('standard', 'advertorial', 'sponsored'));
