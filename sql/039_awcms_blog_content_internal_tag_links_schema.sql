-- `blog_content` module — automatic internal tag linking policy. Ported
-- from awcms-mini migration 051 (its `auto_internal_tag_links_disabled`
-- per-post column already lives on `awcms_blog_posts` since migration 035 —
-- a fresh DB needs no separate later ALTER for it).
--
-- `awcms_blog_internal_tag_link_settings` — per-tenant policy override
-- (tenant on/off switch, case-insensitive matching toggle, disabled tag id
-- list). Deliberately a DEDICATED table, same one-row-per-tenant shape as
-- `awcms_blog_theme_settings` (migration 037) — NOT folded into
-- `awcms_blog_settings.settings` jsonb. Reason: that `settings` column is a
-- catch-all `blog-settings-directory.ts`'s `upsertBlogSettings` rewrites
-- WHOLESALE from an explicit key allowlist on every `PATCH
-- /api/v1/blog/settings` call — a key not included in that allowlist would
-- be SILENTLY DROPPED the next time an admin updates any other blog
-- setting. A dedicated table avoids this entanglement entirely, and matches
-- this feature's own separately-permissioned concern
-- (`blog_content.internal_links.{read,configure,preview}`, distinct from
-- `blog_content.settings.*`, seeded by migration 040) — read/written ONLY
-- through its own directory (`internal-tag-link-settings-directory.ts`) and
-- its own endpoint (`/api/v1/blog/internal-tag-links/settings`), never
-- through the generic settings endpoint.
--
-- `disabled_tag_ids` is a plain `uuid[]` (no join table) — validated at the
-- application layer against `awcms_blog_terms` (must exist, same tenant,
-- `taxonomy_type = 'tag'`, not soft-deleted) before every write. A stale id
-- left behind after a tag is later deleted is harmless (deleted tags are
-- already excluded from the render-time candidate list regardless of this
-- array).
--
-- No explicit `GRANT` needed for `awcms_app` (sql/019's `ALTER DEFAULT
-- PRIVILEGES`); not touched by the `blog:publish:scheduled` worker, so no
-- `awcms_worker` grant either.
CREATE TABLE IF NOT EXISTS awcms_blog_internal_tag_link_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  enabled boolean NOT NULL DEFAULT true,
  case_insensitive boolean NOT NULL DEFAULT false,
  disabled_tag_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awcms_blog_internal_tag_link_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_internal_tag_link_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_internal_tag_link_settings_tenant_isolation
  ON awcms_blog_internal_tag_link_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
