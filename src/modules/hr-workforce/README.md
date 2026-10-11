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
Geolocation evidence (ADR-0138, Issue #970) is NOT part of attendance: it will be
a separate append-only table keyed to an event id, so no location column ever
exists on `awcms_hr_attendance_events`.

Status is `experimental`: the flag is off, no admin screen exists, and the module
declares no `navigation`. It flips to `active` with its first screen.

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
  are the same 403. The link itself is `employments.assign`: high-risk and audited.
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
  Approvers are the definition's assignees; the decision itself is a workflow
  decision (`POST /workflows/tasks/{id}/decisions`).
- **`settle` applies the verdict (pull, like procurement).** `POST
.../attendance-corrections/{id}/settle` (`corrections.approve`, high-risk) reads the
  instance: pending -> `409 CORRECTION_STILL_PENDING`; approved -> the status moves
  to `approved` **and** the superseding event is appended in one savepoint; rejected
  -> `rejected`; cancelled elsewhere -> `withdrawn`. Calling it is a step somebody
  with `corrections.approve` takes (a domain-event consumer that settles
  automatically is a recorded follow-up).
- **Segregation of duties, four layers.** (1) the workflow engine's own guard stops
  the requester deciding; (2) the chokepoint's self-approval guard refuses the
  requester **settling** (`403`); (3) the handler refuses an approved instance that
  has no human approving decision (`409 CORRECTION_NO_APPROVER`: a graph with no
  approval node would make the requester their own approver) or in which the
  requester took part **directly or as the delegator whose standing a delegate used**
  (`409 CORRECTION_SELF_APPROVED`: the engine's guard compares only the acting user,
  so a delegate approving on the requester's behalf passes it); (4) the database:
  `CHECK (status <> 'approved' OR decided_by <> requested_by)` and a trigger that
  re-reads the workflow's own decision rows. The correction's status can only follow
  the instance's verdict (`approved`/`rejected`/`cancelled`), and an `approved` row
  without its event cannot commit (deferred constraint trigger).
- **Who sees what.** `?mine=true` (own employment, a terminated one included) and
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
  requester, a workflow assignee of the instance, or a caller whose roles grant
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
  statuses only (`info`; settle `warning` when approved); recording an event is not
  audited (high volume: the event is the record). Every write requires an
  `Idempotency-Key`. Recording, requesting, withdrawing and settling are idempotent
  on top of that.
- **No domain event yet.** `awcms.hr.attendance.recorded` stays provisional until a
  consumer exists (as for shifts).

## Subject-rights decision (ADR-0094 coverage)

| Table                             | `subjectData`                                                     | Why                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_hr_employments`            | covered: `profile_id`, `tenant_user_id` + stamps; exported        | The subject's own employment record. Retained under the employer's labour/tax/social-security obligations (`retain_under_obligation`); the link stays and resolves to the anonymised profile.                                                                                                                                   |
| `awcms_hr_employment_terms`       | covered: actor stamp only; **not exported**; retained             | Reaches the person only through `employment_id`, which a direct subject column cannot express. The subject reads their own history through the ownership-granted `GET .../terms`. Append-only, so an erasure could not rewrite it. A direct employment-to-subject join in the export is a recorded follow-up (see Limitations). |
| `awcms_hr_shift_assignments`      | covered: actor stamps only; **not exported**; retained            | When a person was scheduled and when away (coarse category, never a reason). Reaches the person only through `employment_id`, the same open item as the terms (below). The subject reads their own published schedule through `?mine=true`. Never deleted, published rows immutable.                                            |
| `awcms_hr_attendance_events`      | covered: `recorded_by` stamp only; **not exported**; retained     | When a person clocked in and out (behavioural data), reaching the person only through `employment_id` (issue 985, as for terms and shifts). Append-only. The subject reads their own through `?mine=true`. Holds no location, photo, device or network value.                                                                   |
| `awcms_hr_attendance_corrections` | covered: `requested_by`, `decided_by`; **not exported**; retained | A request to change when a person is recorded as having worked, with a sensitive reason. Reaches the employee only through `employment_id` (issue 985). Exporting the reason to the subject is a recorded follow-up with that join.                                                                                             |
| `awcms_hr_shift_templates`        | `NO_SUBJECT_DATA` (reason recorded)                               | A pattern with no person; only actor stamps.                                                                                                                                                                                                                                                                                    |
| `awcms_hr_workforce_settings`     | `NO_SUBJECT_DATA` (reason recorded)                               | A tenant configuration row; only an `updated_by` stamp.                                                                                                                                                                                                                                                                         |

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

- **Shift assignments, attendance events and corrections are not joined into the
  subject export** either (issue 985 covers all of them), for the same reason as the
  terms (`exportable: false`; the employee reads their own published schedule and
  attendance through `?mine=true`). The same follow-up closes all of them, and adds
  the reason of a correction to the subject's own export.
- **Attendance, deferred and recorded:** no `void` (a correction removing an event
  with no replacement) yet: a ghost clock-in is replaced by the true event; no
  sequence validation (a `clock_out` with no `clock_in` is recorded as claimed; the
  effective record is read, not enforced); the 7-day replay window and the 15-minute
  `late` threshold are constants, not tenant settings; **settle is a pull** (no
  consumer applies an approval automatically); the manager chain gives read access
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
- **Terms are not joined into the subject export.** `awcms_hr_employment_terms`
  is `exportable: false` because a subject descriptor cannot express the
  `employment_id` join to a person. A subject-access export today carries the
  employment header only; the employee reads their own terms through
  `GET /employments/{id}/terms`. This is an **open item**: a direct
  employment-to-subject join in the export must land before the module leaves
  `experimental`.
- **No purge exists.** The `data_lifecycle` descriptors state the intended
  lifecycle (soft delete, then a purge after the employer's retention period) but
  nothing purges; archive-then-purge for HR rows is a follow-up.

Known phase-1 posture (documented, no further code in this PR):

- **The `assign` link is not bound to the employee.** Nothing proves the login
  being linked is the person the employment is about. A holder of `assign` can
  link their OWN login to any employment and then read it through the ownership
  grant. The control is the permission itself (high-risk, audited, idempotent,
  never granted to a role by default): the audit row records WHICH login received
  ownership (`linkedTenantUserId`, a UUID, and the previous one) so a misuse is
  attributable, and a tenant may author an SoD rule over `assign`. There is no
  step-up.
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

- No admin screen; `experimental`. Existing tenants also need the backfill for the `shifts.*`, `templates.*`, `clock.*`, `attendance.*` and `corrections.*` permissions, and an operator must **publish a workflow** under `hr.attendance_correction` (or the tenant's key) before a correction can be requested.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- The employee number and hire date cannot be edited in place (delete and recreate
  while it is a mistake); a header edit endpoint is a later issue.
- The terms table is not joined into the subject export (see above).
- `btree_gist` is not used: terms overlap is a trigger, not an exclusion constraint.
