-- omnichannel_inbox -- permission catalogue (Issue #1164, ADR-0160 section 3).
--
-- Its own namespace, separately grantable, default-deny on every route. Holding
-- an inbox permission grants nothing in `channel_accounts`, `telegram_engagement`
-- or `website_engagement`, and the inbox SENDS NOTHING: a reply goes through the
-- arrival channel's own permission, queue and consent checks.
--
-- `conversations.assign` and `projection.configure` are high-risk (who is
-- answerable for a customer; replaying the event log into the projection):
-- `Idempotency-Key`, audited. `sla_policies.configure` and `tags.configure`
-- are audited configuration.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omnichannel_inbox', 'conversations', 'read',
   'Read inbox conversations within the business scopes the caller covers: source kind, opaque references, status, assignee, tags, SLA state and the activity history (never a message body or a customer identifier)'),
  ('omnichannel_inbox', 'conversations', 'update',
   'Change a conversation''s status, its tags, and record that a response was sent through the arrival channel; also what makes a person eligible to be an assignee'),
  ('omnichannel_inbox', 'conversations', 'assign',
   'Assign a conversation to an eligible staff member or unassign it (high-risk, Idempotency-Key, audited)'),
  ('omnichannel_inbox', 'tags', 'configure',
   'Create and delete the tenant''s inbox tags (audited)'),
  ('omnichannel_inbox', 'sla_policies', 'read',
   'Read the tenant''s inbox SLA policies (budgets, timezone, working hours, holidays)'),
  ('omnichannel_inbox', 'sla_policies', 'configure',
   'Create and retire inbox SLA policies per tenant or business scope (audited at warning, Idempotency-Key)'),
  ('omnichannel_inbox', 'projection', 'configure',
   'Rebuild the conversation projection by replaying the verified inbound events still inside the retention window; staff work state is never touched (high-risk, Idempotency-Key, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
