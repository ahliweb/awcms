-- Permission catalog seed for `telegram_delivery` (Issue #965, ADR-0140 section 9).
--
-- Each permission is enforced by an endpoint added in the same change and
-- claimed by `/admin/telegram` (the seed-gap trap in AGENTS.md: a permission
-- nothing grants denies even `owner`). Queueing a message is NOT here: that is a
-- capability-port call made by the consuming module, authorised by that module's
-- own permission for its own business action.
--
-- Only the OWNER's own self-service is expected to be granted broadly
-- (`links.create` covers requesting a code for yourself and confirming, rejecting
-- and unlinking YOUR chat). `settings.configure` and administrator revocation
-- are high-risk and are granted to no other role by this migration.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:owner-permission-backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('telegram_delivery', 'messages', 'read',
   'Read this tenant''s Telegram queue state and recent delivery attempts (no chat ids, bodies or variables)'),
  ('telegram_delivery', 'templates', 'read',
   'Read the registered Telegram operational-notice templates (key, allowed variables)'),
  ('telegram_delivery', 'bindings', 'read',
   'Read the tenant''s Telegram chat bindings (staff member, state and a masked chat reference)'),
  ('telegram_delivery', 'bindings', 'revoke',
   'Revoke another staff member''s Telegram binding, stopping delivery and erasing the stored chat id (high-risk, audited at warning)'),
  ('telegram_delivery', 'links', 'create',
   'Link your OWN Telegram chat: request a one-time link code, confirm or reject the chat that used it, and unlink it'),
  ('telegram_delivery', 'settings', 'configure',
   'Turn Telegram delivery on or off for this tenant (high-risk, audited; turning it off revokes every binding)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
