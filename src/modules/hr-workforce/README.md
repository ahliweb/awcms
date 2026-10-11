🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `hr_workforce`

The **employment context** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.md), phase 1
of the `hr_*` family). The design pack is
[`docs/awcms/hr-payroll.md`](../../../docs/awcms/hr-payroll.md) sections 2.1, 3 and
4.1; this file is the map of the code.

## What is here, and what is not

This is the **foundation** (employments, effective-dated terms, settings and
employee-sees-own) plus **shifts and the staff-availability port** (Issue #946).
**Not here yet:** attendance, corrections, commission and payroll (later issues of
the same ADR) —
and **never** a photo, biometric or device-fingerprint field (owner decision O6).

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

## Subject-rights decision (ADR-0094 coverage)

| Table                         | `subjectData`                                              | Why                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_hr_employments`        | covered: `profile_id`, `tenant_user_id` + stamps; exported | The subject's own employment record. Retained under the employer's labour/tax/social-security obligations (`retain_under_obligation`); the link stays and resolves to the anonymised profile.                                                                                                                                   |
| `awcms_hr_employment_terms`   | covered: actor stamp only; **not exported**; retained      | Reaches the person only through `employment_id`, which a direct subject column cannot express. The subject reads their own history through the ownership-granted `GET .../terms`. Append-only, so an erasure could not rewrite it. A direct employment-to-subject join in the export is a recorded follow-up (see Limitations). |
| `awcms_hr_shift_assignments`  | covered: actor stamps only; **not exported**; retained     | When a person was scheduled and when away (coarse category, never a reason). Reaches the person only through `employment_id`, the same open item as the terms (below). The subject reads their own published schedule through `?mine=true`. Never deleted, published rows immutable.                                            |
| `awcms_hr_shift_templates`    | `NO_SUBJECT_DATA` (reason recorded)                        | A pattern with no person; only actor stamps.                                                                                                                                                                                                                                                                                    |
| `awcms_hr_workforce_settings` | `NO_SUBJECT_DATA` (reason recorded)                        | A tenant configuration row; only an `updated_by` stamp.                                                                                                                                                                                                                                                                         |

All five tables are registered with `data_lifecycle` as `delegated`, with no
purge: HR history is retained for the employer's legal periods (counsel's, not
asserted here); archive-then-purge for HR rows is a recorded follow-up.

## Layout

| Path                                        | What it is                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `module.ts`                                 | Descriptor: 16 permissions, `dataLifecycle` + `subjectData`               |
| `domain/hr-shift-types.ts`                  | Shift kinds, statuses, limits — pure                                      |
| `domain/hr-shift-time.ts`                   | Wall-clock to UTC resolution, DST gap/overlap rules — pure                |
| `domain/availability-intervals.ts`          | Interval algebra and the working-time rule — pure                         |
| `domain/hr-shift-validation.ts`             | Strict template and assignment validators (no free text) — pure           |
| `application/hr-shift-directory.ts`         | Template and assignment SQL: draft, publish, cancel, lists                |
| `application/staff-availability-adapter.ts` | The `StaffAvailabilityPort` adapter (read-only)                           |
| `domain/hr-workforce-types.ts`              | Employment types and statuses — pure                                      |
| `domain/hr-workforce-validation.ts`         | Strict request validators (no personal field, no derived end date) — pure |
| `domain/hr-workforce-permissions.ts`        | Literal guard objects passed to `authorizeInTransaction`                  |
| `application/hr-workforce-directory.ts`     | All SQL: list/get, create, terms change, assign, delete/restore, settings |
| `application/hr-workforce-route-support.ts` | Idempotency, body validation and the ownership basis shared by the routes |
| `src/pages/api/v1/hr-workforce/**`          | 11 thin route files, each authorizing through `defineTenantRoute`         |

## Open items and recorded phase-1 postures

Open (tracked, not hidden):

- **Shift assignments are not joined into the subject export** either (issue 985
  covers both tables), for the same reason as the terms (`exportable: false`; the employee reads their own
  published schedule through `?mine=true`). The same follow-up closes both.
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

- No admin screen; `experimental`. Existing tenants also need the backfill for the `shifts.*` and `templates.*` permissions.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- The employee number and hire date cannot be edited in place (delete and recreate
  while it is a mistake); a header edit endpoint is a later issue.
- The terms table is not joined into the subject export (see above).
- `btree_gist` is not used: terms overlap is a trigger, not an exclusion constraint.
