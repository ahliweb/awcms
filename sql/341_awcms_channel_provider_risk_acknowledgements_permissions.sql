-- Permission catalog seed for the provider risk acknowledgement surface (Issue
-- #1142, ADR-0148 section 7). Every permission below is enforced by a route added
-- in the same change (the seed-gap trap in AGENTS.md).
--
--   risk_acknowledgements.read     read the current text of an unofficial
--                                  provider's risk acknowledgement and who has
--                                  acknowledged it
--   risk_acknowledgements.create   record the caller's OWN acknowledgement of the
--                                  current text. Separately grantable, so it is
--                                  not implied by `accounts.create`: connecting
--                                  an account and accepting a provider's risk are
--                                  different decisions. A person acknowledges for
--                                  themselves; nobody records one for somebody else
--   risk_acknowledgements.revoke   revoke an acknowledgement (HIGH-RISK, audited at
--                                  warning). It degrades the tenant's accounts of
--                                  that provider when it removes the last one
--
-- `AccessAction` is a closed vocabulary shared by every module, so the working
-- names map onto it (acknowledge -> create).
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('channel_accounts', 'risk_acknowledgements', 'read',
   'Read the current risk text of an unofficial channel provider and who has acknowledged it'),
  ('channel_accounts', 'risk_acknowledgements', 'create',
   'Record your own acknowledgement of the current risk text of an unofficial channel provider (needed before a device of that provider can be connected)'),
  ('channel_accounts', 'risk_acknowledgements', 'revoke',
   'Revoke a risk acknowledgement of an unofficial channel provider; degrades the tenant''s accounts of that provider when it was the last one (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
