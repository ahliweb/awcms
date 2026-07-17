-- Workflow approval: quorum-bypass guard (GHSA-9qwq-cmr5-6wfc).
--
-- FINDING: a single person could satisfy a multi-person quorum alone.
-- `awcms_workflow_task_assignments` had only three NON-unique indexes
-- (sql/013:215-221) — nothing stopped the same `tenant_user_id` from holding
-- more than one live assignment on the same task. `workflow-escalation.ts`
-- INSERTed an escalation-target assignment unconditionally, so a user who was
-- BOTH an original assignee AND the node's `escalateToTenantUserId` ended up
-- with two 'pending' rows. Quorum was then evaluated with `COUNT(*)` over
-- assignment ROWS rather than `COUNT(DISTINCT tenant_user_id)` over PEOPLE
-- (`workflow-instance-decision.ts:205-211`), so that one user's two rows read
-- as two eligible approvers and their decisions cleared a quorum of 2.
-- `createApprovalTask` has the same exposure: `validateWorkflowGraph` never
-- rejected a node whose `assigneeTenantUserIds` repeats a user.
--
-- The unique index below is the durable, database-level invariant behind that
-- fix ("one live assignment per person per task"); the matching application
-- changes (`ON CONFLICT DO NOTHING` on both INSERT paths, and
-- `COUNT(DISTINCT tenant_user_id)`) land in the same change. The predicate
-- covers only the LIVE statuses: 'reassigned' and 'skipped' rows are the
-- append-only history that sql/013:191-197 deliberately keeps, and a user may
-- accumulate any number of those (e.g. assigned -> reassigned away -> assigned
-- again) without conflicting with their one live row.
--
-- RLS INTERACTION (why the dedup below toggles FORCE): the table is
-- `ENABLE`d + `FORCE`d (sql/013:224-225) with a tenant-isolation policy whose
-- USING clause reads `current_setting('app.current_tenant_id')`. `FORCE` makes
-- that policy apply to the table OWNER too, and the migration runner connects
-- as the owner (see sql/017's header) WITHOUT that GUC set — so the dedup DML
-- would abort with `unrecognized configuration parameter
-- "app.current_tenant_id"`. That failure only surfaces where rows actually
-- exist, i.e. it would pass on a fresh CI database and break on a populated
-- production one. This is a cross-tenant backfill, so there is no single
-- tenant id to SET; dropping FORCE for the duration is the honest way to say
-- "this statement is deliberately tenant-wide". The runner wraps each
-- migration in one transaction and `ALTER TABLE` takes ACCESS EXCLUSIVE, so no
-- concurrent session can observe the table while FORCE is off.

BEGIN;

ALTER TABLE awcms_workflow_task_assignments NO FORCE ROW LEVEL SECURITY;

-- Retire pre-existing duplicates so the unique index below can be created.
-- Keeps ONE live row per (task, user): a 'decided' row wins over a 'pending'
-- one (never erase the fact that someone decided), then the oldest row wins.
-- Losers become 'skipped' rather than being DELETEd — 'skipped' is already an
-- allowed status (sql/013:211-212), it falls outside the index predicate, and
-- retaining the row honours the table's append-only history convention.
UPDATE awcms_workflow_task_assignments a
SET status = 'skipped'
WHERE a.status IN ('pending', 'decided')
  AND EXISTS (
    SELECT 1
    FROM awcms_workflow_task_assignments keeper
    WHERE keeper.workflow_task_id = a.workflow_task_id
      AND keeper.tenant_user_id = a.tenant_user_id
      AND keeper.status IN ('pending', 'decided')
      AND (
        (keeper.status = 'decided' AND a.status = 'pending')
        OR (
          keeper.status = a.status
          AND (keeper.created_at, keeper.id) < (a.created_at, a.id)
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS awcms_workflow_task_assignments_live_decider_key
  ON awcms_workflow_task_assignments (workflow_task_id, tenant_user_id)
  WHERE status IN ('pending', 'decided');

ALTER TABLE awcms_workflow_task_assignments FORCE ROW LEVEL SECURITY;

COMMIT;
