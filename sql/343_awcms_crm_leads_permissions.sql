-- crm_leads -- permission catalogue (Issue #1166, ADR-0153 section 7).
--
-- Every permission below is ENFORCED by a route added in the same change (the
-- seed-gap trap in AGENTS.md). `AccessAction` is a closed vocabulary shared by
-- every module, so ADR-0153's working names map onto it through the activity
-- code:
--
--   ADR-0153 working name   seeded as
--   ---------------------   ------------------------------------------
--   leads.read              crm_leads.leads.read
--   leads.create            crm_leads.leads.create
--   leads.update            crm_leads.leads.update
--   leads.assign            crm_leads.leads.assign        (high-risk)
--   leads.delete (soft)     crm_leads.leads.delete        (high-risk; soft delete and anonymising erasure)
--   (restore)               crm_leads.leads.restore       (high-risk)
--   leads.move              crm_leads.stages.update
--   leads.merge             crm_leads.merges.manage       (high-risk; merge and its rollback)
--   pipeline.configure      crm_leads.pipelines.configure (high-risk; also the tenant switch)
--   conversion.confirm      crm_leads.conversions.approve (high-risk; authority confirmation and reversal)
--   conversion.manual       crm_leads.manual_conversions.create
--
-- NOT seeded, because nothing enforces them yet (ADR-0153 working names whose
-- surface is deferred, see src/modules/crm-leads/README.md): leads.export and
-- milestones.configure. A permission that no route checks is a grant that
-- means nothing; it is added with its route.
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('crm_leads', 'leads', 'read',
   'Read leads with MASKED contact points, their stage, source touches, transition history, assignments, merges and conversions, the pipelines and the tenant switch'),
  ('crm_leads', 'leads', 'create',
   'Create a lead through the manual, import or API intake path (idempotent on the source key)'),
  ('crm_leads', 'leads', 'update',
   'Change a lead''s display name, add a contact point or a later source touch (optimistic concurrency)'),
  ('crm_leads', 'leads', 'assign',
   'Assign or unassign the owner of a lead (high-risk, audited at warning)'),
  ('crm_leads', 'leads', 'delete',
   'Soft-delete a lead, or anonymise it on a data subject''s erasure request; funnel counts are kept (high-risk, audited at warning)'),
  ('crm_leads', 'leads', 'restore',
   'Restore a soft-deleted lead (high-risk, audited at warning)'),
  ('crm_leads', 'stages', 'update',
   'Move a lead along an allowed edge of its pipeline; the edge guard is re-checked in the transaction (audited)'),
  ('crm_leads', 'merges', 'manage',
   'Merge two leads of the same pipeline after human review, and roll a merge back within the undo window (high-risk, audited at warning)'),
  ('crm_leads', 'pipelines', 'configure',
   'Create a pipeline, publish a new immutable revision of its stage catalog (moving leads out of removed stages explicitly), and switch the module on or off for the tenant (high-risk, audited at warning)'),
  ('crm_leads', 'conversions', 'approve',
   'Record a conversion confirmed by the customer authority with its opaque customer reference, and record its reversal (high-risk, audited at warning)'),
  ('crm_leads', 'manual_conversions', 'create',
   'Record a MANUAL conversion with no confirming authority; stored as authority_unconfirmed and reported separately (audited at warning)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
