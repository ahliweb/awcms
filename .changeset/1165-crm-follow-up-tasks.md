---
"awcms": minor
---

feat(crm_follow_up): configurable follow-up tasks for staff, cadence stop rules and staff notification triggers (Issue #1165, ADR-0159 **Proposed**, extending ADR-0153 N5). **Nothing changes for a deployment that does not set `CRM_FOLLOW_UP_ENABLED=true`**, and a tenant is untouched until Module Management and the module's own switch are on.

**Rules** (`sql/369`): a tenant rule with IMMUTABLE revisions (trigger and no UPDATE grant): a closed trigger (`lead_created`, `stage_entered`, `lead_assigned`) with optional pipeline, stage-category and stage-key filters, a due offset and an optional escalation offset in working minutes over the revision's own calendar (IANA zone, working weekdays, daily window, holidays), an assignee mode (`lead_owner` or `fixed_user`), staff notices and a per-lead cap. No expression language. `POST /api/v1/crm-follow-up/rules/simulate` dry-runs a draft revision and writes nothing.

**Tasks**: a descriptor-declared consumer (`crm_follow_up.lead_signals`) creates at most one task per (rule, source event), so a replayed event creates nothing; tasks move `open -> escalated -> completed | cancelled` with `expectedVersion`, a closed outcome and an append-only action history. `lead.assigned` moves live owner tasks to the new owner (an inactive owner leaves them unassigned).

**Stops win**: `lead.converted`, `lead.lost`, `lead.merged` and staff-recorded `reply_received`, `consent_withdrawn`, `sender_blocked`, `manual` stops cancel the lead's live tasks and pending notices; creation, stop, reassignment and dispatch serialise on a per-lead advisory lock and a database trigger refuses a task for a stopped lead.

**Notices** (`bun run crm-follow-up:dispatch`, every minute, `awcms_worker`): escalates overdue tasks and hands due staff notices to the existing `WorkflowNotificationPort` (e-mail) after re-checking the task, the stop signals, that the recipient is still the assignee and an ACTIVE user, quiet hours and a per-recipient hourly cap. Three new base e-mail categories (`crm.follow_up_assigned`, `crm.follow_up_due`, `crm.follow_up_escalated`, with default en/id templates) whose variables cannot carry anything about the lead; `sql/371` adds exactly these to the worker's category allow-list. Nothing is ever sent to a lead.

Permissions (`sql/370`): `crm_follow_up.rules.read`, `.rules.configure`, `.tasks.read`, `.tasks.update`, `.stop_signals.create`. `lead.created` gains an additive `ownerTenantUserId` field. No admin screen yet.
