---
"awcms": minor
---

Add the workflow-approval module: a managed, versioned, graph-based approval
engine ported from awcms-mini's proven `workflow-approval` module. Draft/
publish/retire definition lifecycle with immutable published/retired versions
and per-instance version pinning; generic nodes/transitions (sequential
approval, bounded conditional routing, parallel/join fan-out/fan-in, notify);
quorum/any/all approval rules; effective-dated delegation/substitution;
escalation/timeout policies processed by a scheduled worker job; and
administrative recovery (reassign/cancel/force-decision).

- New migration `013_awcms_workflow_approval_schema.sql`: adds
  `awcms_workflow_definitions`, `awcms_workflow_instances`,
  `awcms_workflow_tasks`, `awcms_workflow_task_assignments`,
  `awcms_workflow_join_arrivals`, `awcms_workflow_decisions` (append-only),
  and `awcms_workflow_delegations`. All tenant-scoped tables have RLS
  tenant-isolation policies with FORCE, FK indexes, `timestamptz`, and the 14
  workflow permission rows. The upstream `GRANT ... TO <worker-role>`
  least-privilege blocks are intentionally omitted (this base has no separate
  worker/app database roles).
- Registers 8 domain event types (`awcms.workflow.instance.*`,
  `awcms.workflow.task.escalated`, `awcms.workflow.delegation.*`) in the
  domain-event-runtime registry, with matching AsyncAPI channels/operations,
  published via `appendDomainEvent` inside the same transaction as each state
  change.
- Public REST surface under `/api/v1/workflows/**` (definitions CRUD +
  lifecycle, approval inbox + decisions, delegations, instance history +
  cancel, administrative recovery) with default-deny ABAC, tenant/RLS,
  `Idempotency-Key` + audit on every high-risk mutation, and OpenAPI paths.
- New scheduled worker `bun run workflow:escalations:dispatch` (registered in
  the module job registry).
- Extends `identity_access`'s ABAC evaluator with the self-approval /
  self-administered-force-decision denial the workflow decision endpoints rely
  on (inert for every endpoint that does not supply
  `requestedByTenantUserId`).

The `notify` graph node's concrete notification adapter (owned by the `email`
module in awcms-mini) is not wired yet — `notify` nodes silently no-op and
advance until the `email` module is ported.
