-- Permission catalog seed for the `email` Mailketing webhook surface (Issue
-- #1161, ADR-0151 section 6: "new permissions seeded by migration in the same
-- change as their route"). Every permission here is enforced by a route added
-- in the same change.
--
--   webhook.read              GET /api/v1/email/webhook-callbacks (the callback
--                             credentials of this tenant's Mailketing accounts:
--                             id, account, status, last event; never the token)
--                             and GET /api/v1/email/provider-events (the
--                             quarantine of provider-reported, unauthenticated
--                             events, recipients masked, with the
--                             provider-reported projection of one message).
--   webhook.configure         POST /api/v1/email/webhook-callbacks (issue or
--                             ROTATE the callback URL of one Mailketing account:
--                             the token is shown once, only its hash is kept)
--                             and POST /api/v1/email/webhook-callbacks/{id}/revoke.
--                             HIGH-RISK (`configure`): it decides which URL may
--                             feed the quarantine, so it needs an
--                             `Idempotency-Key` and is audited at `warning`. Also
--                             subject to the `channel_accounts` access rules on
--                             that account.
--   provider_events.approve   POST /api/v1/email/provider-events/{id}/review:
--                             confirm a quarantined bounce or unsubscribe into
--                             the suppression list (source `provider_report`),
--                             or dismiss it. The ONLY path by which a provider
--                             report changes anything, and a human decision:
--                             HIGH-RISK (`approve`), idempotent, audited at
--                             `warning`. The ADR's working name was
--                             `email.webhook.review`; `review` is not an access
--                             action and `approve` already carries the
--                             high-risk classification this decision needs.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('email', 'webhook', 'read',
   'Read Mailketing webhook callback credentials (never the token) and the quarantine of provider-reported, unauthenticated delivery events (recipients masked)'),
  ('email', 'webhook', 'configure',
   'Issue, rotate or revoke the webhook callback URL of a Mailketing account (high-risk, audited at warning)'),
  ('email', 'provider_events', 'approve',
   'Confirm a quarantined bounce or unsubscribe into the suppression list, or dismiss it (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
