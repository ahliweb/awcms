🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `crm_follow_up`

Rule-versioned **follow-up tasks for staff**, keyed by `crm_leads` events (Issue #1165, [ADR-0159](../../../docs/adr/0159-crm-follow-up-is-a-rule-versioned-staff-task-cadence-that-stops-on-lead-signals-and-notifies-only-through-the-existing-email-port.md), **Proposed**, extending [ADR-0153](../../../docs/adr/0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.md) N5). It turns lead events into a worklist, escalates what is overdue, notifies staff by e-mail, and stops all of it the moment a lead converts, is lost, is merged away, replies, withdraws consent or blocks the sender.

It **never sends anything to the lead**, stores **no lead copy** (a task carries the opaque lead id and nothing else), is **not a second workflow engine** (no graph, no approval, no expression language) and has **no cross-channel facade** (ADR-0139): staff notices go through the existing `WorkflowNotificationPort` (the `email` adapter) only.

## Status

`experimental`, **off at three levels**: `CRM_FOLLOW_UP_ENABLED=true` (deployment; otherwise every route answers `503 CRM_FOLLOW_UP_DISABLED` after authorization, the consumer ignores every event and the job visits no tenant), Module Management's per-tenant enable, and the module's own tenant switch (`PATCH /api/v1/crm-follow-up/settings`, default off). No navigation entry and no admin screen yet (all five permissions are in `NOT_YET_SCREENED`).

## How it works

| Piece                                        | What it does                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule + immutable revisions (`sql/369`)       | A closed trigger (`lead_created`, `stage_entered`, `lead_assigned`) with optional pipeline / stage-category / stage-key filters, a task title, due and escalation offsets in **working minutes**, assignee mode (`lead_owner` / `fixed_user`), staff notices (`onAssign`, `onDue`), a per-lead cap, and a calendar |
| Working calendar (`domain/working-calendar`) | IANA zone, ISO weekdays, daily window, holiday dates; local-to-UTC per day, never the host zone                                                                                                                                                                                                                    |
| Simulation (`POST /rules/simulate`)          | Read-only: the same match and plan the consumer runs, plus the lead's stop signals and live tasks; writes nothing                                                                                                                                                                                                  |
| Consumer `crm_follow_up.lead_signals`        | `lead.created` / `lead.stage_changed` / `lead.assigned` create tasks (one per rule and source event); `lead.assigned` moves live `lead_owner` tasks; `lead.converted` / `lead.lost` / `lead.merged` record a stop                                                                                                  |
| Stop signals                                 | Append-only; cancel the lead's open/escalated tasks and pending notices; no task is created for a stopped lead (per-lead advisory lock + database trigger)                                                                                                                                                         |
| `bun run crm-follow-up:dispatch`             | Escalates overdue tasks; re-checks each due notice (task live, no stop, recipient still the assignee and ACTIVE, working hours, hourly cap) and hands it to the e-mail outbox, or cancels, suppresses or defers it                                                                                                 |

`lead.created` now carries `ownerTenantUserId` (an additive field of the `crm_leads` contract): an intake with an owner writes an assignment row but publishes no `lead.assigned`.

## Security

- Default-deny: `crm_follow_up.rules.read`, `.rules.configure` (high-risk, audited at warning), `.tasks.read`, `.tasks.update` (audited), `.stop_signals.create` (high-risk, audited at warning); seeded by `sql/370`, each enforced by its route. Every mutation needs an `Idempotency-Key` and a signed-in person; task and rule writes use `expectedVersion`.
- `FORCE` RLS on all seven tables with composite tenant foreign keys; `awcms_app` holds no `DELETE` and no `UPDATE` on revisions, actions or stop signals; `awcms_worker` never writes a rule or revision and never deletes. Triggers keep revisions, actions and stop signals append-only, a task's identity fixed, its transitions on the allowed graph, a closed task frozen, and a settled notice frozen.
- The worker's e-mail category allow-list (`sql/302`) is widened by exactly `crm.follow_up_assigned`, `crm.follow_up_due`, `crm.follow_up_escalated` (`sql/371`), whose variables are `userName`, `taskTitle`, `dueAt`, `taskReference`: no slot for anything about the lead.
- Audit attributes and notice variables carry ids, closed codes, counts and the tenant-authored task title only.

## Open decisions (owner)

- ADR-0159 is **Proposed**: O1 (automated outbound to the lead), O2 (the stop-signal port for #1144/#1164 and channel consent), O3 (does a reversal lift a stop), O4 (retention of closed tasks and settled notices), O5 (narrow `tasks.read` to own tasks).
- TRIGGER events for a tenant where the module is not active are ignored and **not replayed** when it is switched on (fail closed: no burst of stale tasks). STOP events (`converted`, `lost`, `merged`) are recorded whenever the deployment switch is on, even while Module Management or the tenant switch is off, so a stop still wins after the module is switched back on.
- `tasks.update` has no ownership bound: any holder may complete or cancel any task of the tenant (O5 covers narrowing it with `tasks.read`).
- A notice cancelled as `recipient_changed` is not re-scheduled if the lead is later handed back to the same person (the `(task, kind, recipient)` key already exists); the task stays in that person's worklist.
- Security hardening from the PR #1266 audit: time zones are stored canonical and the formatter cache is bounded (shared `src/lib/time/zoned-formatter.ts`, also used by `booking` and `hr_workforce`); a calendar that cannot hold the offsets is refused; one bad rule or tenant never fails the others; a notice with no template is `suppressed` (`not_queued`) and uses no quota; the hourly cap is counted under a per-recipient lock; a staff stop needs a real lead and is recorded once per (lead, kind); the worker may queue the three `crm.follow_up_*` categories only to an active staff address of the tenant and only with allow-listed variables (`sql/371`).
- A notice already handed to the e-mail outbox before a stop is reported by the stop (`alreadyEnqueuedNotifications`) and not recalled.

## Recorded follow-ups

- The SYSTEM admin screens (worklist, overdue queue, rule editor with revision history and simulation, stop signals, tenant switch) and the navigation entry, which flip the module to `active`.
- The status-aware retention sweep (ADR-0159 O4); until then the seven tables are listed in `BOUNDED_BY_DESIGN`.
- Reply and consent-withdrawal stops from the inbound boundary (#1144/#1164) and the channel consent modules, through a port (O2); today staff record them through the API.
