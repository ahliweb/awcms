-- ADR-0044 (merge `news_portal` into `blog_content`) — move ownership of the
-- editorial homepage-section and ad-placement permissions to `blog_content`.
--
-- `sql/044` seeds ('news_portal', 'homepage_sections', <action>) and `sql/045`
-- seeds ('news_portal', 'ad_placements', <action>). ADR-0044 retires the
-- `news_portal` module and moves its code under `src/modules/blog-content/`, so
-- the permission keys must follow: a permission key's module segment IS the
-- owning module, and `module_management`'s registry sync reconciles seeded
-- permissions against each descriptor's declared `permissions[]`. Leaving them
-- under `news_portal` would make the catalog claim ownership for a module that
-- no longer exists in the registry at all, and the four route guards in
-- `src/pages/api/v1/news-portal/**` now check `blog_content.*`.
--
-- This is the same shape as `sql/052`, which repointed the nine media
-- permissions from `news_portal` to `media_library` for ADR-0036. Read that
-- file's header for the fuller argument; the reasoning transfers exactly.
--
-- ## Why a NEW migration instead of editing `sql/044`/`sql/045`
--
-- `scripts/db-migrate.ts` records a SHA-256 checksum per applied file and
-- refuses to run when an applied migration's bytes change ("Create a new
-- migration instead of editing an applied one"). Editing them would hard-fail
-- every database that already ran them. Append-only is also AGENTS.md rule 2/3.
--
-- ## Order matters and is NOT arbitrary (delete-before-repoint would revoke)
--
--   1. INSERT the new `blog_content`-owned rows first, so the FK targets exist.
--   2. REPOINT existing role grants onto the new permission ids. This is the
--      step that makes the move non-destructive: a tenant that granted
--      `news_portal.homepage_sections.configure` to a role keeps that
--      capability under the new key instead of silently losing it. This is also
--      why no separate "backfill existing tenants" statement is needed —
--      `awcms_role_permissions.permission_id` is a FK to `awcms_permissions(id)`,
--      so moving the grant IS the backfill. (A migration that only INSERTed new
--      catalog rows would leave existing tenants with a grant on a row about to
--      be deleted: access revoked, every gate green. That is the failure this
--      ordering exists to prevent.)
--   3. DELETE the old rows only after (2) has moved every reference off them.
--
-- `awcms_role_permissions` is tenant-scoped (`tenant_id` NOT NULL, RLS FORCE'd —
-- sql/005/017); this runs as the migration owner (superuser, BYPASSRLS — see
-- sql/019's header), so step 2 repoints across EVERY tenant, not just one.
--
-- ## Descriptions are not carried over verbatim
--
-- The `ad_placements` rows drop the "news portal" qualifier that `sql/045` used
-- ("Read news portal advertisement placement configuration"): after the merge
-- there is no news portal module for them to qualify, and ADR-0044 §4 unifies
-- these placements with `blog_content`'s own advertisements. The text here is
-- byte-identical to `blog-content/module.ts`'s declared `permissions[]`.

-- 1. Seed the blog_content-owned permission catalog rows.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('blog_content', 'homepage_sections', 'read', 'Read editorial homepage section configuration'),
  ('blog_content', 'homepage_sections', 'configure', 'Create, update, reorder, enable/disable, or delete editorial homepage sections'),
  ('blog_content', 'ad_placements', 'read', 'Read advertisement placement configuration'),
  ('blog_content', 'ad_placements', 'configure', 'Create, update, enable/disable, or delete advertisement placements')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- 2. Repoint every existing role grant from the old key onto its exact
--    (activity_code, action) counterpart, carrying the grant's own tenant_id.
--    ON CONFLICT DO NOTHING covers a role that somehow already holds both.
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT rp.tenant_id, rp.role_id, new_permission.id
FROM awcms_role_permissions rp
JOIN awcms_permissions old_permission
  ON old_permission.id = rp.permission_id
 AND old_permission.module_key = 'news_portal'
 AND old_permission.activity_code IN ('homepage_sections', 'ad_placements')
JOIN awcms_permissions new_permission
  ON new_permission.module_key = 'blog_content'
 AND new_permission.activity_code = old_permission.activity_code
 AND new_permission.action = old_permission.action
ON CONFLICT DO NOTHING;

DELETE FROM awcms_role_permissions rp
USING awcms_permissions p
WHERE p.id = rp.permission_id
  AND p.module_key = 'news_portal'
  AND p.activity_code IN ('homepage_sections', 'ad_placements');

-- 3. Retire the old catalog rows. Safe now: step 2 moved every grant off them.
DELETE FROM awcms_permissions
WHERE module_key = 'news_portal'
  AND activity_code IN ('homepage_sections', 'ad_placements');
