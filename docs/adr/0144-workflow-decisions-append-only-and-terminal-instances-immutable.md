🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0144-workflow-decisions-append-only-and-terminal-instances-immutable.id.md)

# ADR-0144 — Workflow decisions are append-only and terminal instances are immutable, in the database

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision maker:** @ahliweb
- **Related:** Issue #999 (security audit finding F2 of #990); [ADR-0132](0132-hr-payroll-module-family-admission.md) (HR attendance corrections, #947, whose separation of duties reads these tables); `sql/252_awcms_workflow_approval_immutability.sql`; `src/modules/workflow-approval/README.md`.

## Context

`sql/013` called `awcms_workflow_decisions` "append-only / immutable" but issued no `REVOKE` and no trigger, so the claim was a convention. Code running as `awcms_app` inside a tenant could rewrite `decided_by_tenant_user_id` or `on_behalf_of_tenant_user_id` and turn a self-approved settle into a clean one, defeating the database-level separation of duties that HR attendance corrections and later payroll approvals rely on. The audit proved it against the real schema.

## Decision

1. **Decisions are append-only.** `awcms_app` loses `UPDATE`, `DELETE` and `TRUNCATE` on `awcms_workflow_decisions`; a `BEFORE UPDATE OR DELETE` trigger refuses both for any role that does hold the privilege.
2. **Instances are never deleted and a terminal instance is final.** `awcms_app` loses `DELETE`/`TRUNCATE` on `awcms_workflow_instances`; a trigger refuses `DELETE`, refuses every `UPDATE` of an `approved`/`rejected`/`cancelled` row, and, for a pending row, freezes the identity, requester, resource, pinned version and facts snapshot, and allows the cancel stamps only together with `status = 'cancelled'`. The only legal moves are the two the engine already performs: `pending -> approved|rejected` (the `end` node) and `pending -> cancelled` (recovery), each already guarded by `AND status = 'pending'`, which on a finished instance matches zero rows rather than raising.
3. **Tasks are final once final.** Separation of duties reaches an instance's decisions through `awcms_workflow_tasks.workflow_instance_id`, so a trigger freezes a task's instance, node and quorum columns and refuses any `UPDATE` of a `completed`/`skipped`/`cancelled` task. The legitimate task writes (decision completes, recovery cancels, escalation moves `escalation_step`/`escalated_at`/`due_at`) all happen on pending tasks.
4. **Declared, not assumed.** The narrowed verbs are registered in `scripts/security-readiness.ts` so `checkRuntimeRoleGrants` can tell "narrowed on purpose" from "broken".
5. **Maintenance bypass.** A superuser session may step outside the triggers with `SET LOCAL session_replication_role = replica` (tenant purge, test fixtures). The runtime role cannot.

## Consequences

- No application change: a grep of `src/` finds no `UPDATE`/`DELETE` of a decision and no `DELETE` of an instance.
- **What this does not enforce (tracked in #1032):** that an instance reaches `approved`/`rejected` only when its decisions justify it, and that a decision INSERT is bound to the task, assignee and tenant user it claims. This ADR closes edits and deletions of history, not forged additions, so the Context's "defeating separation of duties" is closed for rewriting existing decisions only.
- Assignments and join arrivals are out of scope (assignments are retired by status).
- Tests that forged a decision or back-dated an instance now use the maintenance bypass.
