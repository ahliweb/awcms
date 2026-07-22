-- `blog_content` module — presentation/monetization schema. Ported from
-- awcms-mini migration 029 (minus `translation_group_id`, folded into
-- migration 035's core content schema instead — both `awcms_blog_posts`
-- and `awcms_blog_pages` already exist by the time this migration runs, so
-- there is no fresh-DB reason to keep it a separate later ALTER).
--
-- Per mini's own Scope Control: this does NOT rebuild the base media
-- library, base tenant system, base RBAC/ABAC, base audit, or the base
-- theme engine (`awcms_tenants.default_theme`) — `awcms_blog_theme_settings`
-- below is a blog-scoped *override* of that tenant default, not a parallel
-- theme engine. Media/gallery is deliberately NOT a new table here: there is
-- no base media library to integrate with beyond the already-loose
-- `featured_media_id`/`seo_image_media_id` uuid references on posts/pages
-- (no FK), so gallery support is a whitelisted `content_json` block type
-- instead (see `domain/content-block-rendering.ts`).
--
-- No explicit `GRANT` statements needed — sql/019's `ALTER DEFAULT
-- PRIVILEGES` already covers every new table the owning role creates (same
-- reasoning migration 035 documents). None of these tables are touched by
-- the `blog:publish:scheduled` worker, so no `awcms_worker` grant either.

-- Templates: tenant-scoped named layout configurations. `layout_json` is a
-- whitelisted shape validated at the application layer
-- (`domain/template-policy.ts`), never arbitrary script — template
-- rendering must stay within safe predefined layout rules.
CREATE TABLE IF NOT EXISTS awcms_blog_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  key text NOT NULL,
  name text NOT NULL,
  layout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_templates_key_dedup
  ON awcms_blog_templates (tenant_id, key)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_blog_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_templates_tenant_isolation
  ON awcms_blog_templates
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Menus: tenant-scoped named navigation trees.
CREATE TABLE IF NOT EXISTS awcms_blog_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  key text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_menus_key_dedup
  ON awcms_blog_menus (tenant_id, key)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_blog_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_menus FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_menus_tenant_isolation
  ON awcms_blog_menus
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Menu items: hierarchical (self-FK `parent_item_id`, same one-level-parent
-- convention as `awcms_blog_terms`). `link_type` gates which of
-- `target_id`/`url` is meaningful — "internal blog content" (post/page id)
-- or a "safe external URL" (unsafe URLs rejected at the application layer,
-- `domain/menu-policy.ts`'s reuse of `seo-validation.ts`'s
-- `isAbsoluteHttpUrl`, same defense-in-depth convention as canonical URLs).
CREATE TABLE IF NOT EXISTS awcms_blog_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  menu_id uuid NOT NULL REFERENCES awcms_blog_menus (id),
  parent_item_id uuid REFERENCES awcms_blog_menu_items (id),
  label text NOT NULL,
  link_type text NOT NULL,
  target_id uuid,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_menu_items_link_type_check
    CHECK (link_type IN ('post', 'page', 'url'))
);

CREATE INDEX IF NOT EXISTS awcms_blog_menu_items_menu_idx
  ON awcms_blog_menu_items (tenant_id, menu_id, sort_order);

ALTER TABLE awcms_blog_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_menu_items FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_menu_items_tenant_isolation
  ON awcms_blog_menu_items
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Widgets: tenant-scoped content blocks placed at a fixed `position`. Body
-- is plain text, escaped at render time (same whitelist convention as
-- `content-block-rendering.ts`) — no raw-HTML field.
CREATE TABLE IF NOT EXISTS awcms_blog_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  position text NOT NULL,
  title text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_blog_widgets_position_check
    CHECK (position IN ('header', 'sidebar', 'footer', 'content_before', 'content_after'))
);

CREATE INDEX IF NOT EXISTS awcms_blog_widgets_position_idx
  ON awcms_blog_widgets (tenant_id, position, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_blog_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_widgets FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_widgets_tenant_isolation
  ON awcms_blog_widgets
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Ads: tenant-scoped advertisement records. `image_url`/`link_url` are
-- validated absolute http(s) URLs (application layer, `domain/ad-
-- policy.ts`) — never raw HTML/embed markup, so rendering can never become
-- an XSS channel.
CREATE TABLE IF NOT EXISTS awcms_blog_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  name text NOT NULL,
  image_url text NOT NULL,
  link_url text,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_blog_ads_schedule_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE awcms_blog_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_ads FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_ads_tenant_isolation
  ON awcms_blog_ads
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Ad placements: where one ad is targeted. `target_id` is meaningful only
-- for `widget`/`post`/`page` (null for `global`) — same "type gates which
-- reference column is meaningful" convention as menu items above.
CREATE TABLE IF NOT EXISTS awcms_blog_ad_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  ad_id uuid NOT NULL REFERENCES awcms_blog_ads (id),
  placement_type text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_ad_placements_type_check
    CHECK (placement_type IN ('global', 'widget', 'post', 'page'))
);

CREATE INDEX IF NOT EXISTS awcms_blog_ad_placements_lookup_idx
  ON awcms_blog_ad_placements (tenant_id, placement_type, target_id);

CREATE INDEX IF NOT EXISTS awcms_blog_ad_placements_ad_idx
  ON awcms_blog_ad_placements (tenant_id, ad_id);

ALTER TABLE awcms_blog_ad_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_ad_placements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_ad_placements_tenant_isolation
  ON awcms_blog_ad_placements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Theme mode: one row per tenant, same shape/convention as
-- `awcms_blog_settings` (migration 035) — a blog-scoped override of
-- `awcms_tenants.default_theme`; absence of a row means "inherit the
-- tenant default", not "light" (see `application/theme-settings-
-- directory.ts`).
CREATE TABLE IF NOT EXISTS awcms_blog_theme_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  mode text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_theme_settings_mode_check
    CHECK (mode IN ('light', 'dark', 'system'))
);

ALTER TABLE awcms_blog_theme_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_theme_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_theme_settings_tenant_isolation
  ON awcms_blog_theme_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
