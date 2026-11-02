-- Permission catalog seed for the `whatsapp_delivery` sender routing surface
-- (Issue #1141, ADR-0148 section 4; pack section 9 "Permissions").
--
-- Both permissions are enforced by a route added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`,
-- and one nothing enforces is a promise the product does not keep).
--
--   senders.read              read this tenant's WhatsApp senders with their
--                             queue, quota and availability diagnostics, and the
--                             default-sender policy
--   sender_policy.configure   set or clear the prospective default sender of a
--                             business scope. HIGH-RISK (`configure`): it decides
--                             which number and provider speak for the tenant, so
--                             it is audited at `warning` and needs an
--                             `Idempotency-Key`
--
-- The pack's working names `whatsapp_delivery.senders.read` and
-- `.policy.configure` map onto these (`AccessAction` is a closed vocabulary).
-- Deliberately NOT here: `channel_accounts.senders.use` and
-- `whatsapp_delivery.risk.acknowledge`. The port performs no access check (the
-- consumer authorises its own business action, ADR-0011), so nothing in this
-- change could enforce `senders.use`; the StarSender risk acknowledgement
-- belongs to its adapter (Issue #1142).
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('whatsapp_delivery', 'senders', 'read',
   'Read this tenant''s WhatsApp senders with queue, quota and availability diagnostics, and the default-sender policy (never a credential or a number)'),
  ('whatsapp_delivery', 'sender_policy', 'configure',
   'Set or clear the default WhatsApp sender of a business scope; affects later messages only (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
