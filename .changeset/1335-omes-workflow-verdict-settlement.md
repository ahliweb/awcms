---
"awcms": patch
---

fix(omes_control): a workflow's later verdict is now applied to the operation request or AI egress approval that started it (Issue ahliweb/awcms#1335). Until now only a verdict that arrived synchronously (a zero-approver graph) was reflected, so a destructive operation (`stop`, `rollback`, restore) approved by a human stayed `requested` for ever and never became a job, and an AI egress approval stayed `pending`.

A new domain-event consumer `omes_control.workflow_verdict_settler` handles `awcms.workflow.instance.approved|rejected|cancelled` v1.0: under a row lock, a row still pending whose `workflow_instance_id` is the event's instance (same tenant) moves to `approved` / `rejected` (egress: `approved` / `denied` with `decided_at`). `approved_by` records the human approver, never the requester; an approval no human backs, or one the requester took part in, is left pending with a warning audit row. A replayed event, a settled row or another tenant's or module's instance is a no-op. The consumer never creates a job (promotion stays in the worker queue). `omes_control` now lists `domain_event_runtime` in its `dependencies` (the consumer contract requires it); `workflow` remains a soft integration.

Operator action: run `bun run db:migrate` (applies `sql/387`, forward-only: column-level UPDATE grants for `awcms_worker` on `awcms_omes_operation_requests` (`status`, `approved_by`, `updated_at`) and `awcms_omes_ai_egress_approvals` (`decision`, `decided_at`, `updated_at`)). Requests already stuck at `requested` / `pending` are not back-filled: re-publishing the workflow event (domain-event dead-letter replay) or an administrator's decision settles them.
