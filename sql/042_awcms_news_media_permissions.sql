-- news_portal — permission catalog seed for the news media registry, wiring
-- up the constants frozen in `news-portal/domain/news-media-permissions.ts`
-- (`NEWS_MEDIA_PERMISSIONS`) and this module's `module.ts` `permissions`
-- array. Ported from awcms-mini migration 042. Extends the global ABAC
-- permission catalog only — no roles/access-assignments are wired here; only
-- tenants created AFTER this migration runs pick these up automatically via
-- the setup bootstrap's `INSERT INTO awcms_role_permissions ... SELECT ...
-- FROM awcms_permissions` (same limitation every prior permission-seed
-- migration has).
--
-- `cancel` is a distinct, lower-risk permission from `delete` (cancel one's
-- OWN not-yet-uploaded upload session vs. soft-deleting real metadata).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('news_portal', 'media', 'create', 'Create a pending news media object / start a presigned upload session'),
  ('news_portal', 'media', 'read', 'Read news media object metadata'),
  ('news_portal', 'media', 'verify', 'Finalize/verify an uploaded news media object'),
  ('news_portal', 'media', 'attach', 'Attach a verified news media object to an owning resource'),
  ('news_portal', 'media', 'detach', 'Detach a news media object from its owning resource'),
  ('news_portal', 'media', 'delete', 'Soft delete news media object metadata'),
  ('news_portal', 'media', 'restore', 'Restore a soft-deleted news media object'),
  ('news_portal', 'media', 'purge', 'Hard purge an already soft-deleted news media object'),
  ('news_portal', 'media', 'cancel', 'Cancel one''s own not-yet-uploaded news media upload session')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
