-- Issue ahliweb/omes#198 (ADR-0122) — link OMES operation requests to the
-- canonical workflow-approval engine.
--
-- Adds a nullable FK from `awcms_omes_operation_requests` to
-- `awcms_workflow_instances` so a destructive operation request (stop,
-- rollback — see src/modules/omes-control/domain/operations.ts) can record
-- WHICH workflow-approval instance is deciding it, without AWCMS inventing a
-- second, independent approval state machine for OMES (validated reuse
-- requirement on ahliweb/omes#198: "Its approved workflow outcome is the
-- single human-approval authority").
--
-- Additive only — no existing column is altered, no data is migrated, and
-- this never touches an already-applied migration file (154/155 are left
-- exactly as landed).

ALTER TABLE awcms_omes_operation_requests
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid
    REFERENCES awcms_workflow_instances (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS awcms_omes_op_req_workflow_instance_idx
  ON awcms_omes_operation_requests (workflow_instance_id)
  WHERE workflow_instance_id IS NOT NULL;
