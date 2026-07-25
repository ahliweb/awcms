-- form_drafts — generic server-side draft store for the reusable wizard
-- pattern. Ported from awcms-micro migration 019 (Issue #484) as the first
-- Gelombang-1 row of docs/awcms/absorb-awcms-micro-roadmap.md; table prefix
-- renamed `awcms_micro_form_drafts` -> `awcms_form_drafts` and the tenant FK
-- retargeted to `awcms_tenants`.
--
-- Domain-agnostic BY DESIGN: this table stores an opaque tenant-scoped JSONB
-- payload plus the wizard coordinates needed to resume it. What a draft's
-- payload MEANS is owned by whichever module created it (`module_key` /
-- `wizard_key`), never by this one — that is what lets a single table serve
-- every multi-step form without this module growing domain knowledge.
--
-- `resource_id` is `text`, not `uuid`: it matches
-- `awcms_workflow_instances.resource_id` and `awcms_audit_events.resource_id`
-- (both `text`) so a draft can reference a not-yet-created resource, or a
-- non-UUID external identifier, without a type mismatch against the tables it
-- sits beside.
--
-- No `restored_at`/`restored_by` (unlike the workflow tables): drafts are
-- ephemeral scratch state, not an audited resource where "restore" means
-- anything. `deleted_at`/`deleted_by`/`delete_reason` alone satisfy the
-- standard soft-delete convention.
--
-- The `module_key`/`wizard_key` CHECK patterns are mirrored by
-- `domain/form-draft-validation.ts`'s `KEY_FORMAT` — keep the two in sync; the
-- application-layer check exists to return a 422 with a useful field error
-- instead of letting a 23514 surface as a generic 500.
CREATE TABLE IF NOT EXISTS awcms_form_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  module_key text NOT NULL,
  wizard_key text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  current_step text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  submitted_by uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_form_drafts_status_check
    CHECK (status IN ('draft', 'submitted', 'abandoned', 'expired')),
  CONSTRAINT awcms_form_drafts_module_key_format_check
    CHECK (module_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT awcms_form_drafts_wizard_key_format_check
    CHECK (wizard_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

-- "My active drafts for this wizard" is the primary read path (resume-on-load).
CREATE INDEX IF NOT EXISTS awcms_form_drafts_tenant_wizard_idx
  ON awcms_form_drafts (tenant_id, module_key, wizard_key, status);

-- Drives `expireOverdueFormDrafts`' batch selection.
CREATE INDEX IF NOT EXISTS awcms_form_drafts_tenant_expiry_idx
  ON awcms_form_drafts (tenant_id, status, expires_at);

-- Drives `purgeExpiredFormDrafts`' retention-cutoff batch selection, which
-- orders by `updated_at` over the terminal statuses.
CREATE INDEX IF NOT EXISTS awcms_form_drafts_tenant_updated_idx
  ON awcms_form_drafts (tenant_id, status, updated_at);

-- The `data_lifecycle` dry-run planner counts by `tenant_id` alone; the
-- descriptor in `module.ts` points at this index for that path.
CREATE INDEX IF NOT EXISTS awcms_form_drafts_tenant_idx
  ON awcms_form_drafts (tenant_id);

-- ENABLE + FORCE, inline and unconditional. ENABLE alone is inert for the
-- table owner, which is exactly the role migrations run as — see
-- docs/awcms/09_roadmap_repository_commit.md and the audit that found
-- ENABLE-without-FORCE tables silently bypassing isolation.
ALTER TABLE awcms_form_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_form_drafts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_form_drafts_tenant_isolation
  ON awcms_form_drafts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- `awcms_app` needs no explicit GRANT: sql/019's `ALTER DEFAULT PRIVILEGES`
-- already covers every table created afterwards in this schema.
--
-- `awcms_worker` (sql/022) is NOT covered by those defaults and needs exactly
-- what `bun run form-drafts:purge` does and nothing more: SELECT to pick a
-- batch, UPDATE for step 1's `status -> 'expired'` transition, DELETE for
-- step 2's physical purge. No INSERT — the worker never creates a draft.
GRANT SELECT, UPDATE, DELETE ON awcms_form_drafts TO awcms_worker;
