-- social_publishing -- permission catalogue (Issue #1145, ADR-0157 section 5).
--
-- Every permission here is enforced by a route added in the same change (the
-- seed-gap trap in AGENTS.md: a permission nothing grants denies even `owner`,
-- and one nothing enforces is a promise the product does not keep).
--
--   publications.read       read publications, their per-account jobs and the
--                           derived status (never a credential)
--   publications.publish    create a publication for chosen accounts (HIGH-RISK
--                           `publish`: it puts words under the tenant's name on a
--                           public platform)
--   publications.schedule   change when a not-yet-dispatched publication goes out
--                           (HIGH-RISK `schedule`)
--   publications.approve    approve a publication that is waiting (HIGH-RISK
--                           `approve`); never the publication's own creator
--   publications.cancel     cancel a publication that has not been published
--                           (HIGH-RISK `cancel`)
--   jobs.retry              retry ONE failed per-account job
--   rules.read              read the publish rules and the tenant settings
--   rules.configure         add, enable or disable a rule (HIGH-RISK `configure`)
--   settings.configure      switch auto-publishing and the approval requirement
--                           (HIGH-RISK `configure`)
--
-- Using an account is additionally gated by channel_accounts' per-account access
-- (assignment rule and business scope), not by a permission here.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('social_publishing', 'publications', 'read',
   'Read this tenant''s social publications, their per-account jobs and derived status (never a credential)'),
  ('social_publishing', 'publications', 'publish',
   'Create a social publication for chosen connected accounts, now or at a scheduled time (high-risk, audited at warning)'),
  ('social_publishing', 'publications', 'schedule',
   'Change when a social publication that has not been dispatched goes out (high-risk, audited)'),
  ('social_publishing', 'publications', 'approve',
   'Approve a social publication that is waiting for approval; the creator cannot approve their own (high-risk, audited at warning)'),
  ('social_publishing', 'publications', 'cancel',
   'Cancel a social publication; jobs already published are untouched (high-risk, audited)'),
  ('social_publishing', 'jobs', 'retry',
   'Retry one failed per-account social publish job; a published job can never be retried (audited)'),
  ('social_publishing', 'rules', 'read',
   'Read the social publish rules and this tenant''s social publishing settings'),
  ('social_publishing', 'rules', 'configure',
   'Add, enable or disable the rule that publishes an article event to a connected account (high-risk, audited at warning)'),
  ('social_publishing', 'settings', 'configure',
   'Switch automatic publishing and the approval requirement for this tenant (high-risk, audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
