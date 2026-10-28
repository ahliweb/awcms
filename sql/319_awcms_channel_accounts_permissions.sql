-- Permission catalog seed for `channel_accounts` (Issue #1140, ADR-0148 section
-- 1 capability C1; pack section 9 "Permissions").
--
-- Every permission below is enforced by a route added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`,
-- and one nothing enforces is a promise the product does not keep). There is no
-- admin screen yet (Issue #1154), so the module declares no navigation entry.
--
-- `AccessAction` is a closed vocabulary shared by every module (the high-risk
-- classification hangs off it), so the pack's working names map onto it:
-- connect -> create, disconnect -> revoke, capabilities.grant -> configure,
-- assignments.manage -> assign.
--
--   accounts.read          list/read accounts, connections, capabilities, health
--   accounts.create        register an account, start/complete an OAuth grant,
--                          enable/disable an account
--   accounts.revoke        disconnect an account or revoke a connection (clears
--                          the stored credential; high-risk, audited at warning)
--   capabilities.configure record or withdraw a capability with its evidence
--   credentials.manage     write or replace an account's credential. HIGH-RISK:
--                          requires an enrolled MFA factor to exercise
--                          (`requiresMfaEnrolment`) and a fresh step-up for an
--                          enrolled holder, audited at warning. Separately
--                          grantable, so it is not implied by `accounts.create`.
--   assignments.assign     assign or unassign who may operate one account
--
-- Deliberately NOT here: `channel_accounts.senders.use` and the
-- `whatsapp_delivery.*` sender permissions of the pack. No route enforces them
-- until Issue #1141 adds sender routing; seeding them now would be a permission
-- that grants nothing the code checks. #1141 seeds them with its own routes.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:owner-permission-backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('channel_accounts', 'accounts', 'read',
   'Read this tenant''s connected channel accounts, provider connections, capabilities and health (never a credential)'),
  ('channel_accounts', 'accounts', 'create',
   'Register a channel account, start and complete a provider authorisation, and enable or disable an account'),
  ('channel_accounts', 'accounts', 'revoke',
   'Disconnect a channel account or revoke a provider connection, erasing the stored credential (high-risk, audited at warning)'),
  ('channel_accounts', 'capabilities', 'configure',
   'Record or withdraw what a channel account may do, with the approval or contract evidence for it (high-risk, audited at warning)'),
  ('channel_accounts', 'credentials', 'manage',
   'Write or replace a channel account credential (API token, device key, bot token). Write-only: no API ever returns it (high-risk, MFA enrolment and step-up, audited at warning)'),
  ('channel_accounts', 'assignments', 'assign',
   'Assign or unassign who may operate one channel account')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
