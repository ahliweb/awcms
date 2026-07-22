-- news_portal — configurable editorial homepage section composer. Six section
-- types, each backed entirely by EXISTING public-safe data (blog_content posts
-- + the R2 media registry) — no new content-authoring surface, no raw HTML.
-- Ported from awcms-mini migration 044. `video_block`/`ad_slot`/
-- `custom_widget_block` are deliberately NOT included (out of scope /
-- superseded by the dedicated ad_placements table in migration 045).
--
-- PORT NOTE (awcms): the host-resolved `/news` public render surface that
-- consumed these sections (`homepage-section-composer.ts`/
-- `homepage-section-rendering.ts`) is NOT ported (needs the `tenant_domain`
-- routing module). The admin CRUD API (`/api/v1/news-portal/homepage-sections`)
-- and its write-time reference validation ARE ported; the section rows are
-- authored and stored here, ready for a `/news` port to render later.
CREATE TABLE IF NOT EXISTS awcms_news_portal_homepage_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  section_key text NOT NULL,
  section_type text NOT NULL,
  title text,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_news_portal_homepage_sections_type_check
    CHECK (section_type IN (
      'headline', 'latest_posts', 'featured_posts', 'editor_picks',
      'category_grid', 'gallery_block'
    )),
  CONSTRAINT awcms_news_portal_homepage_sections_schedule_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_news_portal_homepage_sections_tenant_key_dedup
  ON awcms_news_portal_homepage_sections (tenant_id, section_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_news_portal_homepage_sections_tenant_order_idx
  ON awcms_news_portal_homepage_sections (tenant_id, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_news_portal_homepage_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_news_portal_homepage_sections FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_news_portal_homepage_sections_tenant_isolation
  ON awcms_news_portal_homepage_sections
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permission catalog seed — same "read" + "configure" action pair
-- blog_content's ads/menus/widgets already use. No separate "reorder" action;
-- per-section `sort_order` is just another field on the same `configure`-
-- guarded update.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('news_portal', 'homepage_sections', 'read', 'Read editorial homepage section configuration'),
  ('news_portal', 'homepage_sections', 'configure', 'Create, update, reorder, enable/disable, or delete editorial homepage sections')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
