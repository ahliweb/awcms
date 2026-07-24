-- ADR-0036 (media-library ownership inversion) — move ownership of the 9 media
-- permissions from `news_portal` to `media_library`.
--
-- `sql/042` seeds them as ('news_portal', 'media', <action>). The media registry
-- now belongs to `media_library` (the code moved in this same change), so the
-- permission keys must follow: a permission key's module segment IS the owning
-- module, and `module_management`'s registry sync reconciles seeded permissions
-- against each descriptor's declared `permissions[]`. Leaving them under
-- `news_portal` would make the catalog claim a module owns a resource it no
-- longer has any code for, and the guards now check `media_library.media.*`.
--
-- Why a NEW migration instead of editing `sql/042`: `scripts/db-migrate.ts`
-- records a SHA-256 checksum per applied file and refuses to run when an applied
-- migration's bytes change ("Create a new migration instead of editing an applied
-- one"). Editing 042 would hard-fail every database that already ran it —
-- including CI's, which migrates from scratch each run but would then disagree
-- with any long-lived database. Append-only is also AGENTS.md rule 2/3.
--
-- Order matters and is NOT arbitrary (delete-before-repoint would revoke access):
--   1. INSERT the new `media_library.media.*` rows first, so the FK targets exist.
--   2. REPOINT existing role grants to the new permission ids — this is the step
--      that makes the move non-destructive. A tenant that granted
--      `news_portal.media.create` to a role keeps that capability under the new
--      key instead of silently losing it. Skipping this would revoke media access
--      from every role that has it, which a permission RENAME must never do.
--      `awcms_role_permissions` is tenant-scoped (`tenant_id` NOT NULL, RLS
--      FORCE'd — sql/005/017); this runs as the migration owner (superuser,
--      BYPASSRLS — see sql/019's header), so it repoints across EVERY tenant.
--   3. DELETE the old rows only after (2) has moved every reference off them.
--
-- This repository has never been released on the media surface, so in practice
-- there are no production grants to carry. Step (2) is written anyway: correctness
-- here must not depend on a fact that stops being true the moment someone deploys.

-- 1. Seed the media_library-owned permission catalog rows.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('media_library', 'media', 'create', 'Create a pending media object / start a presigned upload session'),
  ('media_library', 'media', 'read', 'Read media object metadata'),
  ('media_library', 'media', 'verify', 'Finalize/verify an uploaded media object'),
  ('media_library', 'media', 'attach', 'Attach a verified media object to an owning resource'),
  ('media_library', 'media', 'detach', 'Detach a media object from its owning resource'),
  ('media_library', 'media', 'delete', 'Soft delete media object metadata'),
  ('media_library', 'media', 'restore', 'Restore a soft-deleted media object'),
  ('media_library', 'media', 'purge', 'Hard purge an already soft-deleted media object'),
  ('media_library', 'media', 'cancel', 'Cancel one''s own not-yet-uploaded media upload session')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- 2. Repoint every existing role grant from the old key to its new counterpart,
--    matched on (activity_code, action) so each grant lands on its exact
--    equivalent — carrying the grant's own `tenant_id` across. ON CONFLICT DO
--    NOTHING covers the case where a role somehow already holds both.
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT rp.tenant_id, rp.role_id, new_permission.id
FROM awcms_role_permissions rp
JOIN awcms_permissions old_permission
  ON old_permission.id = rp.permission_id
 AND old_permission.module_key = 'news_portal'
 AND old_permission.activity_code = 'media'
JOIN awcms_permissions new_permission
  ON new_permission.module_key = 'media_library'
 AND new_permission.activity_code = 'media'
 AND new_permission.action = old_permission.action
ON CONFLICT DO NOTHING;

DELETE FROM awcms_role_permissions rp
USING awcms_permissions p
WHERE p.id = rp.permission_id
  AND p.module_key = 'news_portal'
  AND p.activity_code = 'media';

-- 3. Retire the old catalog rows. Safe now: step 2 moved every grant off them.
DELETE FROM awcms_permissions
WHERE module_key = 'news_portal'
  AND activity_code = 'media';
