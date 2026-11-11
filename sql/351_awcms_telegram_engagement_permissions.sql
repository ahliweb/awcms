-- telegram_engagement -- permission catalogue (Issue #1156, ADR-0152 section 2).
--
-- Its own namespace, separately grantable, and DISJOINT from `telegram_delivery`
-- (staff-only, ADR-0140): holding one grants nothing in the other. Every admin
-- route is default-deny behind one of these triples. The webhook route is the
-- only unauthenticated surface and needs none: it is authenticated by the
-- per-bot callback token and the constant-time secret-token header.
--
-- `bots.configure` is high-risk (it binds a tenant's bot token to a public
-- callback, rotates and revokes it): audited at warning, `Idempotency-Key`,
-- conditional step-up. `messages.create` sends free text to a customer and is
-- audited; it can never reach a person who did not start the bot.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('telegram_engagement', 'bots', 'read',
   'Read this tenant''s customer Telegram bots: webhook state, verified bot id and username, health and daily ceiling (never a token, a secret or a callback URL)'),
  ('telegram_engagement', 'bots', 'configure',
   'Register a customer Telegram bot (an existing channel account) for verified webhooks, rotate its webhook secret and revoke it (high-risk, step-up, audited at warning)'),
  ('telegram_engagement', 'contacts', 'read',
   'Read the contacts who started a customer bot, with a masked label, their state and their per-purpose eligibility (never a Telegram user id, chat id, username or message)'),
  ('telegram_engagement', 'contacts', 'delete',
   'End a contact at the data subject''s request or the controller''s decision: erases the encrypted chat id and the masked label, withdraws every purpose and cancels queued messages; consent evidence is kept for its proof window (high-risk, audited at warning)'),
  ('telegram_engagement', 'messages', 'create',
   'Queue a reply or an opted-in notice, or an explicit opt-in prompt, to a contact who started the bot and is eligible for the purpose (audited)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
