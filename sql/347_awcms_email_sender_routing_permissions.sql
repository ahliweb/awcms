-- Permission catalog seed for the `email` sender routing surface (Issue #1160,
-- ADR-0151 section 6 "new permissions seeded by migration in the same change as
-- their route").
--
-- Every permission here is enforced by a route added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`,
-- and one nothing enforces is a promise the product does not keep).
--
--   senders.read              GET /api/v1/email/senders: this tenant's
--                             Mailketing sender identities with their queue,
--                             quota, verification and credit diagnostics, and
--                             the default-sender policy. Never a token, never a
--                             secret reference.
--   senders.use               POST /api/v1/email/announcements with an explicit
--                             `senderAccountId` or a `businessScope`: send AS a
--                             tenant sender. Required in ADDITION to the
--                             announcement permissions, so a role that may mail
--                             users cannot choose which brand speaks.
--   sender_policy.configure   PUT /api/v1/email/sender-policy: set or clear the
--                             prospective default sender of a business scope.
--                             HIGH-RISK (`configure`): it decides which address
--                             and which Mailketing account speak for the tenant,
--                             so it is audited at `warning` and needs an
--                             `Idempotency-Key`.
--
-- The ADR's working names `email.connections.*` and `credentials.manage` are NOT
-- seeded here: a Mailketing account and its token are a `channel_accounts`
-- account and secret (ADR-0151 section 2), managed through the existing
-- `channel_accounts.accounts.*` / `.credentials.manage` permissions. Seeding a
-- parallel email copy would be a second gate on the same row.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('email', 'senders', 'read',
   'Read this tenant''s Mailketing email senders with queue, quota, verification and credit diagnostics, and the default-sender policy (never a credential)'),
  ('email', 'senders', 'use',
   'Send email as a tenant-owned Mailketing sender identity (explicit sender or business scope on an announcement)'),
  ('email', 'sender_policy', 'configure',
   'Set or clear the default email sender of a business scope; affects later messages only (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
