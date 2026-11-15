-- `omes_control` automatic settlement of workflow verdicts (Issue
-- ahliweb/awcms#1335, ADR-0134 pattern) -- what the domain-event dispatcher
-- needs when it runs as `awcms_worker` (`WORKER_DATABASE_URL`), and not a
-- privilege more.
--
-- ## What this is for
--
-- `omes_control` now declares a domain-event consumer
-- (`omes_control.workflow_verdict_settler`) of the workflow instance verdicts
-- (`awcms.workflow.instance.approved` / `.rejected` / `.cancelled`). It moves an
-- operation request from `requested` to `approved` / `rejected` and an AI egress
-- approval from `pending` to `approved` / `denied`, so a human decision made
-- after submission is no longer lost. It never creates a job.
--
-- ## The grants, each with its reason (column level, nothing table-wide)
--
--   * `awcms_omes_operation_requests`: UPDATE (`status`, `approved_by`,
--     `updated_at`). SELECT and the row lock (`FOR UPDATE` needs an UPDATE
--     privilege on at least one column) come with it; table-level SELECT and
--     DELETE were granted by `sql/156`. The request itself (`operation`,
--     `parameters`, `server_id`, `requested_by`, `workflow_instance_id`) is not
--     writable by this role, and `sql/156`'s REVOKE of table-level INSERT and
--     UPDATE stays in force.
--   * `awcms_omes_ai_egress_approvals`: UPDATE (`decision`, `decided_at`,
--     `updated_at`), on top of the SELECT and DELETE of `sql/160`. The
--     classification, destination and justification are not writable; the
--     table's CHECK still forbids a RESTRICTED -> cloud_sanitized approval.
--   * `awcms_workflow_instances` (SELECT, `sql/022`), `awcms_workflow_tasks`
--     (SELECT, `sql/022`), `awcms_workflow_decisions` (SELECT on the who-decided
--     columns, `sql/280`, never `reason` / `override_reason`) and
--     `awcms_audit_events` (SELECT, INSERT) already cover the reads and the
--     audit row.
--
-- Table GRANTs and not a SECURITY DEFINER function, for the reason `sql/280`
-- gives: the settler can only apply the workflow's own verdict, and it reads
-- that verdict from the workflow's rows.
--
-- Column-level privileges are invisible to `has_table_privilege(..., 'UPDATE')`,
-- so `scripts/security-readiness.ts` `WORKER_COLUMN_GRANTS` pins these columns
-- and `WORKER_ROLE_GRANTS` is unchanged.
--
-- Idempotent: GRANTs are repeatable.

BEGIN;

GRANT UPDATE (status, approved_by, updated_at)
  ON awcms_omes_operation_requests TO awcms_worker;
GRANT UPDATE (decision, decided_at, updated_at)
  ON awcms_omes_ai_egress_approvals TO awcms_worker;

COMMIT;
