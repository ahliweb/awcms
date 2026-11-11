🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0159-crm-follow-up-is-a-rule-versioned-staff-task-cadence-that-stops-on-lead-signals-and-notifies-only-through-the-existing-email-port.id.md)

# ADR-0159 — `crm_follow_up` is a rule-versioned STAFF task cadence keyed by lead events; it stops on lead signals, sends nothing to the lead, and notifies staff only through the existing e-mail port

- **Status:** Proposed
- **Date:** 2026-11-11
- **Decision maker:** ahliweb (owner). **Not yet decided.** The implementation of Issue #1165 ships with this ADR, off by default at every level, so that the owner reviews a concrete design rather than a sketch; merging the code does not accept the ADR.
- **Resolves (when accepted):** Issue #1165 (configurable follow-up tasks, cadence stop rules and notification triggers)
- **Extends:** [ADR-0153](0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.md) (N5 and the #1165 row of its downstream table: "subscribe to the lead events as stop signals; key tasks by lead id; do not store a lead copy; do not send without re-checking consent at dispatch; do not build a second approval engine"), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md) (descriptor-declared consumers), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md) (ports), [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.md) (no facade, no fallback), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (I1 to I13), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md)
- **Related:** Issues #1163, #1166 (`crm_leads`), #1144 (inbound boundary), #1164 (conversation projection), downstream `ahliweb/awcms-one` #462

## Context

Verified on `main` on 11 November 2026:

- `crm_leads` exists (#1166, `sql/342`-`344`), `experimental`, off at three levels. It publishes eight id-only events (`lead.created`, `lead.stage_changed`, `lead.assigned`, `lead.merged`, `lead.merge_reverted`, `lead.converted`, `lead.conversion_reversed`, `lead.lost`). It does **not** yet publish `lead.consent_changed`, and nothing in the repository links an inbound message ("the person replied") to a lead: that is #1144 and #1164.
- ADR-0153 N5 says follow-up tasks and cadences "are #1165, built on `workflow_approval`, the existing jobs and the notification ports", and binds what #1165 must not do. It does **not** admit a module, tables, rule versioning, a simulation surface, a calendar or a notification path. Those need their own admission, which is this ADR.
- The notification seam that already exists is `WorkflowNotificationPort` (`_shared/ports/workflow-notification-port.ts`): `email` implements it by enqueueing an announcement into the e-mail outbox for **tenant users**, with a per-category variable allow-list and a worker-side category allow-list trigger (`sql/302`). `hr_workforce` already calls it from a descriptor-declared consumer running as `awcms_worker`. `push_delivery`, `whatsapp_delivery` and `telegram_delivery` are channel-specific ports for other purposes; ADR-0139 forbids a cross-channel facade and fallback.
- `workflow_approval` is an approval engine (graph, decisions, escalation). A follow-up task is not an approval: nothing is approved or rejected, and the engine has no notion of a lead.

The requirement (issue #1165, from the stakeholder SRS through `awcms-one` #462): reminders, an overdue queue, a daily worklist, escalation, a stop when the person replies, registers or converts, withdraws consent or blocks the sender, frequency caps and quiet hours, with idempotency, race safety and default-deny access.

## Decision

### 1. A new System module `crm_follow_up`, off by default

Admit `crm_follow_up` (`experimental`): its own permission namespace, the deployment switch `CRM_FOLLOW_UP_ENABLED` (default off), Module Management's per-tenant enable, and its own tenant switch (default off). It **depends on** `crm_leads` only through the events and stores **no lead copy**: a task carries the opaque lead id and nothing else about the lead (no name, no contact point, no stage name).

### 2. What it is: staff tasks, not messages to the lead

- **v1 sends nothing to the lead.** Every follow-up is a **manual task for a member of staff** (the issue's "manual task is default"). Outbound messaging to the lead (an automated WhatsApp or e-mail step in a cadence) is **not admitted**: it would need a consent check at schedule **and** at dispatch through each channel's own consent (ADR-0153 L11), per-channel pacing caps and a legal-purpose check, and is a separate ADR (O1).
- **Notifications go to staff only**, through the existing `WorkflowNotificationPort` (e-mail). Three fixed base e-mail categories — `crm.follow_up_assigned`, `crm.follow_up_due`, `crm.follow_up_escalated` — with a variable allow-list of `userName`, `taskTitle`, `dueAt` and `taskReference` only: **no lead name, contact value or note** can reach a template. No facade, no channel choice, no fallback (ADR-0139). The worker's e-mail category allow-list (`sql/302`) is widened by exactly these three categories.
- **Not a second workflow engine.** No graph, no approval, no expression language. `workflow_approval` is not re-implemented and not required; escalation is a task status plus a staff notification.

### 3. Rules are tenant data with immutable revisions

- A **rule** (tenant, code, name, `active`/`archived`) has **revisions**; a revision is **immutable once published** (trigger plus no `UPDATE` grant), and every task records the revision that created it.
- A revision is a closed, declarative record: a **trigger** from a closed list (`lead_created`, `stage_entered`, `lead_assigned`) with optional filters (pipeline id, stage category from ADR-0153's closed list, stage key); a task title (tenant-chosen, bounded, not personal data); a due offset in **working minutes**; an optional escalation offset and escalation recipient; an assignee mode (`lead_owner` or `fixed_user`); which staff notifications to send; a per-lead cap on open tasks; and a **working calendar**: an IANA zone, working weekdays, a daily window and a bounded list of holiday dates. There is no expression, script or callback.
- **Simulation** is a read-only evaluation of a draft revision against a sample trigger (and, optionally, a real lead id to check its stop signals and open-task cap) that returns whether a task would be created, its due and escalation instants and its assignee. It writes nothing.

### 4. Tasks, their transitions and idempotency

- A task is `open`, `escalated`, `completed` or `cancelled`. Allowed moves: `open -> escalated | completed | cancelled`, `escalated -> completed | cancelled`; closed tasks are frozen (database trigger). Completion records an **outcome** from a closed list (`reached`, `no_answer`, `rescheduled`, `not_interested`, `other`) and no free text. Every change appends an immutable **action** row.
- **Event idempotency.** A task is unique on `(tenant, rule, source event id)`: a replayed or redelivered event yields the same single task (on top of the runtime's per-consumer effect ledger).
- **Optimistic concurrency** on every staff transition (`expectedVersion`, `409` on conflict) and an `Idempotency-Key` on every mutation.

### 5. Stop signals win

- A **stop signal** is an append-only fact about a lead: `converted`, `lost`, `merged` (the absorbed lead), `reply_received`, `consent_withdrawn`, `sender_blocked` or `manual`. The first three come from `crm_leads` events; the last four are recorded by authorised staff through the API today, and by the inbound boundary (#1144/#1164) and the channel consent modules through a port once those exist (O2).
- Recording a stop signal cancels every open or escalated task of the lead and every pending notification of those tasks, and **no new task is ever created** for a stopped lead. Task creation and stop recording serialise on a per-(tenant, lead) transaction advisory lock, and a database trigger refuses a task insert for a lead that has a stop signal, so a stop **wins** over a simultaneous trigger regardless of order.
- A stop is permanent in v1: a reverted merge or a reversed conversion does not restart a cadence (O3).

### 6. Time, calendar and the dispatch-time re-check

- All instants are `timestamptz`. Due and escalation instants are computed in the revision's zone over working days and hours, skipping holidays, so the same rule gives the same answer whatever the server's zone, across daylight-saving changes.
- A scheduled job (`bun run crm-follow-up:dispatch`, `awcms_worker`) escalates overdue tasks and hands due notifications to the port. **At dispatch** it re-checks, under the same per-lead lock: the task is still open (or escalated, for an escalation notice), the lead has no stop signal, the recipient is still an **active** user of the tenant (a revoked assignee is never notified), the notification is inside working hours (quiet hours: otherwise deferred to the next working instant) and under the tenant's per-recipient hourly cap (otherwise deferred). A notification already handed to the e-mail outbox before a stop arrived is reported as sent; the stop does not claim to recall it.

### 7. Access, data and retention

- Permissions: `crm_follow_up.rules.read`, `crm_follow_up.rules.configure` (high-risk, audited at warning: create, publish, archive, the tenant switch), `crm_follow_up.tasks.read`, `crm_follow_up.tasks.update` (complete, cancel; audited), `crm_follow_up.stop_signals.create` (high-risk, audited at warning). Each is seeded by migration and enforced by its route. Every table is `FORCE` RLS with composite tenant foreign keys; the runtime holds no `DELETE`.
- Personal data: tasks, actions, stop signals and notifications carry opaque ids, staff ids, closed codes and instants only. The tenant-authored rule name and task title are configuration, not personal data. `subjectData` lists every staff-id column.
- Retention: the module's tables grow with lead events and are listed as bounded-by-design for now; the status-aware retention sweep (settled notifications, closed tasks after a window) is a recorded follow-up together with `crm_leads`' own (ADR-0153 O4).

## Options considered

| Criterion       | **A. Own module of staff tasks on the lead events (chosen)** | B. Model each follow-up as a `workflow_approval` instance | C. Automated outbound cadence to the lead now | D. Extend `crm_leads` with tasks |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| Security        | Sends nothing to the lead; staff notices by fixed categories | Approval semantics misapplied; no lead stop concept       | Consent at schedule and dispatch per channel  | Blurs ADR-0153 N5                |
| Privacy         | No lead copy; ids only                                       | Same                                                      | Contact values must be read and sent          | Same as A                        |
| Maintainability | One narrow module, removable alone                           | Bends an approval engine into a task list                 | Large surface (caps, consent, templates)      | Module with two jobs             |
| Compatibility   | Additive, off by default                                     | Changes engine semantics                                  | Needs channel ADRs first                      | Changes an Accepted ADR          |

## Consequences

- **Positive:** reminders, an overdue queue, escalation and stops exist without a second engine, a facade or any message to the person; the same rule gives reproducible due dates; replays and races are safe by construction.
- **Negative:** a cadence that writes to the lead waits for O1; stops from replies and consent withdrawals are manual until #1144/#1164 and a channel consent event exist; a task's assignee may become inactive and stays visible in the queue until reassigned.
- **Neutral:** nothing changes for any deployment until the module is enabled.

## Open questions for the owner

- **O1.** Is an automated outbound step to the lead admitted later, and through which channel ADR (consent re-check at schedule and dispatch, per-channel caps, approved templates)? Recommended: a separate ADR per channel after #1144.
- **O2.** The stop-signal port for #1144/#1164 and the channel consent modules: its shape and which events feed it. Recommended: a `CrmFollowUpStopPort` admitted with the first producer.
- **O3.** Should a reversed conversion or a reverted merge lift a stop? Recommended: no in v1; staff restart work manually.
- **O4.** Retention windows for closed tasks and settled notifications (with ADR-0153 O4).
- **O5.** Should `tasks.read` be narrowed to "my own tasks" through an ownership grant (ADR-0063) for agents who must not see the whole queue? The same question applies to `tasks.update`, which today lets any holder complete or cancel any task of the tenant.
- **O6.** A notice cancelled as `recipient_changed` is not re-scheduled when the lead is handed back to the same person (the `(task, kind, recipient)` key already exists). Is that acceptable, or should a hand-back re-arm the notice?
