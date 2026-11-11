-- crm_follow_up -- permission catalogue (Issue #1165, ADR-0159 section 7).
--
-- Every permission below is ENFORCED by a route added in the same change (the
-- seed-gap trap in AGENTS.md):
--
--   crm_follow_up.rules.read          GET settings, rules, revisions; POST rules/simulate (read-only)
--   crm_follow_up.rules.configure     create a rule, publish a revision, archive, the tenant switch (high-risk)
--   crm_follow_up.tasks.read          GET tasks, a task with its actions and notifications, a lead's stop signals
--   crm_follow_up.tasks.update        complete or cancel a task
--   crm_follow_up.stop_signals.create record a staff stop signal for a lead (high-risk)
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('crm_follow_up', 'rules', 'read',
   'Read follow-up rules and their immutable revisions, the tenant switch, and simulate a draft revision without writing anything'),
  ('crm_follow_up', 'rules', 'configure',
   'Create a follow-up rule, publish a new immutable revision, archive a rule, and switch the module on or off for the tenant (high-risk, audited at warning)'),
  ('crm_follow_up', 'tasks', 'read',
   'Read the follow-up task queue, a task with its action history and staff notifications, and a lead''s stop signals'),
  ('crm_follow_up', 'tasks', 'update',
   'Complete a follow-up task with a closed outcome or cancel it (optimistic concurrency, audited)'),
  ('crm_follow_up', 'stop_signals', 'create',
   'Record a stop signal for a lead (reply received, consent withdrawn, sender blocked, manual): cancels its open tasks and pending notifications and blocks new ones (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
