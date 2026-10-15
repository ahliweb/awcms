-- Issue #999 (security audit finding F2 of #990) -- `awcms_workflow_decisions`
-- is append-only and a terminal `awcms_workflow_instances` row is final, in the
-- DATABASE, not only by convention.
--
-- ## Why
--
-- `sql/013` documented the decision log as "append-only / immutable" but
-- issued no REVOKE and no trigger, so any code running as `awcms_app` inside a
-- tenant (another module's bug, or an injection) could
-- `UPDATE awcms_workflow_decisions SET decided_by_tenant_user_id = ...` and
-- turn a self-approved settle into a clean one. The database-level separation
-- of duties that HR attendance corrections (#947, `sql/198`) and later payroll
-- approvals read from these two tables was therefore only as strong as every
-- other module's discipline. The audit proved it against the real schema.
--
-- ## What the workflow code legitimately does (and this keeps working)
--
-- A grep of `src/` finds exactly these writes, and each is allowed:
--   * INSERT into `awcms_workflow_decisions` (decide / force-decide);
--   * INSERT into `awcms_workflow_instances` (start);
--   * UPDATE `awcms_workflow_instances` pending -> approved|rejected (the graph
--     engine's `end` node) and pending -> cancelled (recovery), each guarded by
--     `AND status = 'pending'` in the statement itself.
-- Nothing UPDATEs or DELETEs a decision, and nothing DELETEs an instance.
--
-- ## Two independent layers (the pattern of sql/169, sql/174, sql/180, sql/198)
--
--   1. PRIVILEGE: `awcms_app` loses UPDATE/DELETE/TRUNCATE on the decision log
--      and DELETE/TRUNCATE on instances (it keeps INSERT and SELECT, plus
--      UPDATE on instances for the one legal `pending -> terminal` move).
--      `scripts/security-readiness.ts` declares the narrowed verbs, or
--      `checkRuntimeRoleGrants` fails closed.
--   2. TRIGGER: refuses the same changes for any role that DOES hold the
--      privilege (the table owner, a migration role, a future grant), so a
--      later GRANT cannot silently re-open the hole.
--
-- ## Instance rules enforced by the trigger
--
--   * DELETE is refused outright (an instance is cancelled, never removed; the
--     decision log and HR corrections reference it).
--   * A terminal instance (`approved`, `rejected`, `cancelled`) accepts NO
--     update at all -- not even a no-op -- so its verdict, its timestamps and
--     its cancel stamps are frozen.
--   * A pending instance may move to a terminal status, or stay pending, but
--     the facts snapshot, the requester, the resource binding and the pinned
--     definition version never change after creation (they are what separation
--     of duties and routing were decided against). The `pending -> pending`
--     case is kept legal because `due_at` / `updated_at` are not part of the
--     frozen set.
--   * It never moves back to `pending`.
--   * The cancel stamps (`cancelled_at`, `cancelled_by_tenant_user_id`,
--     `cancel_reason`) are set only together with `status = 'cancelled'`.
--
-- Maintenance that must bypass the guard (a tenant purge, a test teardown) runs
-- as a superuser with `SET LOCAL session_replication_role = replica`, the same
-- convention the HR and test suites already use; it is not reachable by the
-- runtime role.

CREATE OR REPLACE FUNCTION awcms_workflow_decisions_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'awcms_workflow: awcms_workflow_decisions is append-only; % is not allowed',
    TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER awcms_workflow_decisions_append_only
  BEFORE UPDATE OR DELETE ON awcms_workflow_decisions
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_decisions_reject_mutation();

CREATE OR REPLACE FUNCTION awcms_workflow_instances_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'awcms_workflow: awcms_workflow_instances rows are never deleted (cancel instead)'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_INSTANCE_TERMINAL: a % instance is final and cannot be updated',
      OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF (NEW.id, NEW.tenant_id, NEW.workflow_definition_id,
      NEW.workflow_definition_version, NEW.resource_type, NEW.resource_id,
      NEW.requested_by_tenant_user_id, NEW.facts, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.workflow_definition_id,
      OLD.workflow_definition_version, OLD.resource_type, OLD.resource_id,
      OLD.requested_by_tenant_user_id, OLD.facts, OLD.created_at) THEN
    RAISE EXCEPTION
      'awcms_workflow: a workflow instance''s identity, requester, resource and facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  -- Cancel stamps only ever accompany a cancellation: on a pending row they
  -- are NULL unless this very UPDATE moves it to `cancelled`.
  IF NEW.status IS DISTINCT FROM 'cancelled'
     AND (NEW.cancelled_at IS NOT NULL
          OR NEW.cancelled_by_tenant_user_id IS NOT NULL
          OR NEW.cancel_reason IS NOT NULL) THEN
    RAISE EXCEPTION
      'awcms_workflow: cancel stamps may only be set together with status cancelled'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_workflow_instances_guard
  BEFORE UPDATE OR DELETE ON awcms_workflow_instances
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_instances_guard();

-- Tasks. Separation of duties finds the decisions of an instance THROUGH
-- `awcms_workflow_tasks.workflow_instance_id` (HR attendance corrections,
-- `sql/198`), so a task that could be re-pointed to another instance would
-- hide a self-approval just as well as rewriting the decision. The task's
-- identity is therefore frozen, and a task that reached a final status
-- (`completed`, `skipped`, `cancelled`) accepts no further UPDATE. The only
-- legitimate task writes (grep of `src/`) are: status pending -> completed
-- (decision), pending -> cancelled + cancelled_at (recovery), and
-- escalation_step / escalated_at / due_at (escalation), all on pending rows.
CREATE OR REPLACE FUNCTION awcms_workflow_tasks_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'skipped', 'cancelled') THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_TASK_FINAL: a % task is final and cannot be updated',
      OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF (NEW.id, NEW.tenant_id, NEW.workflow_instance_id, NEW.node_id,
      NEW.parent_node_id, NEW.quorum_rule, NEW.quorum_threshold, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.workflow_instance_id, OLD.node_id,
      OLD.parent_node_id, OLD.quorum_rule, OLD.quorum_threshold, OLD.created_at) THEN
    RAISE EXCEPTION
      'awcms_workflow: a workflow task''s instance, node and quorum are immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_workflow_tasks_guard
  BEFORE UPDATE ON awcms_workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_tasks_guard();

-- TRUNCATE is covered by the REVOKE only, NOT by a trigger (sql/169): the
-- integration harness and operator reset tooling legitimately run
-- `TRUNCATE <every awcms_ table> CASCADE` as a privileged role, and a trigger
-- refusing it would break every suite for a protection the REVOKE already gives
-- the only role that serves requests. A privileged TRUNCATE is an operator act,
-- not a request-path one.
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_workflow_decisions FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_workflow_instances FROM awcms_app;
