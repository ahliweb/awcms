-- Permission catalog seed for the Meta Cloud API sender binding (Issue #1143).
--
-- Every permission is enforced by a route added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`,
-- and one nothing enforces is a promise the product does not keep).
--
--   channel_accounts.webhooks.configure
--       create (or rotate) the signed webhook subscription of a Meta phone
--       number: stores the Meta app secret write-only and shows the opaque
--       callback token ONCE. HIGH-RISK (`configure`): whoever holds the token
--       and the secret can feed status and inbound events for that number, so
--       it needs an `Idempotency-Key`, a conditional step-up and is audited at
--       `warning`.
--   whatsapp_delivery.meta_templates.read
--       read which Meta templates are approved on which WABA, and each WABA's
--       restriction and messaging-limit signals.
--   whatsapp_delivery.meta_templates.configure
--       record a Meta template's approval status on a WABA (approved needs an
--       evidence reference). HIGH-RISK: an approved row lets messages be sent
--       with that template. `Idempotency-Key`, audited at `warning`.
--   whatsapp_delivery.meta_signals.configure
--       clear a recorded WABA restriction after the operator verified it was
--       lifted at Meta. HIGH-RISK: it re-opens a sender. `Idempotency-Key`,
--       audited at `warning`.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('channel_accounts', 'webhooks', 'configure',
   'Create or rotate the signed webhook subscription of a Meta WhatsApp number (app secret stored write-only, callback token shown once; high-risk, audited at warning)'),
  ('whatsapp_delivery', 'meta_templates', 'read',
   'Read the Meta template approvals per WABA and each WABA''s restriction and messaging-limit signals'),
  ('whatsapp_delivery', 'meta_templates', 'configure',
   'Record a Meta template approval status on a WABA (approved needs evidence; high-risk, audited at warning)'),
  ('whatsapp_delivery', 'meta_signals', 'configure',
   'Clear a recorded WABA restriction once it was verified lifted at Meta (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
