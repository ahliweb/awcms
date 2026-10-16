🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `hr_workforce`

The **employment context** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.md), phase 1
of the `hr_*` family). The design pack is
[`docs/awcms/hr-payroll.md`](../../../docs/awcms/hr-payroll.md) sections 2.1, 3 and
4.1; this file is the map of the code.

## What is here, and what is not

This is the **foundation** (employments, effective-dated terms, settings and
employee-sees-own), **shifts and the staff-availability port** (Issue #946) and
**attendance events and corrections with approval** (Issue #947).
**Not here yet:** commission and payroll (later issues of the same ADR) —
and **never** a photo, biometric or device-fingerprint field (owner decision O6).
**Geolocation evidence** (ADR-0138, Issue #970, `sql/306`) is NOT part of attendance
and is **off for every tenant** until a person holding
`hr_workforce.geolocation_evidence.configure` (granted to nobody by default, not
even the tenant owner) enables it with a DPIA reference, a published notice and a
geofence. A `self` clock-in/out may then carry one `positionSample`
(`latitude`, `longitude`, `accuracyMeters`); the server evaluates it in the request
against the office's geofences and **discards it**. Only a verdict (`inside`,
`outside`, `not_provided`), a coarse distance band, a coarse accuracy band, the
geofence, the rule version and the database time are kept, in the separate
append-only `awcms_hr_attendance_location_evidence` (30 / 90 / 180 days, hard
delete, no archive, legal hold overrides) keyed to the event, so no location
column ever exists on `awcms_hr_attendance_events`. No coordinate, raw accuracy,
address, device or network value is stored, logged, audited, queued or exported.
Routes: `/api/v1/hr-workforce/geolocation/{settings,geofences,notices,notice,notice-acknowledgements,evidence}`.
Declining, a missing fix, a fix worse than the accuracy ceiling and an
unacknowledged notice all record the clock event normally with `not_provided`;
the verdict is a supporting indicator for human review and decides nothing by
itself. **A client-reported position is forgeable: a verdict is a supporting
indicator, never proof.** `attendance_evidence.read` is tenant-wide and HR-only:
there is no supervisor scope or manager-chain read yet, so a supervisor reads
nothing unless HR assigns the permission (and then reads every employee's
verdicts). A geofence is a 50 m-5 km circle or a simple polygon (at least 2,500
m2, at most 10 km), at most 10 live per office, and the last live one cannot be
deleted while the switch is on. Enabling in any tenant waits for counsel's
sign-off on erasure (ADR-0138). Erasure follows retention (ADR-0094 + ADR-0142); see ADR-0138 "Status of
the implementation" for the open legal question.

Status is `active` since Issue #952: the module declares four admin screens
(the employee's `/admin/hr/my-work` and `/admin/hr/my-metrics`, the supervisor's
`/admin/hr/team`, and HR's `/admin/hr/workforce`; `docs/awcms/workforce-self-service.md`). The employment
write screens, the settings screens and the roster editor are still API-only.

## The rules that make it safe

- **A reference, not a copy.** `awcms_hr_employments.profile_id` is a composite
  `(tenant_id, profile_id)` foreign key to `awcms_profiles`. No name, contact,
  birth date, NIK or NPWP column exists on any HR table; display reads
  `profile_identity`. A test asserts no such column appears.
- **One active employment per profile and per login**, by partial unique indexes
  (`sql/176`), not by handler code. Rehire is a new employment after the first is
  terminated.
- **Terms are append-only and effective-dated.** A change closes the open row and
  inserts the next; terms never overlap; `terminated` is terminal and stamps the
  header; the manager chain is acyclic and at most ten edges deep, counting the reports
  BELOW an employee as well as the managers above (one SQL function shared by the
  trigger and the handler pre-check). Manager-edge writes take one
  per-tenant advisory lock, so two concurrent edges that would close a cycle
  cannot both commit. Each of those is a
  trigger, so a bypassing session cannot break it.
- **Profile merge** between two actively employed profiles is refused by a trigger
  on `awcms_profiles` (ADR-0132 section 2).
- **Employee sees own** is an `ownershipGrant` (ADR-0063) on the persisted
  `tenant_user_id`, passed through `defineTenantRoute`'s new `ownershipGrant`
  option. It only widens `employments.read`; ABAC deny, scope and SoD still apply,
  a machine credential never carries it, and a missing id and someone else's row
  are the same 403. The link itself is `employments.assign`: high-risk and audited,
  and bound to the employee's own profile (see "Known phase-1 posture").
- **High-risk actions** (`create`, terms change, `assign`, `delete`, `restore`,
  `configure`) require an `Idempotency-Key` and are audited without any name,
  title, number or reason; the one identifier they carry is the login's UUID on
  the `assign` row.

## Shifts and the staff-availability port (Issue #946, `sql/184`-`sql/185`)

`awcms_hr_shift_templates` are **patterns** (local start, ELAPSED duration, one
optional break, IANA zone). `awcms_hr_shift_assignments` are concrete UTC
half-open intervals `[starts_at, ends_at)` per employment, `work` or `time_off`,
`draft` -> `published` -> `cancelled`. Putting a template on a local date
resolves the wall clock to UTC **once**, in the application
(`domain/hr-shift-time.ts`), and stores the instants with the zone they were
resolved in, so editing a template later never moves an assignment. On a
daylight-saving gap the pre-change offset is used (02:30 that does not exist
becomes 03:30), on an overlap the earlier occurrence wins, and a shift spanning a
change keeps its true elapsed length (table tests, including Europe/Berlin,
America/New_York and a half-hour zone).

- **No overlap per employment**, across kinds, among non-cancelled rows. A
  trigger takes a per-(tenant, employment) advisory lock BEFORE it looks, so two
  concurrent writers serialise and the second is refused (`23P01`); the handler
  takes the same lock and pre-checks, answering `409 SHIFT_CONFLICT` with the
  other assignment's id in `error.details`. No `btree_gist` exclusion constraint:
  it needs a privileged `CREATE EXTENSION` no migration here asks for (`sql/171`
  records the same decision).
- **Status only moves forward**; a published or cancelled row is immutable (a
  trigger), and nothing is ever deleted (DELETE denied + trigger). There is no
  `shifts.update`: a draft is cancelled and recreated, a published shift is
  cancelled, never edited.
- **No reason, note or free text anywhere.** Time off carries a coarse
  `timeOffKind` (`leave`, `holiday`, `other`); sick leave is health data. A test
  asserts no column of that kind exists.
- **Publish and cancel are high-risk** (`Idempotency-Key`, audited with ids and
  the kind only). Employees read their own PUBLISHED schedule through an
  `ownershipGrant` on `GET /shift-assignments?mine=true`; drafts need
  `shifts.read`.
- **`StaffAvailabilityPort`** (`_shared/ports/staff-availability-port.ts`, imports
  nothing; adapter `application/staff-availability-adapter.ts`; contract
  `docs/awcms/cross-domain-contracts.md` section 4). It returns, per opaque staff
  reference (an employment id), `resolved` or `unknown` plus working intervals:
  published work, minus each assignment's break, minus time off, clipped to the
  window, adjacent intervals merged (`domain/availability-intervals.ts`, pure).
  Three fields per person; no name, office, code, kind or grade. It is a read in
  the caller's tenant transaction (FORCE RLS applies, and the tenant is also in
  every predicate), authorizes nothing, audits nothing and writes nothing; the
  CONSUMER's composition root authorizes its own permission first. `unknown` =
  not found, other tenant, soft-deleted, or no `active` term touching the window,
  indistinguishable on purpose. A work shift counts only if the terms were
  `active` on its LOCAL start date. A source-text test fails if the adapter ever
  names a compensation, payroll, commission or payout table. No Booking code is
  imported anywhere; Booking (a later issue) will consume the port type.

## Attendance and corrections (Issue #947, `sql/198`-`sql/199`)

`awcms_hr_attendance_events` is one fact per row: an employment clocked in, out,
started or ended a break, at a **claimed** instant (`occurred_at`), **recorded** by
the database at its own instant (`recorded_at`), from a `source` (`self`,
`supervisor`, `kiosk`, `import`, or `correction`). `awcms_hr_attendance_corrections`
is a **proposed change** (`add` a missing event, or `replace` one) with a mandatory
reason and a `workflow_approval` instance. The effective record is "events not
superseded".

- **Append-only, in the database.** `awcms_app` holds only `SELECT` and `INSERT` on
  events (registered in `RETIRED_TENANT_TABLE_PRIVILEGES`), and a trigger refuses
  `UPDATE` and `DELETE` for any other role too. A correction row only ever changes
  its **status**; its proposal, reason, requester and instance are immutable.
- **The server clock.** A trigger overwrites `recorded_at` with `clock_timestamp()`;
  a client cannot supply it (nor `late`: both are unknown keys and refused). The
  claimed time is bounded by the tenant's `clock_skew_seconds`
  (`awcms_hr_workforce_settings`, default 300): **in the future** beyond it is
  refused for every source (`422 ATTENDANCE_TIME_IN_FUTURE`).
- **Back-dating, reconciled.** The design pack says an offline event is accepted
  and flagged `late`; the issue says back-dated events beyond the skew are refused.
  Both hold, by source: a **`self`/`supervisor`** event claims "now", so a claimed
  time older than the skew is refused (`ATTENDANCE_BACKDATED`: file a correction); a
  **`kiosk`/`import`** event is a replayed offline queue, so a stale time is accepted
  up to **7 days** (older: `ATTENDANCE_TOO_OLD`) and flagged `late` past 15 minutes.
  The 7 days and 15 minutes are constants in the guard; making them tenant settings
  is a recorded follow-up.
- **Replay.** `(tenant_id, employment_id, client_event_key)` is unique. A replay
  returns the **original** (`200`, not `201`); a different event under a used key is
  `409 CLIENT_EVENT_KEY_CONFLICT`. Concurrent posts of one key record once
  (`ON CONFLICT DO NOTHING` plus a read of the winner).
- **Who records for whom.** `source: self` needs `hr_workforce.clock.create` AND an
  employment linked to the caller's login (anything else is `403`, existent or not:
  S3). It is a permission and not an `ownershipGrant` because a grant may only widen
  a read. `supervisor`/`kiosk`/`import` need `hr_workforce.attendance.create` and can
  never use `self`. `attendance.create` is a **trusted** power (an `import` can claim
  a time up to 7 days old, flagged `late`, with no approval): granted to no role by
  default, and per-office scoping of it waits for the scope adapter.
- **A correction never edits the original.** Approval appends a NEW event
  (`source = correction`, `supersedes_event_id`, `correction_id`); the database
  refuses a correction-sourced event unless its correction is `approved` and the
  event matches kind, instant, employment and target exactly, once. An event is
  superseded at most once (unique index), and only by a correction; one **pending**
  correction per target event (unique index).
- **Approval is required and fail-closed.** With the `workflow` module off or no
  published definition under `correction_workflow_key`
  (default `hr.attendance_correction`): `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` and
  nothing is created (no row, no instance). The instance is started with **no
  facts**, so neither the reason nor the proposed time enters the workflow store.
- **A proposed instant that could never be applied is refused up front.** Approval
  appends an event, and the event guard refuses a claimed time beyond the tenant's
  skew in the future, so a correction proposing one would be approved and then stay
  pending for good (`409 CORRECTION_NOT_APPLICABLE` at settle). Creating a correction
  therefore applies the same bound to `proposedOccurredAt`: further than
  `clock_skew_seconds` ahead of now is `422 ATTENDANCE_TIME_IN_FUTURE` (the event
  path's code) and nothing is created. The employment's hire and termination dates
  are not checked: the event guard checks neither the start date nor, for a
  `correction`-sourced event, the termination (a terminated employment can still be
  corrected), so neither does this. `CORRECTION_NOT_APPLICABLE` remains for what can
  change between request and approval: the employment soft-deleted meanwhile, or the
  tenant lowering its skew below the proposal.
  Approvers are the definition's assignees; the decision itself is a workflow
  decision (`POST /workflows/tasks/{id}/decisions`).
- **Settlement is automatic; `settle` is the manual fallback (#998).** The verdict
  is applied by `settleCorrection`: approved -> the status moves to `approved`
  **and** the superseding event is appended in one savepoint; rejected ->
  `rejected`; cancelled -> `withdrawn`. A domain-event consumer,
  `hr_workforce.attendance_correction_settler` (ADR-0134, declared in `module.ts`),
  calls it as soon as `workflow_approval` publishes
  `awcms.workflow.instance.approved` / `.rejected` / `.cancelled` (one event per
  finished instance, on every path: a decision, a force-decision, an
  administrator's cancel, an escalation timeout), so nobody has to remember and no
  one needs `corrections.approve` for it to happen. It runs in the dispatcher
  (`bun run domain-events:dispatch`) as `awcms_worker` with the narrow grants of
  `sql/280`, so **a tenant must run the dispatcher** for settlement to follow the
  decision (without it the correction waits, exactly as before). The consumer has
  **no acting user**: the audit row has no actor and carries `trigger =
workflow_event`; `decided_by` is the human who approved or rejected (NULL for a rejection or cancellation nobody decided: it names who decided, never who settled, `sql/281`; the settler is on the audit row); the
  superseding event has no `recorded_by`. A **refusal is not an error and is not
  retried**: an approval with no human approver, one the requester or the employee
  took part in, a superseded target or an event the guard refuses leaves the correction `pending`, writes one
  `warning` audit row (`hr_workforce.attendance_correction.auto_settle_skipped`,
  outcome only, never the reason) and waits for a person. An instance that is not a
  correction's, an event whose aggregate is not a workflow instance, or an instance still pending matches nothing and is ignored quietly;
  the worker role reads neither the correction `reason` nor the workflow decisions'
  `reason` / `override_reason` (column-scoped SELECT, `sql/280`), and may insert only
  `correction`-sourced events (any member of `awcms_worker` is held to that); an instance finished before this
  consumer shipped has no delivery and is settled by hand once.
  The manual route `POST .../attendance-corrections/{id}/settle`
  (`corrections.approve`, high-risk) reads the instance: pending -> `409
CORRECTION_STILL_PENDING`, then the same application.
  **The requester is told (#1044).** After the consumer settles a correction it
  queues one e-mail to the requester through the optional `workflow_notification`
  capability (`email`'s adapter, `enqueueAnnouncement`): an outbox INSERT in the
  consumer's own transaction, sent later by `bun run email:dispatch`, never a
  provider call on the settlement path, and wrapped in a savepoint so a failure
  is logged (class and code only) and can never undo the settlement. Three
  translated EN/ID templates, one per outcome (`hr.attendance_correction_applied`
  / `_rejected` / `_cancelled`), carry the employee's display name and the
  date (UTC) and **never the reason** (the templates' variable allow-list has no
  slot for it, and the worker cannot read the column). One notice per
  (correction, outcome): only the `pending` -> settled transition notifies, the
  effect ledger absorbs a retried delivery, and the outbox row carries the
  correlation id `hr_workforce.attendance_correction:<id>:<outcome>`. A tenant
  opts in by having those templates active (`bun run
email:templates:seed-defaults`); with none the port is a silent no-op. The
  worker's INSERT on `awcms_email_messages` is column-scoped (`sql/302`). A
  correction settled by hand through the manual route notifies nobody (the
  caller is already looking at the result). Telegram and WhatsApp are not wired:
  no module-registered Telegram template reaches the dispatcher process today and
  its variable kinds cannot carry a name, and there is no staff-phone resolver
  for WhatsApp.
- **Segregation of duties, four layers.** (1) the workflow engine's own guard stops
  the requester deciding; (2) the chokepoint's self-approval guard refuses the
  requester **settling an approved (or still pending) correction** (`403`); it is
  skipped for a `rejected` / `cancelled` verdict, which applies nothing, so the
  requester can close their own refused request (#998; the `corrections.approve`
  permission is still required); (3) the handler refuses an approved instance that
  has no human approving decision (`409 CORRECTION_NO_APPROVER`: a graph with no
  approval node would make the requester their own approver) or in which the
  requester **or the employee the correction is about** took part **directly or as
  the delegator whose standing a delegate used**, or which that employee settles
  (`409 CORRECTION_SELF_APPROVED`: the engine's guard compares only the acting user,
  so a delegate approving on someone's behalf passes it, and a colleague filing a
  correction for an employee would otherwise let that employee approve it). The
  subject is the login linked to the employment when the correction was requested
  (snapshotted in `subject_tenant_user_id`, stamped by the trigger) AND the one
  linked now, so a re-link in between does not shed the exclusion; there is no
  transitive manager-chain exclusion; (4) the database: a `CHECK` that
  `decided_by` is neither the requester nor the subject, and a trigger that
  re-reads the workflow's own decision rows (decided by and on behalf of). The correction's status can only follow
  the instance's verdict (`approved`/`rejected`/`cancelled`), and an `approved` row
  without its event cannot commit (deferred constraint trigger).
- **Who sees what.** `?mine=true` (every live employment of the caller, terminated ones included: a
  rehired person reads the old employment's events and corrections and the current
  one's, never anyone else's) and
  `?reports=true` (the **current manager chain** below the caller's own live,
  non-terminated employment) are `ownershipGrant`s on the READ routes only; the
  unrestricted list needs `attendance.read` / `corrections.read` ("HR sees all"). An
  `employmentId` outside the chosen basis is `403`. `awcms_hr_report_ids` walks at
  most ten levels and **neither returns nor walks through a soft-deleted employment**:
  the deleted-manager posture below is fail-closed (a skip-level manager loses sight
  of the people under a deleted middle manager until HR rewrites their terms).
  A malformed request is held until authorization has decided, so an unauthorised
  caller is told `403` before `400`.
- **The reason is sensitive.** It is selected only on `GET .../{id}` and only for the
  requester, a LIVE workflow assignee of the instance (a seat that was reassigned or
  skipped sees nothing), or a caller whose roles grant
  `corrections.read`; a supervisor reading a report's correction through the chain
  alone sees everything but the reason. No write response carries it (so the
  idempotency store holds none), the list never does, and no audit row, domain event,
  log or workflow fact does (source-text and runtime tests scan for a sentinel).
- **Guards take the parent row `FOR SHARE`** (employment, workflow instance,
  correction), so a concurrent delete or termination serialises with the insert
  instead of racing it (a test holds an uncommitted soft-delete open and proves the
  insert waits and is refused). The events table itself cannot be locked `FOR SHARE`
  by `awcms_app` (no `UPDATE` privilege), which is why the supersession target is
  read plainly: the table is immutable.
- **Audit and idempotency.** Request, withdraw and settle are audited with ids and
  statuses only (`info`; settle `warning` when approved). Recording an event is
  audited **when it is recorded for somebody else** (#998): every `supervisor` event
  (`info`) and a `kiosk` / `import` event flagged `late` (`warning`), as
  `hr_workforce.attendance_event.recorded_for_other` with the employment, kind,
  source and `late` (the claimed instant is on the event the row names), and the recorder as the actor; a `self`
  event and a punctual kiosk/import tap are not (high volume: the event is the
  record), and a replay adds no second row. `attendance.create` is tenant-wide and
  seeded to no role by default; the seven-day kiosk/import replay window **bypasses
  correction approval** by design (it exists for offline queues), which is exactly
  why a stale one is audited. Every write requires an
  `Idempotency-Key`. Recording, requesting, withdrawing and settling are idempotent
  on top of that.
- **No domain event yet.** `awcms.hr.attendance.recorded` stays provisional until a
  consumer exists (as for shifts).

## Workforce metrics (Issue #953, `sql/308`)

Transparent business FACTS about attendance, hours, shift coverage and
productivity, with the full contract in
[`docs/awcms/workforce-metrics.md`](../../../docs/awcms/workforce-metrics.md).
Two routes under `/api/v1/hr-workforce/workforce-metrics/`:

- `employees` — per-employee facts. `?mine=true` (the employee, no permission) and
  `?reports=true` (the supervisor, **direct** reports only, no permission) are
  ownership grants; everyone else needs `workforce_metrics.read` (HR). An
  `employmentId` outside the basis is 403, the same as a missing one.
- `groups` — per-office aggregates for `workforce_metrics.analyze` (or `.read`),
  returning no individual row. A group with fewer than five contributing
  employees is `suppressed: true` with no number at all, and there is no
  tenant-wide total to subtract from. The threshold is a code constant.

No composite score, ranking or flag exists anywhere; no photo, biometric, device
or location value is read (there is none on the source tables); no payroll table
is read. Every response says that a figure is not an assessment and needs the
governance review of section 7 of the contract before any consequential use.

The module registers one reporting projection, `hr_workforce.attendance_events`
(event volume per kind, HR-only), because the engine's tenant-wide counters cannot
express "own only" or small-group suppression; the behavioural figures are
computed live instead (`domain/hr-workforce-reporting.ts` explains the split).

## Subject-rights decision (ADR-0094 coverage)

| Table                             | `subjectData`                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_hr_employments`            | covered: `profile_id`, `tenant_user_id`, `last_tenant_user_id`; exported                  | The subject's own employment record. The actor stamps (`created_by`, `updated_by`, `deleted_by`, `restored_by`) are NOT subject columns since Issue #1018: they name the HR user who entered the header, and matching them put other people's headers into that user's export. Retained under the employer's labour/tax/social-security obligations (`retain_under_obligation`); the link stays and resolves to the anonymised profile. |
| `awcms_hr_employment_terms`       | covered: through the employment (`subjectVia`); **exported**; retained                    | The employee's own whole history, reached through `employment_id` -> `awcms_hr_employments` (`profile_id` / `tenant_user_id`), the indirect path of ADR-0142. The recorder's `created_by` is deliberately NOT a subject column, so an HR user's export never carries other people's history. Erasure does not follow the join; append-only and retained.                                                                                |
| `awcms_hr_shift_assignments`      | covered: through the employment (`subjectVia`); **exported**; retained                    | When a person was scheduled and when away (coarse category, never a reason), drafts included, reached through the employment (ADR-0142). The scheduler's stamps are not subject columns. Never deleted, published rows immutable; erasure does not follow the join.                                                                                                                                                                     |
| `awcms_hr_attendance_events`      | covered: through the employment (`subjectVia`); **exported**; retained                    | When a person clocked in and out (behavioural data), reached through `employment_id` -> `awcms_hr_employments` (ADR-0142, Issue #1018). The recorder's `recorded_by` is deliberately NOT a subject column. Append-only; erasure does not follow the join. Holds no free text, location, photo, device or network value, so every column is exported.                                                                                    |
| `awcms_hr_attendance_corrections` | covered: through the employment (`subjectVia`); **exported, `reason` withheld**; retained | A request to change when a person is recorded as having worked, reached through the employment (ADR-0142, Issue #1018). The requester and the approver are not subject columns. The free-text `reason` is a redacted column (see Open items); the subject still reads it through the ownership-granted GET.                                                                                                                             |
| `awcms_hr_shift_templates`        | `NO_SUBJECT_DATA` (reason recorded)                                                       | A pattern with no person; only actor stamps.                                                                                                                                                                                                                                                                                                                                                                                            |
| `awcms_hr_workforce_settings`     | `NO_SUBJECT_DATA` (reason recorded)                                                       | A tenant configuration row; only an `updated_by` stamp.                                                                                                                                                                                                                                                                                                                                                                                 |

All seven tables are registered with `data_lifecycle` as `delegated`, with no
purge: HR history is retained for the employer's legal periods (counsel's, not
asserted here); archive-then-purge for HR rows is a recorded follow-up.

## Layout

| Path                                        | What it is                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `module.ts`                                 | Descriptor: 23 permissions, `dataLifecycle` + `subjectData`                              |
| `domain/hr-shift-types.ts`                  | Shift kinds, statuses, limits — pure                                                     |
| `domain/hr-shift-time.ts`                   | Wall-clock to UTC resolution, DST gap/overlap rules — pure                               |
| `domain/availability-intervals.ts`          | Interval algebra and the working-time rule — pure                                        |
| `domain/hr-shift-validation.ts`             | Strict template and assignment validators (no free text) — pure                          |
| `application/hr-shift-directory.ts`         | Template and assignment SQL: draft, publish, cancel, lists                               |
| `application/staff-availability-adapter.ts` | The `StaffAvailabilityPort` adapter (read-only)                                          |
| `domain/hr-workforce-types.ts`              | Employment types and statuses — pure                                                     |
| `domain/hr-workforce-validation.ts`         | Strict request validators (no personal field, no derived end date) — pure                |
| `domain/hr-workforce-permissions.ts`        | Literal guard objects passed to `authorizeInTransaction`                                 |
| `application/hr-workforce-directory.ts`     | All SQL: list/get, create, terms change, assign, delete/restore, settings                |
| `application/hr-workforce-route-support.ts` | Idempotency, body validation and the ownership basis shared by the routes                |
| `domain/hr-attendance-types.ts`             | Attendance kinds, sources, correction statuses and limits — pure                         |
| `domain/hr-attendance-validation.ts`        | Strict event and correction validators (no location, no free text but the reason) — pure |
| `application/hr-attendance-directory.ts`    | Events, corrections, the read bases (own, reports), settle and withdraw                  |
| `src/pages/api/v1/hr-workforce/**`          | 16 thin route files, each authorizing through `defineTenantRoute`                        |

## Open items and recorded phase-1 postures

Open (tracked, not hidden):

- **Attendance events and corrections are exported through the employment**
  (Issue #1018, ADR-0142): the employee's own events and corrections, nothing of a
  colleague's or of the supervisor who recorded them. **The correction's free-text
  `reason` is withheld** (a redacted column, and the response says so): it is typed
  by the requester, may describe health or family circumstances (a third party's
  included) and is sensitive everywhere else in this module. The employee still
  reads it through the ownership-granted GET. Whether the export may release it is
  an open product/legal question (ADR-0142 addendum); the change is deleting one
  `redactedColumns` entry.
- **Attendance, deferred and recorded:** no `void` (a correction removing an event
  with no replacement) yet: a ghost clock-in is replaced by the true event; no
  sequence validation (a `clock_out` with no `clock_in` is recorded as claimed; the
  effective record is read, not enforced); the 7-day replay window and the 15-minute
  `late` threshold are constants, not tenant settings; **settlement is automatic** (a
  domain-event consumer, #998) with `settle` as the manual fallback, and the
  requester is not notified of the outcome; the manager chain gives read access
  only, so a supervisor still cannot record for a report without
  `attendance.create`; **no per-office scope** on `attendance.read`/`create` (the
  scope adapter is a later issue, as for employments); no domain event; no admin
  screen; the correction workflow's approvers are the definition's fixed assignees,
  not "the requester's manager" (the engine has no such assignee type).
- **No `data_lifecycle` purge for attendance** (declared `delegated`, class
  `financial_tax`, period the employer's counsel's); the events list is
  keyset-paginated at 100 per page in the meantime.
- **No `data_lifecycle` purge for shift rows** (declared `delegated`, retention
  class `financial_tax` as the other HR rows; the period is the employer's
  counsel's). **No domain event** (`awcms.hr.shift.assigned` stays provisional
  until Booking consumes it), **no admin screen**, **no template restore** (a
  deleted template frees its code; recreate), and **no assignment on or after a
  termination is refused** (the port simply ignores terms that are not `active`).
- **Terms and shifts are exported through the employment** (issue 985, ADR-0142):
  a subject-access export carries the employee's own terms history and shift
  assignments, and nothing of a colleague's or of the HR user who recorded them.
  Erasure does not follow the join; the rows are retained. The join matches the
  employment's `profile_id` only (Issue #1018): a login mislinked to another
  person's employment and later corrected does not carry that employment's rows into
  its export. The employment HEADER still matches the login columns (follow-up).
- **No purge exists.** The `data_lifecycle` descriptors state the intended
  lifecycle (soft delete, then a purge after the employer's retention period) but
  nothing purges; archive-then-purge for HR rows is a follow-up.

Known phase-1 posture:

- **The `assign` link is bound to the employee (finding PS-14, Issue #979).**
  The ownership grant is the key to "an employee sees their own" and, in phase 3,
  to payslips, so the link is no longer just a permission. (1) A caller cannot
  link their OWN login to another person's employment (`403 SELF_LINK_FORBIDDEN`).
  (2) The linked tenant user's identity must carry the employment's `profile_id`
  (`422 PROFILE_MISMATCH`); the match is exact and fail-closed, so a profile that
  was merged away on either side must be re-pointed first. Because an employee
  and a login of the same person share a profile, linking your own login to your
  own employment still works. (3) A re-link (changing or removing an existing
  link) is audited at `critical` (a first link stays `warning`) with the before
  and after login UUIDs and no free text, and, when the employment already has
  attendance events, needs the CONDITIONAL step-up of ADR-0141 section 4: a
  caller with no enrolled factor is not locked out (the audit row records
  `stepUp: "not_enrolled"`), an enrolled caller with a stale session gets
  `403 STEP_UP_REQUIRED`. Refusals are not stored under the Idempotency-Key, so
  the same key succeeds after a step-up. Further hardening: the three refusals each write an `account_link_refused` audit
  row (reason code and UUIDs only; the refusal is a returned `Response`, so the
  transaction commits and the row survives); a repeat "link the same login"
  re-validates the login rather than echoing a pre-fix link as `200`; the login's
  identity must be `active`; an employment that was EVER linked
  (`last_tenant_user_id`, `sql/228`) stays a re-link after an unlink; the
  `awcms_hr_employments_link_guard` trigger refuses a mismatched login in the
  database; and the `security:readiness` warning "Employment account links belong
  to the employment's person" lists links made before the fix. Still open for #961: "released payslips"
  join the history test, and the former owner is revoked from payslips there.
- **`employments.read` is tenant-wide.** No `office` business scope bounds it
  in phase 1; per-office and per-manager reads (design-pack scenarios S4 and S6)
  need the scope adapter and a `manager_of` ownership reason, both later issues.
- **A soft-deleted manager leaves a dangling reference.** Soft-deleting an
  employment that is someone's current manager does not rewrite the reports'
  terms, so their `managerEmploymentId` points at a deleted row (still present,
  `deletedAt` set). Anything walking the chain must handle a deleted manager; the
  chain-depth and cycle rules still count it.
- The ownership resolver reads one boolean about a row before the guard decides
  (inside the tenant transaction, under RLS); a missing id and someone else's row
  both answer 403, so it is not an existence oracle, but the read happens before
  the decision.

## Limitations

- The employment write, settings and roster screens do not exist yet (the self-service, supervisor and HR read screens do, Issue #952). Existing tenants also need the backfill for the `shifts.*`, `templates.*`, `clock.*`, `attendance.*` and `corrections.*` permissions, and an operator must **publish a workflow** under `hr.attendance_correction` (or the tenant's key) before a correction can be requested.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- The employee number and hire date cannot be edited in place (delete and recreate
  while it is a mistake); a header edit endpoint is a later issue.
- The terms table is not joined into the subject export (see above).
- `btree_gist` is not used: terms overlap is a trigger, not an exclusion constraint.
