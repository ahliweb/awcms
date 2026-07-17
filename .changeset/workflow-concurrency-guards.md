---
"awcms": minor
---

Workflow approval: close concurrency and quorum-bypass holes

- **Issue #140 — concurrent approvals no longer corrupt a task.**
  `fetchTaskWithInstanceForDecision` now takes `SELECT ... FOR UPDATE OF t` on
  the task row, serialising quorum evaluation per task. Previously two
  approvers deciding at the same instant each evaluated quorum against a READ
  COMMITTED snapshot blind to the other's uncommitted decision:
  `quorumRule: "all"` stranded the task `pending` forever with every assignment
  `decided` (everyone then got a 403 and the escalation worker re-escalated
  indefinitely), while `quorumRule: "any"` advanced the graph twice, producing
  duplicate downstream tasks and doubled `workflow.instance.advanced` events.

- **Issue #152 — a cancelled instance can no longer be resurrected.** The
  `end`-node status UPDATE in `workflow-graph-engine.ts` now carries
  `AND status = 'pending'` (matching `cancelWorkflowInstance`) and rolls the
  transaction back if it matches nothing, instead of silently overwriting a
  cancellation with `approved`/`rejected`.

- **GHSA-9qwq-cmr5-6wfc — one person can no longer satisfy a multi-person
  quorum alone.** A user who was both an original assignee and a node's
  escalation target used to accumulate two live assignment rows on one task and
  could vote twice. Migration `018` adds a partial unique index over
  `(workflow_task_id, tenant_user_id) WHERE status IN ('pending','decided')`
  (de-duplicating any existing rows first), both assignment INSERT paths became
  `ON CONFLICT DO NOTHING`, and quorum now counts
  `COUNT(DISTINCT tenant_user_id)` — people — rather than `COUNT(*)` rows.

Behaviour change: reassigning a task to someone who has already decided it now
fails with a `WorkflowRecoveryError` instead of granting them a second vote.
