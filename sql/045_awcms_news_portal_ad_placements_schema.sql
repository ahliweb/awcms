-- news_portal — R2-only advertisement placement presets. Ported from
-- awcms-mini migration 049. Deliberately a SEPARATE, narrower table from
-- blog_content's generic free-URL ads: every row here is R2-only BY
-- CONSTRUCTION (`media_object_id` is a real FK into the news media registry,
-- there is no free-text image URL column at all), so there is no need for a
-- full-online-R2-mode runtime gate.
--
-- `placement_key` is a fixed preset vocabulary (the twelve values below);
-- `recommended_size`/`allowed_media_types`/`max_items` per placement are
-- static, code-level metadata (`news-portal/domain/ad-placement-policy.ts`'s
-- `AD_PLACEMENT_PRESETS`). `max_items` is enforced at RENDER-selection time
-- only (`ad-placement-rotation.ts`), NOT as a write-time cap.
--
-- Residual/latent risk (documented, not exploitable today): `media_object_id`
-- is a REAL FK, so a future hard-purge of a still-referenced media object
-- would fail with a raw Postgres FK-violation. There is no purge endpoint in
-- this port, so this cannot be triggered via any existing endpoint; whichever
-- issue adds one MUST catch the FK violation (or pre-check referencing rows).
CREATE TABLE IF NOT EXISTS awcms_news_portal_ad_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  placement_key text NOT NULL,
  name text NOT NULL,
  media_object_id uuid NOT NULL REFERENCES awcms_news_media_objects (id),
  link_url text,
  rotation_mode text NOT NULL DEFAULT 'latest',
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_news_portal_ad_placements_placement_key_check
    CHECK (placement_key IN (
      'header_banner', 'below_headline', 'homepage_middle', 'homepage_bottom',
      'article_top', 'article_middle', 'article_bottom',
      'sidebar_top', 'sidebar_middle', 'sidebar_bottom',
      'category_archive_top', 'search_result_top'
    )),
  CONSTRAINT awcms_news_portal_ad_placements_rotation_mode_check
    CHECK (rotation_mode IN ('latest', 'priority', 'random_safe', 'weighted')),
  CONSTRAINT awcms_news_portal_ad_placements_priority_check
    CHECK (priority >= 0),
  CONSTRAINT awcms_news_portal_ad_placements_schedule_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

-- Supports both the admin listing (filter/group by placement) and the
-- render-time "active ads for this placement" query.
CREATE INDEX IF NOT EXISTS awcms_news_portal_ad_placements_tenant_key_idx
  ON awcms_news_portal_ad_placements (tenant_id, placement_key)
  WHERE deleted_at IS NULL;

-- FK lookup index (doc 10 convention: every foreign key gets an index).
CREATE INDEX IF NOT EXISTS awcms_news_portal_ad_placements_media_object_id_idx
  ON awcms_news_portal_ad_placements (media_object_id);

ALTER TABLE awcms_news_portal_ad_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_news_portal_ad_placements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_news_portal_ad_placements_tenant_isolation
  ON awcms_news_portal_ad_placements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permission catalog seed — same "read" + "configure" action pair every other
-- admin-configured-master-data resource in this epic uses.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('news_portal', 'ad_placements', 'read', 'Read news portal advertisement placement configuration'),
  ('news_portal', 'ad_placements', 'configure', 'Create, update, enable/disable, or delete news portal advertisement placements')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
