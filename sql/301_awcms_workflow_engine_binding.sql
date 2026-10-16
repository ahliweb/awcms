-- Issue #1032 (follow-up to #999 / ADR-0144, security audit findings H2 + M1) --
-- bind workflow instance verdicts and decision inserts to what the engine
-- records, in the DATABASE.
--
-- ## Why
--
-- `sql/252` froze history (decisions append-only, terminal rows final) but not
-- ADDITIONS. `awcms_app` could still
--   * `UPDATE awcms_workflow_instances SET status = 'approved' WHERE ...` with no
--     decision behind it (procurement trusts that status alone), and
--   * `INSERT INTO awcms_workflow_decisions` naming any `decided_by` /
--     `on_behalf_of`, against any task, even after the instance finished.
--
-- ## What this enforces (triggers and one privilege revoke; no app-visible change
-- ## except the engine now cancels the pending siblings of a rejected instance)
--
-- ### Decision INSERT -- awcms_workflow_decisions_guard
--   * the task belongs to the same tenant, the task is `pending` and so is its
--     instance (nothing is appended after the end);
--   * an override decision (`force_approve`/`force_reject`) carries
--     `is_administrative_override = true` and an `override_reason`, and an
--     ordinary one does not; an override names no `on_behalf_of`, is made by an
--     ACTIVE user of the same tenant, and never by the requester. The
--     permission to force a decision is NOT checked here: it lives in the
--     RBAC/ABAC engine (roles, policies, delegated access, SoD) that the route
--     runs, and a SQL copy would be a second engine (ADR-0144);
--   * an ordinary decision's `decided_by` holds a PENDING assignment on the
--     task, or `on_behalf_of` names the holder of a pending assignment and has
--     an ACTIVE, in-scope delegation to `decided_by` (the rule of
--     `findEligibleAssignment`);
--   * one ordinary decision per SEAT (`coalesce(on_behalf_of, decided_by)`),
--     by a partial unique index, so one approver cannot satisfy an `all` rule.
--
-- ### Task -- awcms_workflow_tasks_guard
--   * only ever INSERTed `pending`;
--   * `pending -> completed` only once the recorded decisions satisfy the quorum
--     (the SQL twin of `evaluateQuorumOutcome`, counting DISTINCT seats);
--   * `pending -> cancelled` only once the instance is no longer pending (the
--     engine cancels instance first, then its tasks; and, since this migration,
--     the pending siblings of an instance that a rejection just finished);
--     `skipped` is never written by the engine and is refused. A pending task
--     therefore cannot be removed from under a pending instance to make a
--     verdict look complete.
--   * `DELETE`/`TRUNCATE` on tasks, assignments and join arrivals are revoked
--     from `awcms_app` (the engine never deletes them).
--
-- ### Instance -- awcms_workflow_instances_guard
--   * only ever INSERTed `pending` with no cancel stamps;
--   * `pending -> approved|rejected` requires the verdict to be JUSTIFIED by a
--     SIMULATION of the pinned graph (awcms_workflow_instance_verdict_justified)
--     that mirrors the engine: it starts at the start node, evaluates each
--     `condition` against the instance's frozen facts (the SQL twin of
--     `evaluateCondition`), crosses an `approval` node only through a COMPLETED
--     task whose recorded decisions pick the edge, fans out at `parallel`, and
--     passes a `join` only once every awaited branch arrived. The verdict must
--     be the outcome of an `end` node the simulation reaches. `approved` also
--     needs no pending task and no reachable rejected end; `rejected` may leave
--     pending sibling tasks (the engine cancels them right after).
--   * a `condition` that names a registered resolver (`resolverName`) cannot be
--     re-run in SQL: a path through one only counts once a completed approval
--     follows it. A graph that auto-finishes THROUGH a resolver therefore
--     cannot finish at all; that is deliberate (fail closed).
--
-- ### Definition -- awcms_workflow_definitions_guard
--   * once a definition leaves `draft`, its `graph` and `facts_schema` are
--     frozen and its lifecycle only moves forward (draft -> active -> retired).
--     The verdict simulation reads the pinned definition row, so that row must
--     not be rewritable;
--   * EVERY role except the table owner and superusers (a login created
--     `IN ROLE awcms_app` included: an allowlist of exemptions, not a name test)
--     can only INSERT a `draft`, and can only INSERT an instance against the
--     `active`, live definition whose `version` it pins. Retiring a definition
--     later does not touch instances already started. THIS IS NOT A BARRIER to
--     authoring a workflow: such a caller can still publish any graph through
--     `draft -> active` and start an instance on it (residual below);
--   * publishing (the TypeScript validator, not SQL) refuses a `parallel`
--     branch that can reach an `approved` end without passing its join.
--
-- ### Seats -- awcms_workflow_task_assignments_guard / _insert_guard
--   * INSERT: `pending`, on a PENDING task of its own tenant (composite FK
--     `(workflow_task_id, tenant_id)`), for an ACTIVE user of that tenant who is
--     not the instance requester. Owner and superuser are exempt; a role that
--     cannot read `awcms_tenant_users` (the escalation worker) skips only the
--     active-user check;
--   * a seat is final once it leaves `pending`; its task, user and tenant never
--     change; `pending -> decided` only when a decision for that seat exists on
--     the task; `pending -> reassigned` only with the user it moved to, and (a
--     DEFERRED constraint trigger, because the engine inserts the replacement
--     after the UPDATE) only if that user holds a PENDING seat on the same task
--     and tenant by commit; `skipped` is never written and is refused;
--   * `DELETE`/`TRUNCATE` on tasks, seats and join arrivals: revoked from
--     `awcms_app`, and refused by a trigger for any role except the table owner
--     and superusers, so a future blanket re-grant cannot restore them.
--
-- ### Hardening
--   * every function below pins `search_path = pg_catalog, public, pg_temp` and
--     schema-qualifies the tables it reads (sql/048, sql/184 convention):
--     `awcms_app` holds TEMP, and a `CREATE TEMP TABLE awcms_workflow_decisions`
--     would otherwise shadow the real table inside a guard.
--
-- ## What this does NOT prove (stated, not hidden)
--   * DECISIONS ARE CONSISTENT WITH SEATS, NOT AUTHORIZED. The triggers bind
--     rows to each other, not a row to a person, and not to a permission.
--     `decided_by` / `on_behalf_of` are CONSISTENT with a seat and a
--     delegation; they are not proof that the named person acted. `awcms_app`
--     can still seat any active non-requester user on a pending task, and a
--     reassignment to an already-seated user shrinks the `all` quorum exactly as
--     the administrative reassignment the route permits does. The permission to
--     force a decision (`workflow.recovery.force_decide`) is not checked here:
--     an override proves an active, non-requester tenant user made it. The real
--     controls are the route's RBAC/ABAC and binding consumers to engine-created
--     instances.
--   * A RUNTIME CALLER CAN AUTHOR ITS OWN WORKFLOW: publish any graph through
--     `draft -> active`, start an instance on it and drive it to a verdict with
--     no meaningful decisions. Only binding consumers to an instance the engine
--     created from an administrator-published definition protects (procurement
--     does since #1045; a consumer matching by resource alone is exposed).
--   * Resolver conditions are not re-run (see above).
--   * Nested `parallel`/`join` never pass, in the engine and in this simulation
--     alike (pre-existing; the simulation mirrors it).
--   * Delegation lets one person fill two seats of the same task (their own and
--     the delegator's), as the engine allows.
--
-- Maintenance that must bypass (tenant purge, fixtures) runs as a superuser with
-- `SET LOCAL session_replication_role = replica` (the sql/252 convention).

-- ---------------------------------------------------------------------------
-- One ordinary decision per seat.
-- ---------------------------------------------------------------------------
-- The engine can never have written two (a seat decides once), so existing data
-- should be clean. If it is not, say so by name instead of failing with a bare
-- unique violation, and delete NOTHING: an operator must look at those rows.
DO $$
DECLARE
  v_report text;
BEGIN
  SELECT string_agg(
           format('task %s seat %s x%s', workflow_task_id, seat, n), '; ')
    INTO v_report
    FROM (
      SELECT workflow_task_id,
             coalesce(on_behalf_of_tenant_user_id, decided_by_tenant_user_id) AS seat,
             count(*) AS n
      FROM public.awcms_workflow_decisions
      WHERE NOT is_administrative_override
      GROUP BY 1, 2
      HAVING count(*) > 1
      LIMIT 20
    ) d;

  IF v_report IS NOT NULL THEN
    RAISE EXCEPTION
      'sql/301 cannot add awcms_workflow_decisions_one_per_seat: duplicate ordinary decisions exist for the same seat (first 20): %. Review them (they are forged or corrupt, the engine never writes two); no data was changed.',
      v_report;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_workflow_decisions_one_per_seat
  ON awcms_workflow_decisions
    (workflow_task_id, (coalesce(on_behalf_of_tenant_user_id, decided_by_tenant_user_id)))
  WHERE NOT is_administrative_override;

-- ---------------------------------------------------------------------------
-- Pure graph / quorum helpers.
-- ---------------------------------------------------------------------------

-- Is the current role exempt from the INSERT-side rules and the DELETE backstop?
-- Only the table OWNER and superusers are (migrations, purge tooling, fixtures
-- seed data directly). EVERYONE else is restricted, including a login created
-- `IN ROLE awcms_app`: an allowlist of exemptions, not a name test on the
-- runtime role. `current_user` is the invoker here (these functions are not
-- SECURITY DEFINER).
CREATE OR REPLACE FUNCTION awcms_workflow_role_is_exempt(p_rel oid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname = current_user
      AND (r.rolsuper
           OR r.oid = (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = p_rel)))
$$;

-- The SQL twin of `evaluateCondition` (workflow-condition.ts). NULL means "not
-- evaluable here" (a registered resolver); everything else is true/false.
CREATE OR REPLACE FUNCTION awcms_workflow_eval_condition(node jsonb, facts jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_fact jsonb;
  v_val jsonb;
  v_op text;
BEGIN
  IF node ->> 'resolverName' IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_fact := facts -> (node ->> 'factKey');

  IF v_fact IS NULL THEN
    RETURN false;
  END IF;

  v_val := node -> 'value';
  v_op := node ->> 'operator';

  IF v_op = 'eq' THEN
    RETURN coalesce(v_fact = v_val, false);
  ELSIF v_op = 'neq' THEN
    RETURN v_fact IS DISTINCT FROM v_val;
  ELSIF v_op IN ('gt', 'gte', 'lt', 'lte') THEN
    IF jsonb_typeof(v_fact) <> 'number' OR coalesce(jsonb_typeof(v_val), '') <> 'number' THEN
      RETURN false;
    END IF;

    RETURN CASE v_op
      WHEN 'gt' THEN (v_fact #>> '{}')::numeric > (v_val #>> '{}')::numeric
      WHEN 'gte' THEN (v_fact #>> '{}')::numeric >= (v_val #>> '{}')::numeric
      WHEN 'lt' THEN (v_fact #>> '{}')::numeric < (v_val #>> '{}')::numeric
      ELSE (v_fact #>> '{}')::numeric <= (v_val #>> '{}')::numeric
    END;
  ELSIF v_op = 'in' THEN
    RETURN coalesce(jsonb_typeof(v_val), '') = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_val) e WHERE e = v_fact);
  END IF;

  RETURN false;
END;
$$;

-- The outcome a task's recorded decisions give it (the SQL twin of
-- `evaluateQuorumOutcome`), or NULL while the quorum is not met. Approvals are
-- counted per DISTINCT seat, so duplicate rows from one approver count once.
CREATE OR REPLACE FUNCTION awcms_workflow_task_quorum_outcome(
  p_task_id uuid,
  p_quorum_rule text,
  p_quorum_threshold integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_rejected boolean;
  v_forced boolean;
  v_approvals integer;
  v_eligible integer;
BEGIN
  SELECT bool_or(decision IN ('reject', 'force_reject')),
         bool_or(decision = 'force_approve'),
         count(DISTINCT coalesce(on_behalf_of_tenant_user_id, decided_by_tenant_user_id))
           FILTER (WHERE decision = 'approve')
    INTO v_rejected, v_forced, v_approvals
    FROM public.awcms_workflow_decisions
    WHERE workflow_task_id = p_task_id;

  IF coalesce(v_rejected, false) THEN
    RETURN 'rejected';
  END IF;

  IF coalesce(v_forced, false) THEN
    RETURN 'approved';
  END IF;

  IF coalesce(v_approvals, 0) = 0 THEN
    RETURN NULL;
  END IF;

  IF p_quorum_rule = 'any' THEN
    RETURN 'approved';
  END IF;

  SELECT count(DISTINCT tenant_user_id) INTO v_eligible
    FROM public.awcms_workflow_task_assignments
    WHERE workflow_task_id = p_task_id AND status IN ('pending', 'decided');

  IF p_quorum_rule = 'all' THEN
    IF v_approvals >= v_eligible THEN
      RETURN 'approved';
    END IF;
    RETURN NULL;
  END IF;

  IF v_approvals >= coalesce(p_quorum_threshold, v_eligible) THEN
    RETURN 'approved';
  END IF;

  RETURN NULL;
END;
$$;

-- Is a `pending -> p_status` move of `p_instance_id` backed by what the engine
-- recorded? A simulation of the pinned graph; see the header for the rules.
CREATE OR REPLACE FUNCTION awcms_workflow_instance_verdict_justified(
  p_instance_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  sep constant text := chr(31);
  v_graph jsonb;
  v_facts jsonb;
  v_queue text[];
  v_visited text[] := ARRAY[]::text[];
  v_arrivals text[] := ARRAY[]::text[];
  v_tainted_joins text[] := ARRAY[]::text[];
  v_entry text;
  v_parts text[];
  v_node_id text;
  v_branch text;
  v_unv text;
  v_node jsonb;
  v_type text;
  v_cond boolean;
  v_outcome text;
  v_next text;
  v_branch_id text;
  v_prefix text;
  v_arrived integer;
  v_iterations integer := 0;
  v_approved_end boolean := false;
  v_rejected_end boolean := false;
BEGIN
  SELECT d.graph, i.facts INTO v_graph, v_facts
    FROM public.awcms_workflow_instances i
    JOIN public.awcms_workflow_definitions d ON d.id = i.workflow_definition_id
    WHERE i.id = p_instance_id;

  IF v_graph IS NULL OR p_status NOT IN ('approved', 'rejected') THEN
    RETURN false;
  END IF;

  -- An approval needs every task done; a rejection may leave siblings pending.
  IF p_status = 'approved' AND EXISTS (
       SELECT 1 FROM public.awcms_workflow_tasks
       WHERE workflow_instance_id = p_instance_id AND status = 'pending') THEN
    RETURN false;
  END IF;

  v_queue := ARRAY[(v_graph ->> 'startNodeId') || sep || '' || sep || 'f'];

  WHILE coalesce(array_length(v_queue, 1), 0) > 0 LOOP
    v_iterations := v_iterations + 1;
    EXIT WHEN v_iterations > 2000;

    v_entry := v_queue[1];
    v_queue := v_queue[2:array_length(v_queue, 1)];

    CONTINUE WHEN v_entry = ANY (v_visited);
    v_visited := v_visited || v_entry;

    v_parts := string_to_array(v_entry, sep);
    v_node_id := v_parts[1];
    v_branch := coalesce(v_parts[2], '');
    v_unv := v_parts[3];

    SELECT n INTO v_node
      FROM jsonb_array_elements(v_graph -> 'nodes') n
      WHERE n ->> 'id' = v_node_id
      LIMIT 1;

    CONTINUE WHEN v_node IS NULL;
    v_type := v_node ->> 'type';

    IF v_type = 'end' THEN
      IF v_unv = 'f' THEN
        IF v_node ->> 'outcome' = 'approved' THEN
          v_approved_end := true;
        ELSIF v_node ->> 'outcome' = 'rejected' THEN
          v_rejected_end := true;
        END IF;
      END IF;
    ELSIF v_type = 'approval' THEN
      -- Crossed only through a completed task whose decisions pick the edge.
      SELECT awcms_workflow_task_quorum_outcome(t.id, t.quorum_rule, t.quorum_threshold)
        INTO v_outcome
        FROM public.awcms_workflow_tasks t
        WHERE t.workflow_instance_id = p_instance_id
          AND t.node_id = v_node_id
          AND t.parent_node_id IS NOT DISTINCT FROM nullif(v_branch, '')
          AND t.status = 'completed'
        ORDER BY t.created_at
        LIMIT 1;

      IF v_outcome = 'approved' THEN
        v_next := v_node ->> 'onApprove';
      ELSIF v_outcome = 'rejected' THEN
        v_next := v_node ->> 'onReject';
      ELSE
        v_next := NULL;
      END IF;

      IF v_next IS NOT NULL THEN
        v_queue := v_queue || (v_next || sep || v_branch || sep || 'f');
      END IF;
    ELSIF v_type = 'condition' THEN
      v_cond := awcms_workflow_eval_condition(v_node, v_facts);

      IF v_cond IS NULL THEN
        v_queue := v_queue || ((v_node ->> 'onTrue') || sep || v_branch || sep || 't');
        v_queue := v_queue || ((v_node ->> 'onFalse') || sep || v_branch || sep || 't');
      ELSIF v_cond THEN
        v_queue := v_queue || ((v_node ->> 'onTrue') || sep || v_branch || sep || v_unv);
      ELSE
        v_queue := v_queue || ((v_node ->> 'onFalse') || sep || v_branch || sep || v_unv);
      END IF;
    ELSIF v_type = 'parallel' THEN
      FOR v_branch_id IN SELECT jsonb_array_elements_text(v_node -> 'branchNodeIds') LOOP
        v_queue := v_queue || (v_branch_id || sep || v_branch_id || sep || v_unv);
      END LOOP;
    ELSIF v_type = 'notify' THEN
      v_queue := v_queue || ((v_node ->> 'next') || sep || v_branch || sep || v_unv);
    ELSIF v_type = 'join' THEN
      IF v_branch <> '' THEN
        v_arrivals := v_arrivals || (v_node_id || sep || v_branch);
      END IF;

      IF v_unv = 't' THEN
        v_tainted_joins := v_tainted_joins || v_node_id;
      END IF;

      v_prefix := v_node_id || sep;
      SELECT count(DISTINCT a) INTO v_arrived
        FROM unnest(v_arrivals) a
        WHERE left(a, length(v_prefix)) = v_prefix;

      IF v_arrived >= jsonb_array_length(v_node -> 'awaitNodeIds') THEN
        v_queue := v_queue || ((v_node ->> 'next') || sep || '' || sep ||
          CASE WHEN v_node_id = ANY (v_tainted_joins) THEN 't' ELSE 'f' END);
      END IF;
    END IF;
  END LOOP;

  IF p_status = 'approved' THEN
    RETURN v_approved_end AND NOT v_rejected_end;
  END IF;

  RETURN v_rejected_end;
END;
$$;

-- ---------------------------------------------------------------------------
-- Decision INSERT binding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_decisions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_task_tenant uuid;
  v_task_status text;
  v_instance_status text;
  v_resource_type text;
  v_workflow_key text;
  v_requested_by uuid;
BEGIN
  SELECT t.tenant_id, t.status, i.status, i.resource_type, d.workflow_key,
         i.requested_by_tenant_user_id
    INTO v_task_tenant, v_task_status, v_instance_status, v_resource_type, v_workflow_key,
         v_requested_by
    FROM public.awcms_workflow_tasks t
    JOIN public.awcms_workflow_instances i ON i.id = t.workflow_instance_id
    JOIN public.awcms_workflow_definitions d ON d.id = i.workflow_definition_id
    WHERE t.id = NEW.workflow_task_id;

  IF NOT FOUND OR v_task_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DECISION_TASK_MISMATCH: the decision''s task does not exist in its tenant'
      USING ERRCODE = '55000';
  END IF;

  IF v_task_status <> 'pending' OR v_instance_status <> 'pending' THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DECISION_NOT_OPEN: a decision can only be recorded on a pending task of a pending instance'
      USING ERRCODE = '55000';
  END IF;

  IF (NEW.decision IN ('force_approve', 'force_reject'))
     IS DISTINCT FROM NEW.is_administrative_override THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DECISION_OVERRIDE_MISMATCH: force decisions, and only they, are administrative overrides'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.is_administrative_override THEN
    IF NEW.on_behalf_of_tenant_user_id IS NOT NULL
       OR coalesce(btrim(NEW.override_reason), '') = '' THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_DECISION_OVERRIDE_INVALID: an override needs a reason and names no principal'
        USING ERRCODE = '55000';
    END IF;

    -- The override needs no seat, so bind it to a real person instead: an
    -- ACTIVE user of this tenant, who is not the requester. The permission to
    -- force a decision is NOT re-checked here (it lives in the RBAC/ABAC engine
    -- the route runs; see ADR-0144).
    IF NOT EXISTS (
         SELECT 1 FROM public.awcms_tenant_users u
         WHERE u.id = NEW.decided_by_tenant_user_id
           AND u.tenant_id = NEW.tenant_id AND u.status = 'active') THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_DECISION_OVERRIDE_PRINCIPAL: an override must be made by an active user of the tenant'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.decided_by_tenant_user_id = v_requested_by THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_DECISION_OVERRIDE_SELF: the requester cannot force a decision on their own request'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.on_behalf_of_tenant_user_id IS NOT DISTINCT FROM NEW.decided_by_tenant_user_id THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DECISION_FORGED: on_behalf_of must differ from decided_by'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.awcms_workflow_task_assignments a
    WHERE a.workflow_task_id = NEW.workflow_task_id
      AND a.tenant_id = NEW.tenant_id
      AND a.status = 'pending'
      AND (
        (NEW.on_behalf_of_tenant_user_id IS NULL
         AND a.tenant_user_id = NEW.decided_by_tenant_user_id)
        OR
        (NEW.on_behalf_of_tenant_user_id IS NOT NULL
         AND a.tenant_user_id = NEW.on_behalf_of_tenant_user_id
         AND EXISTS (
           SELECT 1
           FROM public.awcms_workflow_delegations g
           WHERE g.tenant_id = NEW.tenant_id
             AND g.status = 'active'
             AND g.delegator_tenant_user_id = NEW.on_behalf_of_tenant_user_id
             AND g.delegate_tenant_user_id = NEW.decided_by_tenant_user_id
             AND g.effective_from <= now()
             AND (g.effective_to IS NULL OR g.effective_to > now())
             AND (g.workflow_key IS NULL OR g.workflow_key = v_workflow_key)
             AND (g.resource_type IS NULL OR g.resource_type = v_resource_type)
         ))
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'awcms_workflow: WORKFLOW_DECISION_FORGED: decided_by holds no pending assignment (or active delegation) on this task'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_decisions_guard ON awcms_workflow_decisions;
CREATE TRIGGER awcms_workflow_decisions_guard
  BEFORE INSERT ON awcms_workflow_decisions
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_decisions_guard();

-- ---------------------------------------------------------------------------
-- Task: INSERT only pending; completed only on a met quorum; cancelled only once
-- the instance is no longer pending; skipped never.
-- (Replaces sql/252's function; the final-status and identity rules are kept.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_tasks_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_instance_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_TASK_INSERT_STATUS: a task is created pending'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

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

  IF NEW.status = 'skipped' THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_TASK_SKIP_REFUSED: the engine never skips a task'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'completed'
     AND awcms_workflow_task_quorum_outcome(
           NEW.id, NEW.quorum_rule, NEW.quorum_threshold) IS NULL THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_TASK_QUORUM_UNMET: a task completes only once its recorded decisions satisfy its quorum'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'cancelled' THEN
    SELECT status INTO v_instance_status
      FROM public.awcms_workflow_instances WHERE id = NEW.workflow_instance_id;

    IF v_instance_status IS NULL OR v_instance_status = 'pending' THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_TASK_CANCEL_REFUSED: a task of a pending instance cannot be cancelled (cancel the instance)'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_tasks_guard ON awcms_workflow_tasks;
CREATE TRIGGER awcms_workflow_tasks_guard
  BEFORE INSERT OR UPDATE ON awcms_workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_tasks_guard();

-- ---------------------------------------------------------------------------
-- Instance: INSERT only pending; pending -> approved|rejected only when the
-- verdict is justified. Replaces sql/252's function, keeping its rules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_instances_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.cancelled_at IS NOT NULL
       OR NEW.cancelled_by_tenant_user_id IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_INSTANCE_INSERT_STATUS: an instance is created pending and finishes only through the engine'
        USING ERRCODE = '55000';
    END IF;

    -- The engine starts an instance on the ACTIVE version of a live
    -- definition and pins that version. (Later retiring the definition does
    -- not touch instances already started: this runs on INSERT only.)
    IF NOT awcms_workflow_role_is_exempt(TG_RELID) AND NOT EXISTS (
         SELECT 1 FROM public.awcms_workflow_definitions d
         WHERE d.id = NEW.workflow_definition_id
           AND d.tenant_id = NEW.tenant_id
           AND d.lifecycle_status = 'active'
           AND d.deleted_at IS NULL
           AND d.version = NEW.workflow_definition_version) THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_INSTANCE_DEFINITION: an instance starts only on the active version of a live definition, pinning that version'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

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

  IF NEW.status IS DISTINCT FROM 'cancelled'
     AND (NEW.cancelled_at IS NOT NULL
          OR NEW.cancelled_by_tenant_user_id IS NOT NULL
          OR NEW.cancel_reason IS NOT NULL) THEN
    RAISE EXCEPTION
      'awcms_workflow: cancel stamps may only be set together with status cancelled'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IN ('approved', 'rejected')
     AND NOT awcms_workflow_instance_verdict_justified(OLD.id, NEW.status) THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED: an instance reaches % only through the decisions of its completed tasks',
      NEW.status
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_instances_guard ON awcms_workflow_instances;
CREATE TRIGGER awcms_workflow_instances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON awcms_workflow_instances
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_instances_guard();

-- ---------------------------------------------------------------------------
-- Definition: graph and facts_schema are frozen once published; the lifecycle
-- only moves forward. (The app edits in place only while `draft`.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_definitions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old_rank integer;
  v_new_rank integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'draft' AND NOT awcms_workflow_role_is_exempt(TG_RELID) THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_DEFINITION_INSERT_STATUS: a definition is created as a draft and published through the lifecycle'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  v_old_rank := CASE OLD.lifecycle_status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END;
  v_new_rank := CASE NEW.lifecycle_status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END;

  IF v_new_rank < v_old_rank THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DEFINITION_LIFECYCLE: a definition never moves back from % to %',
      OLD.lifecycle_status, NEW.lifecycle_status
      USING ERRCODE = '55000';
  END IF;

  IF OLD.lifecycle_status <> 'draft'
     AND (NEW.graph, NEW.facts_schema) IS DISTINCT FROM (OLD.graph, OLD.facts_schema) THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_DEFINITION_FROZEN: the graph of a published definition is immutable (create a new version)'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_definitions_guard ON awcms_workflow_definitions;
CREATE TRIGGER awcms_workflow_definitions_guard
  BEFORE INSERT OR UPDATE ON awcms_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_definitions_guard();

-- ---------------------------------------------------------------------------
-- Seats (assignments). The quorum's eligible count comes from seat status, so a
-- seat must not be retired without a trace. The only UPDATE sites in `src/` are
-- `recordWorkflowTaskDecision` (pending -> decided, after the decision row is
-- written) and `reassignWorkflowTask` (pending -> reassigned, THEN the
-- replacement seat is inserted, in the same transaction).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_task_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_FINAL: a % seat is final and cannot be updated',
      OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF (NEW.id, NEW.tenant_id, NEW.workflow_task_id, NEW.tenant_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.workflow_task_id, OLD.tenant_user_id, OLD.created_at) THEN
    RAISE EXCEPTION
      'awcms_workflow: a seat''s task, user and tenant are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'pending' THEN
    IF NEW.decided_at IS NOT NULL
       OR NEW.reassigned_to_tenant_user_id IS NOT NULL
       OR NEW.reassigned_at IS NOT NULL
       OR NEW.reassigned_by_tenant_user_id IS NOT NULL
       OR NEW.reassign_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_ASSIGNMENT_STAMPS: decision and reassignment stamps accompany only their own status'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status = 'decided' THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.awcms_workflow_decisions d
         WHERE d.workflow_task_id = OLD.workflow_task_id
           AND NOT d.is_administrative_override
           AND coalesce(d.on_behalf_of_tenant_user_id, d.decided_by_tenant_user_id)
               = OLD.tenant_user_id) THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_ASSIGNMENT_NO_DECISION: a seat is decided only when a decision for that seat exists on the task'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.reassigned_to_tenant_user_id IS NOT NULL THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_ASSIGNMENT_STAMPS: decision and reassignment stamps accompany only their own status'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status = 'reassigned' THEN
    -- (The target may be the seat's own holder: reassigning a task retires
    -- EVERY pending seat, then seats the target afresh.)
    IF NEW.reassigned_to_tenant_user_id IS NULL THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_ASSIGNMENT_REASSIGN: a reassigned seat names the user it moved to, who must then hold a seat on the task'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_STATUS: the engine never writes a seat as %',
      NEW.status
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_task_assignments_guard ON awcms_workflow_task_assignments;
CREATE TRIGGER awcms_workflow_task_assignments_guard
  BEFORE UPDATE ON awcms_workflow_task_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_task_assignments_guard();

-- A seat belongs to a task OF ITS OWN TENANT. (The RLS policy scopes by the
-- seat's tenant_id, so without this a seat could be filed under another
-- tenant's task and then counted by that task's quorum.)
ALTER TABLE awcms_workflow_tasks
  ADD CONSTRAINT awcms_workflow_tasks_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE awcms_workflow_task_assignments
  ADD CONSTRAINT awcms_workflow_assignments_task_tenant_fkey
  FOREIGN KEY (workflow_task_id, tenant_id)
  REFERENCES awcms_workflow_tasks (id, tenant_id);

-- Seat INSERT. The engine seats users at the start of a node (createApprovalTask),
-- on escalation, and on reassignment; every one of them seats a PENDING seat on
-- a PENDING task, for an active user of the tenant who is not the requester.
-- Owner and superuser are exempt. The tenant-user check is skipped for a role
-- that cannot read `awcms_tenant_users` at all (the unattended `awcms_worker`
-- escalation role, sql/022, is deliberately not granted it): such a role is not
-- the request path, and the other checks (pending task, requester) still apply.
CREATE OR REPLACE FUNCTION awcms_workflow_task_assignments_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_task_status text;
  v_requested_by uuid;
BEGIN
  IF awcms_workflow_role_is_exempt(TG_RELID) THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending'
     OR NEW.decided_at IS NOT NULL
     OR NEW.reassigned_to_tenant_user_id IS NOT NULL
     OR NEW.reassigned_at IS NOT NULL
     OR NEW.reassigned_by_tenant_user_id IS NOT NULL
     OR NEW.reassign_reason IS NOT NULL THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_INSERT_STATUS: a seat is created pending and retired through the engine'
      USING ERRCODE = '55000';
  END IF;

  SELECT t.status, i.requested_by_tenant_user_id
    INTO v_task_status, v_requested_by
    FROM public.awcms_workflow_tasks t
    JOIN public.awcms_workflow_instances i ON i.id = t.workflow_instance_id
    WHERE t.id = NEW.workflow_task_id AND t.tenant_id = NEW.tenant_id;

  IF NOT FOUND OR v_task_status <> 'pending' THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_INSERT_TASK: a seat is created on a pending task of its own tenant'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.tenant_user_id = v_requested_by THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_INSERT_REQUESTER: the requester cannot be seated to approve their own request'
      USING ERRCODE = '55000';
  END IF;

  -- Two statements, not one `AND`: the privilege test must run BEFORE the
  -- table is planned, or the ACL check on it fires for the role we skip.
  IF has_table_privilege(current_user, 'public.awcms_tenant_users', 'SELECT') THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.awcms_tenant_users u
         WHERE u.id = NEW.tenant_user_id
           AND u.tenant_id = NEW.tenant_id AND u.status = 'active') THEN
      RAISE EXCEPTION
        'awcms_workflow: WORKFLOW_ASSIGNMENT_INSERT_USER: a seat is for an active user of the tenant'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_task_assignments_insert_guard ON awcms_workflow_task_assignments;
CREATE TRIGGER awcms_workflow_task_assignments_insert_guard
  BEFORE INSERT ON awcms_workflow_task_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_task_assignments_insert_guard();

-- A reassigned seat must have its replacement by the end of the transaction
-- (the engine retires the seats, then inserts the new one), so this is checked
-- DEFERRED. A retired seat with no replacement would shrink the `all` quorum.
CREATE OR REPLACE FUNCTION awcms_workflow_reassignment_replacement_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.awcms_workflow_task_assignments r
       WHERE r.workflow_task_id = NEW.workflow_task_id
         AND r.tenant_id = NEW.tenant_id
         AND r.tenant_user_id = NEW.reassigned_to_tenant_user_id
         AND r.status = 'pending') THEN
    RAISE EXCEPTION
      'awcms_workflow: WORKFLOW_ASSIGNMENT_NO_REPLACEMENT: a reassigned seat needs a PENDING seat for the new user on the same task and tenant'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_reassignment_replacement ON awcms_workflow_task_assignments;
CREATE CONSTRAINT TRIGGER awcms_workflow_reassignment_replacement
  AFTER UPDATE ON awcms_workflow_task_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'reassigned' AND OLD.status IS DISTINCT FROM 'reassigned')
  EXECUTE FUNCTION awcms_workflow_reassignment_replacement_check();

-- ---------------------------------------------------------------------------
-- The engine never deletes a task, a seat or a join arrival (grep of `src/`).
-- The REVOKE is the first layer; this trigger is the second, so a future
-- blanket re-grant cannot silently restore deletes. The table OWNER and
-- superusers (migrations, purge tooling, fixtures) are exempt: the point is the
-- request path, and a TRUNCATE by a privileged role is an operator act (sql/252).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_workflow_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF awcms_workflow_role_is_exempt(TG_RELID) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'awcms_workflow: % is never deleted or truncated by the runtime (retire by status)', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS awcms_workflow_tasks_no_delete ON awcms_workflow_tasks;
CREATE TRIGGER awcms_workflow_tasks_no_delete
  BEFORE DELETE ON awcms_workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_reject_delete();
DROP TRIGGER IF EXISTS awcms_workflow_tasks_no_truncate ON awcms_workflow_tasks;
CREATE TRIGGER awcms_workflow_tasks_no_truncate
  BEFORE TRUNCATE ON awcms_workflow_tasks
  FOR EACH STATEMENT EXECUTE FUNCTION awcms_workflow_reject_delete();

DROP TRIGGER IF EXISTS awcms_workflow_task_assignments_no_delete ON awcms_workflow_task_assignments;
CREATE TRIGGER awcms_workflow_task_assignments_no_delete
  BEFORE DELETE ON awcms_workflow_task_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_reject_delete();
DROP TRIGGER IF EXISTS awcms_workflow_task_assignments_no_truncate ON awcms_workflow_task_assignments;
CREATE TRIGGER awcms_workflow_task_assignments_no_truncate
  BEFORE TRUNCATE ON awcms_workflow_task_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION awcms_workflow_reject_delete();

DROP TRIGGER IF EXISTS awcms_workflow_join_arrivals_no_delete ON awcms_workflow_join_arrivals;
CREATE TRIGGER awcms_workflow_join_arrivals_no_delete
  BEFORE DELETE ON awcms_workflow_join_arrivals
  FOR EACH ROW EXECUTE FUNCTION awcms_workflow_reject_delete();
DROP TRIGGER IF EXISTS awcms_workflow_join_arrivals_no_truncate ON awcms_workflow_join_arrivals;
CREATE TRIGGER awcms_workflow_join_arrivals_no_truncate
  BEFORE TRUNCATE ON awcms_workflow_join_arrivals
  FOR EACH STATEMENT EXECUTE FUNCTION awcms_workflow_reject_delete();

REVOKE DELETE, TRUNCATE ON awcms_workflow_tasks FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_workflow_task_assignments FROM awcms_app;
REVOKE DELETE, TRUNCATE ON awcms_workflow_join_arrivals FROM awcms_app;
