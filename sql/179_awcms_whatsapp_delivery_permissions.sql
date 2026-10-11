-- Permission catalog seed for `whatsapp_delivery` (Issue #963, ADR-0133 section 8).
--
-- Each permission is enforced by an endpoint added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`).
-- Queueing a message is NOT here: that is a capability-port call made by the
-- consuming module, authorised by that module's own permission for its own
-- business action, never by a permission over this queue.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:owner-permission-backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('whatsapp_delivery', 'messages', 'read',
   'Read this tenant''s WhatsApp queue state and recent delivery attempts (recipients masked)'),
  ('whatsapp_delivery', 'messages', 'cancel',
   'Cancel a WhatsApp message that is still waiting in the queue (refused once it is being sent)'),
  ('whatsapp_delivery', 'suppressions', 'read',
   'Read the WhatsApp suppression list (recipients masked)'),
  ('whatsapp_delivery', 'suppressions', 'create',
   'Suppress a number so no WhatsApp message is sent to it'),
  ('whatsapp_delivery', 'suppressions', 'delete',
   'Remove a WhatsApp suppression entry, resuming delivery to that number'),
  ('whatsapp_delivery', 'consents', 'read',
   'Read recorded WhatsApp marketing consents (recipients masked)'),
  ('whatsapp_delivery', 'consents', 'create',
   'Record a recipient''s explicit WhatsApp marketing opt-in with its source'),
  ('whatsapp_delivery', 'consents', 'restore',
   'Reinstate a WhatsApp marketing opt-in over a recipient''s recorded opt-out, citing evidence (high-risk: it reverses an opt-out)'),
  ('whatsapp_delivery', 'consents', 'withdraw',
   'Record a recipient''s WhatsApp marketing opt-out; queued marketing messages to them are cancelled'),
  ('whatsapp_delivery', 'templates', 'read',
   'Read the registered WhatsApp templates (key, purpose, allowed variables)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
