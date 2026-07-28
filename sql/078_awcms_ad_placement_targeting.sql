-- blog_content — ADR-0044 §4, langkah pertama: widen the media-backed ad
-- placement table so it can express everything the free-URL system could.
--
-- ## Why widen before migrating
--
-- ADR-0044 merged `news_portal` into `blog_content`, which left the module
-- owning TWO advertisement systems, each holding a capability the other lacks:
--
--   `awcms_blog_ads` + `awcms_blog_ad_placements` (migration 037)
--     - free-text `image_url` — ANY URL, no media registry involved
--     - targeting: `placement_type` global/widget/post/page + `target_id`
--
--   `awcms_news_portal_ad_placements` (migration 045)
--     - `media_object_id`, a REAL foreign key into the verified media registry
--     - twelve fixed slots, four rotation modes, priority, soft delete, audit
--     - NO targeting at all — every row is effectively site-wide
--
-- The media-backed table is the survivor: `image_url text` accepts any URL the
-- admin types, which is precisely the managed-media enforcement ADR-0036
-- inverted media ownership to establish. Dropping the free-URL system is the
-- point of Fase 2.
--
-- But dropping it FIRST would silently destroy per-post and per-page ad
-- targeting, because the survivor cannot express it. So the survivor is
-- widened here, in its own migration, before a single row moves. This file
-- moves NO data and drops NO table — the ingest job and the drop are separate,
-- reviewable steps, in that order.
--
-- ## Column semantics
--
-- `placement_key` (already present) is the SLOT — where on the page. Its
-- twelve values are a fixed preset vocabulary with static per-slot metadata in
-- `domain/ad-placement-policy.ts`.
--
-- `target_type`/`target_id` (added here) are the SCOPE — which pages the slot
-- is filled on. The two are orthogonal: `sidebar_top` + `global` means "the
-- top sidebar slot on every page", `sidebar_top` + `post:<uuid>` means "the
-- same slot, but only on that one article".
--
-- `target_type = 'global'` with a NULL `target_id` is the DEFAULT, which is
-- also exactly what every pre-existing row means today — the table had no
-- targeting, so every row was site-wide. Existing rows therefore need no
-- backfill and no data statement: `ADD COLUMN ... NOT NULL DEFAULT` on
-- PostgreSQL 11+ is a catalog-only change, so this stays pure DDL on a
-- populated FORCE-RLS table (same reasoning migration 024 records).
--
-- ## The pairing constraint, and why it is not left to the application
--
-- The retired `awcms_blog_ad_placements` left `target_id` plainly nullable and
-- enforced "required for widget/post/page, forbidden for global" only in
-- `domain/ad-policy.ts`. That works exactly as long as every writer goes
-- through that validator. A `global` row carrying a stray `target_id`, or a
-- `post` row carrying none, is unrenderable either way — so the rule is
-- expressed here, where no caller can route around it.
--
-- `target_id` is deliberately NOT a foreign key: it points at a post, a page,
-- or a widget depending on `target_type`, and SQL has no polymorphic FK.
-- Existence and tenant ownership are checked at write time by
-- `application/ad-placement-reference-validation.ts`, and the render query
-- joins nothing on it — an ad whose target was deleted simply stops matching.
--
-- GRANTS: none needed. `sql/019` set default privileges for `awcms_app` in
-- schema public, and this migration creates no new table.

ALTER TABLE awcms_news_portal_ad_placements
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS target_id uuid;

ALTER TABLE awcms_news_portal_ad_placements
  DROP CONSTRAINT IF EXISTS awcms_news_portal_ad_placements_target_type_check;
ALTER TABLE awcms_news_portal_ad_placements
  ADD CONSTRAINT awcms_news_portal_ad_placements_target_type_check
    CHECK (target_type IN ('global', 'widget', 'post', 'page'));

ALTER TABLE awcms_news_portal_ad_placements
  DROP CONSTRAINT IF EXISTS awcms_news_portal_ad_placements_target_pairing_check;
ALTER TABLE awcms_news_portal_ad_placements
  ADD CONSTRAINT awcms_news_portal_ad_placements_target_pairing_check
    CHECK (
      (target_type = 'global' AND target_id IS NULL)
      OR (target_type <> 'global' AND target_id IS NOT NULL)
    );

-- The render query now filters on (tenant_id, placement_key, target_type,
-- target_id). This index leads with the same two columns as migration 045's
-- `..._tenant_key_idx`, so it serves every query that one served and the older
-- index becomes dead weight on every write. Dropping it is safe: it is
-- redundant, not load-bearing.
CREATE INDEX IF NOT EXISTS awcms_news_portal_ad_placements_tenant_target_idx
  ON awcms_news_portal_ad_placements
     (tenant_id, placement_key, target_type, target_id)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS awcms_news_portal_ad_placements_tenant_key_idx;
