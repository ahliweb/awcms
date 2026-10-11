🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](hr-payroll.id.md)

# HR and payroll — workforce, commission, payroll (design pack)

> **Status:** admitted by [ADR-0132](../adr/0132-hr-payroll-module-family-admission.md)
> (Issue #916). **Design, plus one landed slice:** the phase 1 _foundation_
> (module `hr_workforce`, `experimental`, `sql/176`–`sql/177`: employments,
> effective-dated terms, settings, employee-sees-own; Issue #945), the **shift
> slice** (`sql/184`–`sql/185`: shift templates, shift assignments with a
> database-enforced overlap rule, and the `StaffAvailabilityPort` adapter; Issue
> #946) and the phase 2 _rule foundation_ (module `hr_commission`,
> `experimental`, `sql/182`–`sql/183`: versioned commission rules and their pure
> evaluation; Issue #950) exist. Attendance, corrections, the commission accrual
> ledger and payroll are still design only: no table, route or migration exists
> for them.
> This pack is the PRD-lite per phase, the state machines, the ERD and data
> dictionary, the permissions/RLS matrix, the masking, audit and idempotency
> matrices, the RBAC/ABAC acceptance scenarios, the threat and privacy analysis,
> the provisional events, and the open owner decisions. Decisions and rejected
> alternatives are in the ADR. The pattern follows
> [`procurement.md`](procurement.md), [`inventory-ledger.md`](inventory-ledger.md)
> and [`tax-calculation.md`](tax-calculation.md). Table, permission and route
> names below are **proposals for the implementing issues** and become real only
> when a migration, OpenAPI and tests land; where this pack says "must", that is
> a requirement on those issues.

## 1. The family, its phases and its gates

| Phase | Module key      | Scope                                                                                | Depends on                             | Buildable when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | --------------- | ------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `hr_workforce`  | employment context, attendance, corrections, shifts, **staff-availability port**     | `tenant_admin`, `profile_identity`     | now (usual DoD, security review of the new port and the ownership paths)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2     | `hr_commission` | commission rules and accrual ledger                                                  | `hr_workforce`                         | phase 1 landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3     | `hr_payroll`    | compensation, payout accounts, periods, runs, lines, payslips, payroll rule versions | `hr_workforce`, `hr_commission` (soft) | **O4 and O7 answered (2026-10-10); the configurable SoD mode decided by ADR-0136, amending ADR-0132 (§7.5); payout-account at-rest encryption decided (**done: [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md), design only, [x]**); security review (**recorded: [§17.2](#172-results-by-area), [x] as a review; its blocking findings PS-01 to PS-04 are still to be written into the design**); legal review of the engine's rule-version controls (any jurisdiction profile is the consumer's own, O4) (**NOT done: checklist [§17.3](#173-legal-review-checklist-for-counsel-not-answered-here), sign-off [§17.4](#174-sign-off-to-be-completed-by-counsel-left-blank) blank, [ ]**); restore rehearsal** |

**Out of scope for the whole family:** general ledger and any accounting entry;
fiscal documents (annual return, withholding certificates); bank-file generation
and any payment-provider call (a later issue, through the outbox, never inside a
database transaction); leave balances and accrual; loans and benefits; applicant
tracking; performance review; **affiliate commission** (a different beneficiary,
not an employee); photo, biometric and device-fingerprint attendance evidence (never, O6); geolocation-only evidence is not part of the admitted phases; its design is decided in ADR-0138 and built only by a follow-up issue (§4.3).

## 2. PRD-lite

### 2.1 Phase 1 — Workforce

**Problem.** A business that schedules people needs one answer to "who works here,
where, under whom, and when", that a booking or POS module can ask without
learning anything about pay, and without a private `employees` table that copies
names and national ids.

**Goal.** An employment context that **references** a `profile_identity` profile,
append-only attendance with approved corrections, shift templates and assignments
with conflict detection, and a narrow port exposing working intervals.

**Users.** An employee (clocks in, sees own attendance and schedule); a supervisor
(approves corrections and sees their office scope); a scheduler (assigns shifts;
cannot read salary); an HR administrator (employments, accounts links); a Booking
module (reads availability through the port); an auditor.

| Acceptance criterion (from the issue)                                                                                  | Where                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Employment stores a `profile_identity` reference and never copies name, contact, national id                           | §3, `profile_id` composite FK; no personal column in any HR table |
| Org unit, manager, effective-dated status                                                                              | §4.1 `employment_terms`                                           |
| Attendance events, corrections, approval via `workflow_approval`                                                       | §4.2                                                              |
| Geolocation-only evidence is a separate feature, off by default per tenant; photo, biometric and device evidence never | §4.3 (decided in ADR-0138; absent in phase 1)                     |
| Shift templates and assignments with conflict detection                                                                | §4.4                                                              |
| A staff-availability port for Booking                                                                                  | §5                                                                |

### 2.2 Phase 2 — Commission

**Problem.** Staff are paid a share of what they sell or deliver. Computed in a
spreadsheet or in each consumer, the same sale pays twice, a refund never claws
back, and a changed rate silently rewrites last month.

**Goal.** A versioned rule, an accrual ledger that posts each source exactly once
and compensates instead of mutating, and a lifecycle to payable and paid.

**Users.** A commission administrator (rules), a sales or service manager
(approves accruals), an employee (sees own accruals), payroll (phase 3 consumes
payable accruals), a downstream adapter (posts accruals).

| Acceptance criterion                                                                | Where    |
| ----------------------------------------------------------------------------------- | -------- |
| Versioned rule + accrual ledger pending → approved → payable → paid/voided/reversed | §6.1, §8 |
| Unique source reference, exactly-once accrual                                       | §6.2     |
| Reversal compensates, never mutates                                                 | §6.3     |
| Not affiliate commission; source consumers are downstream adapters                  | §6.4     |

### 2.3 Phase 3 — Payroll (admitted, gated)

**Problem.** Pay is the highest-consequence, most-regulated computation a tenant
performs: wrong once is a legal and human event, a changed regulation is a data
change not a code change, and the people with the power to compute, approve and
disburse must not be one person.

**Goal.** Periods and runs with segregated duties, rules as effective-dated data,
immutable finalized runs corrected by reversal, and payslips visible only to their
owner.

**Users.** A payroll preparer (calculates), a payroll approver (approves and
finalizes), a disburser (records payment), an employee (own payslip), an auditor,
a finance reader (totals, through an authorized read).

| Acceptance criterion                                          | Where               |
| ------------------------------------------------------------- | ------------------- |
| Period, run, line, payslip                                    | §7                  |
| SoD: calculate vs approve vs pay, configurable per tenant     | §7.5, O7 (answered) |
| Period lock; immutable finalized runs; correction by reversal | §7.2, §7.4          |
| Effective-dated, jurisdiction-neutral rules                   | §7.3                |
| Indonesian profile is rule data, owned by each consumer       | §7.3, O4 (answered) |

## 3. Identity reference and what the family never stores

The employment row carries `profile_id` as a **composite `(tenant_id, profile_id)`
foreign key to `awcms_profiles (tenant_id, id)`**: the mechanism procurement uses
for its supplier ([ADR-0128](../adr/0128-generic-procurement-supplier-receiving-transfer-module-admission.md)
§2), backed by the `UNIQUE (tenant_id, id)` that `sql/174` added to
`awcms_profiles`. The decision, the six alternatives and the verdict on each are
in ADR-0132 §2. The consequences for every table in this pack:

- **Never a column of any HR table:** a name, legal name, e-mail, phone, address,
  birth date, **NIK**, **NPWP**. Display reads `profile_identity` (name, masked
  identifiers). Phase 3 resolves a tax or national identifier from
  `profile_identity` when a run needs it, under the same masking rules.
- **A login link** (`tenant_user_id`, nullable composite FK to
  `awcms_tenant_users`) is the basis of self-service ownership, not an identity.
  Setting or changing it is high-risk (`assign`), audited, and is how "this
  payslip is mine" is decided.
- **`_shared/ports/party-directory-port.ts` does not exist.** It is cited by
  [`erp-extension-contracts.md`](erp-extension-contracts.md) §4 and ADR-0020; the
  contract text is corrected in this change. A summary-resolving port is built
  only when a second in-process consumer needs one.
- **Merge:** profile merge never rewrites an employment; a merge between two
  profiles that both have an _active_ employment is refused by the phase 1 PR.
- **Orphan visibility:** a soft-deleted or anonymised profile leaves the
  employment readable by id, with `profile_identity` supplying whatever name it
  still holds. HR history is retained under the employer's legal obligations
  (§13.2), not severed with the profile.

## 4. Workforce design (phase 1)

### 4.1 Employment context

`awcms_hr_employments` — a stable header: `profile_id`, `employee_no` (unique per
tenant among live rows), `hired_on`, optional `tenant_user_id`, soft-delete
stamps. `awcms_hr_employment_terms` — **effective-dated, append-only** rows:
`office_id` (composite FK to `awcms_offices`; the office tree **is** the
organisational unit and the `office` business-scope type), `manager_employment_id`
(self composite FK, chain acyclic and depth-bounded), `job_title`, `employment_type`
(`permanent`, `fixed_term`, `part_time`, `casual`), `status` (`active`, `on_leave`,
`suspended`, `terminated`), `effective_from`, `effective_to`. Terms for one
employment never overlap (trigger). A change closes the current row and inserts
the next; history is never edited. A `department_label` is descriptive text and
**not** a scope. Terminated is terminal for the employment; rehire is a new
employment on the same profile.

### 4.2 Attendance and corrections

`awcms_hr_attendance_events` is **append-only** (no UPDATE/DELETE for `awcms_app`,
and a trigger): `employment_id`, `kind` (`clock_in`, `clock_out`, `break_start`,
`break_end`), `occurred_at` (claimed, UTC), `recorded_at` (server), `source`
(`self`, `supervisor`, `kiosk`, `import`), `client_event_key`, `office_id`,
`supersedes_event_id`. Unique `(tenant_id, employment_id, client_event_key)`: an
offline kiosk or POS replaying its queue posts each event once, and a replay
returns the original. `occurred_at` more than a configured skew into the future is
refused; a stale `occurred_at` is accepted (offline) and flagged `late` for review.

A **correction** (`awcms_hr_attendance_corrections`) never edits an event. It
proposes an added or replaced event with a mandatory reason, starts a
`workflow_approval` instance, and on approval appends a new event that
`supersedes` the old. The effective record is "events not superseded". Approval is
**required and fail-closed**: a tenant with no published `hr.attendance_correction`
workflow gets `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` at submit. The existing
self-approval guard stops an employee from approving their own correction. The
reason text is personal data and never rides in an audit row or event.

### 4.3 Geolocation, photo and device evidence

**Owner decision O6 (answered 2026-10-10, awcms-one DoR):** attendance **may**
use **geolocation only** — **no photo, no biometric and no device fingerprint,
ever** — and it is **off by default per tenant**. **Decided in ADR-0138
(Accepted, 2026-10-12) — as a decision record only: no table, column, setting,
permission or route exists, and phase 1 still ships none of it.** An
implementation issue is created from the ADR and depends on the attendance
implementation (#947). The decision:

- **Verdict-only evidence.** At `clock_in`/`clock_out` only, the server evaluates
  one position sample against a tenant geofence and persists a verdict
  (`inside`/`outside`/`not_provided`) with coarse distance and accuracy bands.
  **No coordinate is ever at rest**, in a log, event, audit row or export. Raw and
  rounded coordinates, a client-side verdict and a raw short-lived window were
  rejected.
- **Separate append-only table** linked to the event (no location column on
  `awcms_hr_attendance_events`), so evidence is purged without touching the
  payroll-relevant event.
- **Off for every tenant**; enabling needs `hr_workforce.geolocation_evidence.configure`
  (not seeded to default roles), a recorded DPIA reference, a published notice
  version and a geofence; audited at `critical`. Disabling is always allowed.
- **Notice acknowledgement** per employee is evidence of notice, not consent as
  the lawful basis; declining records `not_provided` and never blocks clocking.
- **Purpose-limited:** presence at an authorised site only; a non-`inside`
  verdict raises a human-review flag and decides nothing automatically.
- **Read roster:** `hr_workforce.attendance_evidence.read` for HR and supervisors
  in scope, the employee's own rows via `ownershipGrant`; schedulers, cashiers,
  marketers and payroll operators have no path.
- **Retention** by a `data_lifecycle` descriptor created with the table
  (30 / 90 / 180 days min / default / max, hard delete, no archive, legal hold
  overrides), plus a subject-data descriptor for export and erasure (ADR-0094).
- **Explicitly out:** photo, biometric, device fingerprint or network identifiers;
  coordinates at rest; tracking or history; any location outside the two events;
  provider calls; automated adverse decisions; kiosk or import positions.

The photo option (stored through `media_library`) and any biometric or
device-fingerprint option that earlier drafts of this section kept open stay
**removed**: the owner excluded them.

### 4.4 Shifts and conflict detection

`awcms_hr_shift_templates`: `code`, `name`, `local_start` (time), `duration_minutes`
(1–1440), `break_offset_minutes` and `break_minutes` (optional), `time_zone` (IANA),
optional `office_id`, soft-delete. A template is a **pattern**.
`awcms_hr_shift_assignments`: `employment_id`, optional `template_id`, `kind`
(`work`, `time_off`), `starts_at`, `ends_at` (UTC `timestamptz`, half-open
`[starts_at, ends_at)`, `ends_at > starts_at`, work ≤ 24 h, time off ≤ 31 days),
optional single break `[break_starts_at, break_ends_at)` inside the interval,
`time_zone` snapshot, `office_id`, `status` (`draft`, `published`, `cancelled`).
**Materialising** a template into an assignment resolves the local wall-clock to
UTC once, at assignment time, and stores both; editing a template later never moves
an existing assignment. Overnight shifts are intervals that cross midnight, not
date-keyed rows. Time off carries a coarse `time_off_kind` (`leave`, `holiday`,
`other`) and **never a reason**: sick leave is health data.

**Conflict rule.** For one employment, no two assignments with `status <>
'cancelled'` may overlap as half-open intervals, **across kinds** (work over time
off conflicts). Violation is `409 SHIFT_CONFLICT` naming the conflicting assignment
id only. **As built (Issue #946, `sql/184`):** a `BEFORE INSERT OR UPDATE` trigger
takes a transaction-scoped advisory lock keyed on (tenant, employment) and then
refuses an overlapping non-cancelled row (`23P01`, `HR_SHIFT_CONFLICT`); the handler
takes the same lock and pre-checks, so the refusal is a named `409` and not a
poisoned transaction, and a maintenance session cannot create an overlap either. No
`btree_gist` exclusion constraint is used (the extension needs a privileged
`CREATE EXTENSION` no migration in this repo asks for; `sql/171` records the same
decision). Only `published` assignments are visible to the availability port.
A published assignment is cancelled, never deleted.

## 5. The staff-availability port

### 5.1 Purpose and ownership

Booking (Issue #915, ADR-0131) must know when a staff member can be booked. It
reads that through `StaffAvailabilityPort`, never a table, never an event cache of
this family's schema, and never anything near compensation. The port is a pure
TypeScript interface in `src/modules/_shared/ports/staff-availability-port.ts`
(created by the phase 1 PR; imports nothing from any module, ADR-0011); its
adapter lives in `hr_workforce` and reads **only** `awcms_hr_shift_assignments` and
`awcms_hr_employment_terms`. Booking's composition root (its route or job) injects
the adapter.

### 5.2 Contract

```ts
export type StaffAvailabilityQuery = {
  /** Opaque staff references (= employment ids), 1..200, duplicates collapsed. */
  staffRefs: readonly string[];
  /** Window start, INCLUSIVE. ISO 8601 UTC instant ending in `Z`. */
  fromUtc: string;
  /** Window end, EXCLUSIVE. Must be after `fromUtc`; span at most 35 days. */
  toUtc: string;
  /** Optional: only intervals assigned to this office. */
  officeId?: string;
};

export type AvailabilityInterval = {
  startUtc: string; // inclusive
  endUtc: string; // exclusive
};

export type StaffAvailability = {
  staffRef: string;
  /** `unknown` = cannot vouch: not found, other tenant, soft-deleted, not
   *  active anywhere in the window. Indistinguishable on purpose. */
  status: "resolved" | "unknown";
  /** Working time, sorted, disjoint, merged, clipped to the window. Empty when
   *  `unknown`. An empty array with `resolved` means "scheduled for nothing". */
  intervals: readonly AvailabilityInterval[];
};

export type StaffAvailabilityResult = {
  asOf: string; // server instant the answer was computed
  staff: readonly StaffAvailability[];
};

export interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: StaffAvailabilityQuery
  ): Promise<StaffAvailabilityResult>;
}
```

### 5.3 Semantics (normative)

- **Instants and intervals.** Every instant is UTC. Every interval is half-open
  `[start, end)`: inclusive start, exclusive end. Two intervals where one's end
  equals the other's start are **adjacent and merged**, so a consumer never sees a
  zero-width seam. The window is half-open the same way; results are **clipped**
  to it.
- **No local dates cross the port.** The consumer converts a business-local day to
  UTC itself; the port neither accepts nor returns a local date or a zone, so the
  Indonesian zones (WIB UTC+7, WITA UTC+8, WIT UTC+9) and any future DST rule are
  the consumer's concern and cannot disagree between the two sides. Assignments
  were resolved to UTC at creation (§4.4), so a later template edit changes nothing.
- **What counts as working time.** The union of `published`, non-cancelled `work`
  assignments, **minus** the union of `published` `time_off` assignments and
  **minus** each assignment's break, for employments whose terms are `active` at
  that instant. `on_leave`, `suspended` and `terminated` terms contribute nothing.
- **Fail-closed.** Anything the adapter cannot vouch for is `unknown` with empty
  intervals. There is no "available by default" and no distinguishing "does not
  exist" from "not active" (no existence oracle).
- **Bounded.** At most 200 staff and a 35-day window per call; larger asks are a
  `RangeError`-class refusal the caller must split. Result size is bounded by
  staff × assignments in the window.
- **No payroll exposure, structurally.** The result has three fields per staff
  member: `staffRef`, `status`, `intervals`. No name, office, template code, kind
  label, grade, rate or any HR attribute. The adapter's SQL names only the schedule
  (`awcms_hr_shift_assignments`), the terms (`awcms_hr_employment_terms`) and the
  employment header (`awcms_hr_employments`, because soft-delete lives there; none
  holds a name or a rate); a test fails if it ever names a compensation, payroll or
  commission table. The port reads, so it carries no write and no event.
- **Authorization and audit.** The port authorizes nothing and audits nothing
  (as `InventoryLedgerPort` documents): the consumer's composition root authorizes
  _its own_ permission before calling. The call runs in the caller's tenant-scoped
  `tx`, so FORCE RLS applies.
- **No hold.** The answer is a read, not a reservation. Booking must re-check at
  commit; `asOf` lets it tell how old the answer is. `awcms.hr.shift.assigned`
  (§10) lets it invalidate.

### 5.4 Consumer duties

Resolve display names through its own resource or `profile_identity`, never from
this port. Treat `unknown` as unbookable. Do not infer a person's absence reason
from a gap. Never log the full result with staff references at `info`.

## 6. Commission design (phase 2)

### 6.1 Rules and the accrual ledger

`awcms_hr_commission_rules`: `rule_key`, `version`, `status` (`draft`, `published`,
`retired`), `effective_from`, `effective_to`, `calculation` (`percent` of a base
amount, or `fixed` per unit), `rate` or `fixed_amount`, `currency_code`,
`rounding_mode`, `source_type` it applies to. Published and retired versions are
**immutable** (trigger); change is a new version. The rule applied to an accrual is
the one **effective at the event's `occurred_at`**, never `now()`.

> **Landed in #950 (rules only).** `percent` and `fixed` (per whole unit) exist,
> plus an optional floor and ceiling applied to the rounded amount; `status`
> moves `draft` → `published` → `retired` (a draft may also be retired); a
> published window may not overlap another published version of the same rule
> (trigger, advisory-locked). Evaluation is the pure
> `src/modules/hr-commission/domain/hr-commission-evaluation.ts` (`bigint`
> decimal strings, no tiers, no expression language). The ledger below landed in #951.
>
> **Landed in #951 (the ledger, without reversal).** `awcms_hr_commission_accruals`
> and `awcms_hr_commission_transitions` (`sql/188`; permissions `sql/189`);
> `operation` is `accrue` only for now and `amount` is therefore non-negative (a
> reversal's negative row is the next step). The status machine is `pending →
approved → payable → paid`, and `voided` from `pending` or `approved`; the log is
> written only by the accrual's own triggers, so status and log cannot diverge.
> **Back-dated rules (decided in #951, `sql/187`):** the rule is selected by the
> event's own date, so publishing a version whose window starts before today (UTC)
> changes which rule applies to events not yet accrued; such a publish needs a
> `backdatedReason` (409 without), the database stamps `publish_backdated` and
> refuses a publish without a reason even if the application is bypassed, and the
> audit row carries only the flag. Existing accruals cite their rule by foreign key
> and never change. **PS-19** is designed for, not built: `paid` is terminal and
> reached once, a partial index serves `FOR UPDATE SKIP LOCKED` selection of
> payable accruals, and a reversal never re-opens its original; the claim record
> belongs to #962. Not yet: reversal, the `awcms.hr.commission.*` events, own-read
> and the `office` scope.

`awcms_hr_commission_accruals` is the ledger. The monetary facts —
`employment_id`, `rule_id` and `rule_version` snapshot, `source_type`,
`source_ref`, `source_line`, `operation` (`accrue`, `reversal`), `base_amount`,
`rate` snapshot, signed `amount`, `currency_code`, `occurred_at` — are
**immutable**. Only `status` and its stamps advance, by a transition trigger.
`awcms_hr_commission_transitions` is the append-only log of who moved what when.

### 6.2 Exactly-once accrual

Unique key `(tenant_id, source_type, source_ref, source_line, employment_id,
operation)`. A downstream adapter calls a port (`src/modules/_shared/ports/commission-accrual-port.ts`)
with the source identity; posting an existing identity with the same canonical
request returns the original (`replayed: true`); a different amount or rule for the
same identity is `409 SOURCE_CONFLICT`. `employment_id` is in the key so one source
line may be split between staff, each accruing once. The ledger **trusts the
caller's source** exactly as the inventory ledger does (it can prove a source was
not posted twice, not that the order exists): verifying the order is real, paid and
belongs to the actor is the adapter's duty, written into the port documentation.
The `Idempotency-Key` header is additionally required on HTTP accrual endpoints.

### 6.3 Lifecycle and reversal

See §8 for the diagram. `pending → approved` (a manager other than the
beneficiary), `approved → payable` (`release`), `payable → paid` (recorded by
`accruals.pay`, or by a finalized payroll run in phase 3). `voided` is from
`pending|approved` only: no money was committed, no compensation row. After
`payable`, an error or a refunded sale is a **reversal**: a **new** accrual with
`operation = reversal`, negative `amount`, `reverses_accrual_id`, under its own
source identity; the original's monetary facts are untouched and its status is
stamped `reversed`. A reversal of an already-`paid` accrual is netted by the next
payroll (a negative line), not clawed from a closed run. Reversal is once per
accrual (partial unique index) and a reversal is not reversible.

### 6.4 Boundaries

This is **employee commission**: the beneficiary is always an employment (so there
is a person with identity, an office and a manager). Affiliate or referral payouts
have an external beneficiary, other terms and another module's ledger; at most this
design is a pattern they may copy. **Source-event consumers** — a paid order line,
a completed reservation — are **downstream adapters** in the consuming repository;
this family imports neither commerce nor booking, and the adapter, not this module,
decides which events are commissionable.

## 7. Payroll design (phase 3)

### 7.1 Compensation and payout accounts

`awcms_hr_compensation`: **append-only, effective-dated** versions per employment —
`effective_from`, `pay_basis` (`monthly`, `daily`, `hourly`), `base_amount`,
`currency_code`, `status` (`proposed`, `approved`, `rejected`), `proposed_by`,
`approved_by`. A change is proposed by one person and approved by a different one
(self-approval guard); `approved_by <> proposed_by` is also a CHECK. A version whose
`effective_from` lies in a **locked** period is refused (`backdate` is the
high-risk action for the narrower case of an open period before today).
`awcms_hr_payout_accounts`: bank or wallet reference per employment, classification
`sensitive`; **decided by [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md)
(design only; nothing implemented)**: the account number is stored only as AES-256-GCM
ciphertext with the key id inside the value and the row bound as associated data,
a keyed tenant-bound HMAC (`account_hash`, separate key ring) for equality lookup,
and a mask; there is **no plaintext `normalized_value` column** (unlike the supplier
identifier pattern of ADR-0128, whose unkeyed hash is not reused here).

### 7.2 Periods, runs, lines, payslips

`awcms_hr_payroll_periods`: `period_key` (`2026-10`), `starts_on`, `ends_on`,
`pay_date`, `status` (`open`, `locked`), lock stamps. **There is no unlock**; a
mistake in a locked period is corrected by reversal, with the correction flowing as
adjustment lines into the next open period. `awcms_hr_payroll_runs`: `period_id`,
`run_no`, `kind` (`regular`, `off_cycle`, `reversal`), `status`, the ids of the
**rule versions** and compensation versions used (snapshot), counts and totals
(`numeric`, decimal strings on the wire), and one actor stamp per transition.
`awcms_hr_payroll_run_lines`: `run_id`, `employment_id`, `element_code`,
`element_kind` (`earning`, `deduction`, `employer_contribution`, `withholding`),
`amount`, `basis`, `rule_version_id`, plus the **non-personal inputs** used (worked
minutes, unit counts) — never a salary copy beyond the amount itself.
`awcms_hr_payslips`: one per employment per run, derived at finalization,
**immutable**, `released_at` (an employee sees it only after release),
`acknowledged_at`. A payslip's detail is read from the lines. A regular payslip is
unique per `(tenant, period, employment)` while not reversed: an employee is paid
once per period per regular run.

**Calculation reads attendance and commission as snapshots**: attendance summary
(worked and overtime minutes) and payable commission accruals are read **through
two family-internal ports** (shape deferred to the phase 3 PR) at calculation time
and recorded on the lines. A later attendance correction never alters a finalized
run; it flows into the next period.

### 7.3 Rules as effective-dated data

`awcms_hr_pay_rule_sets` / `awcms_hr_pay_rule_versions` follow the tax module's
pattern (ADR-0127): a version is immutable once published, effective-dated, and
published by maker/checker. Versions draw from a **closed set of calculation
kinds** — `fixed`, `percent` (with floor/cap), `progressive_bracket` (marginal
tiers), `lookup` (a category and a base range select a rate) — over named
components of the run (gross, taxable base, contribution base). There is **no
expression engine and no `eval`**. The engine is **jurisdiction-neutral**: it
contains no rate, no ceiling, no category and no regulation name.

**Indonesian profile (rule data, not constants).** The issue names PPh 21 under
PMK 168/2023, PP 49/2025 and BPJS. This pack does not assert their content: the
parameters (monthly withholding brackets by status category with a periodic
true-up, contribution rates and salary ceilings, overtime multipliers, holiday
allowance) must be **transcribed from the regulation text by a named reviewer,
with the citation and effective date stored on the version**, and a later
regulation arrives as a **new version**, never an edit. **Owner decision O4
(answered 2026-10-10, awcms-one DoR): the Indonesian payroll profile is owned by
each consumer.** Upstream ships **only the engine and effective-dating** and
**no Indonesian rates, ceilings, categories or regulation text** — not as seed
data and not as a data package of this repository. A consumer that needs the
profile authors it as rule versions in its own repository under the provenance
rule above (a named reviewer, the citation and the effective date on each
version) and carries its own legal review. The scope of that profile (PPh 21
only, or BPJS, overtime and holiday allowance as well) is therefore the
consumer's decision, not an upstream one; the regulations named above describe
what a consumer's profile would transcribe and are not a commitment of this
pack.

### 7.4 Finalization, immutability and correction

A finalized run is immutable **in the database**: a trigger permits only the
transitions in §8 and, per transition, only the stamp columns; `awcms_app` holds no
DELETE and the lines table is frozen from `approved`. **Correction is reversal:**
a `reversal` run posts lines negating the original's (referencing them), the
original is stamped `reversed`, and a fresh regular run recalculates. Nothing is
edited. A finalized run's numbers can be reproduced from its snapshot (rule
versions, compensation versions, attendance and commission inputs), and a
reconciliation read (§14) proves the lines sum to the run totals and the payslips
sum to the lines.

### 7.5 Segregation of duties (owner decision O7 — answered: configurable per tenant)

Duties are separate permissions: **C**alculate (`runs.calculate`), **A**pprove
(`runs.approve`), **F**inalize (`runs.finalize`), **P**ay (`runs.pay`), **R**everse
(`runs.reverse`), plus **K** compensation write (`compensation.update`) and
**U** rule publish (`rules.publish`).

| Pair held by one person                 | Strict mode (default) | Relaxed mode  | Role-level mechanism                                                            |
| --------------------------------------- | --------------------- | ------------- | ------------------------------------------------------------------------------- |
| C × A (calculate and approve)           | forbidden             | **forbidden** | SoD rule, `global_within_tenant`, `critical`, no exception; plus database CHECK |
| A × P (approve and pay)                 | forbidden             | **forbidden** | SoD rule, `critical`, no exception; plus database CHECK                         |
| C × P (calculate and pay)               | forbidden             | allowed       | per-instance database CHECK only (see "Which rules are role-level" below)       |
| C × F, F × P                            | forbidden             | allowed       | per-instance database CHECK only                                                |
| A × F (approve and finalize)            | **allowed**           | **allowed**   | same duty tier, F freezes what A approved                                       |
| K × A (change salary and approve a run) | forbidden             | **forbidden** | SoD rule, `critical`, no exception                                              |
| U × A (publish rules and approve a run) | forbidden             | **forbidden** | SoD rule, `high`                                                                |
| R × P (reverse and pay)                 | forbidden             | **forbidden** | SoD rule, `high`                                                                |
| S × (C, A, F or P) (see below)          | forbidden             | **forbidden** | SoD rule, `critical`, no exception                                              |

**Owner decision O7 (answered 2026-10-10, awcms-one DoR) and its decision record
ADR-0136: separation of duties is configurable per tenant.** The strict column
is the **default**: calculate ≠ approve ≠ pay. A tenant may **relax** it to
**prepare ≠ approve**, and **the relaxation is audited**. Nothing here is
implemented yet; the enforcement lands in Issue #957.

- **Modes.** A per-tenant setting `payroll_sod_mode` ∈ {`strict` (default),
  `relaxed`} in the module's settings. In `relaxed` mode the _preparer_ duties —
  C, F and P — may be held by one person, but the **approver (A) must remain a
  different person from whoever calculated and from whoever pays**; every other
  pair marked forbidden in the relaxed column is unchanged. A very small tenant
  therefore needs **two** distinct people for the run itself instead of three.
  Strict mode needs at least **three distinct people**. The former time-bound C × P
  exception is **withdrawn**: the per-instance check would refuse it anyway, and
  the sanctioned way to let one person calculate and pay is to relax the whole
  tenant, which is audited and stamped on every run.
- **The permission neither side holds (O7a, part 2).** Changing the mode is the
  permission **S = `hr_payroll.sod_policy.configure`** (resource `sod_policy`,
  the existing `configure` action, high-risk). A SoD rule forbids one person from
  holding S together with any of C, A, F or P, with no exception: the preparer must
  not be able to relax the check that binds them, and the approver must not be able
  to set the scope of the check on their own decisions. S is held by a tenant
  administrator who does no payroll duty. A two-person payroll tenant therefore
  needs a third principal **for configuration only, not per run**; a tenant with no
  such principal stays strict. Platform-level support must not hold S on a
  tenant's behalf. Changing the mode also needs an `Idempotency-Key`, a reason
  code, the conditional step-up of ADR-0058 §E on **relaxing** (tightening is
  audited but does not demand step-up), and writes an audit row at `critical`
  severity carrying the actor and the before/after mode and no free text. Each run
  records the mode in force when it was calculated (`sod_mode`, immutable after
  `calculate`), and every audit row of a relaxed-mode run carries
  `sodMode: "relaxed"`, so changing the setting later never alters a run already
  in flight.
- **Per-instance rules in the database.** `approved_by <> calculated_by` and
  `approved_by <> paid_by` hold **in both modes, unconditionally**.
  `finalized_by <> calculated_by` and `paid_by` differing from `calculated_by` and
  `finalized_by` hold when the run's `sod_mode = 'strict'`; they are what
  relaxation lifts. The existing self-approval guard also applies to `approve` in
  both modes.
- **Which rules are role-level (a consequence to confirm in #957).** SoD rule
  descriptors are static code-only data (ADR-0031) and cannot read a tenant
  setting. A role-level rule on C × P, C × F or F × P would therefore refuse the
  assignment even in relaxed mode. Those three pairs are enforced **only per
  instance** in the database (conditional on `sod_mode`); the pairs that hold in
  both modes are role-level rules **and** unconditional CHECKs. The cost: in strict
  mode a person holding both C and P is refused when the second action is taken,
  not when the role is assigned.
- **O7a, decided (ADR-0136).** "Prepare ≠ approve" relaxes exactly C × P, C × F and
  F × P. It does **not** let the approver calculate or pay. Rejected: relaxing
  only C × A (the approver may pay, which removes the control on money leaving the
  business and re-creates the classic approve-and-pay fraud pair), and relaxing
  nothing but making the tenant add a person (does not meet the owner's
  small-tenant need). Full analysis in the ADR.
- **Amendment of ADR-0132, resolved.** ADR-0132 said the per-instance rule
  "cannot be configured away". ADR-0136 amends that: the A ≠ C and A ≠ P rules
  cannot be configured away; the C/F/P-among-themselves rules are lifted only by
  the audited `relaxed` mode.

#### SoD test matrix (required tests for the phase 3 implementing issue, #957)

Each row is an integration test against a real database as the runtime role,
asserting both directions (the permitted actor can; every other actor cannot). C,
A, F, P, S as above; Alice, Bob and Carol are distinct tenant users of one tenant
unless stated.

| #     | Mode      | Scenario                                                                                                | Expected                                                                                                                                                                | Layer                   |
| ----- | --------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SOD1  | strict    | Alice calculates, Bob approves, Carol pays                                                              | each step succeeds                                                                                                                                                      | all                     |
| SOD2  | strict    | Alice calculates then approves the same run                                                             | refused (`403`); no state change                                                                                                                                        | database + guard        |
| SOD3  | strict    | Bob approves, then Bob pays                                                                             | pay refused                                                                                                                                                             | database                |
| SOD4  | strict    | Alice calculates, Bob approves, Alice pays                                                              | pay refused                                                                                                                                                             | database                |
| SOD5  | strict    | Alice calculates, Bob approves, Alice finalizes; and Bob approves, Carol finalizes, Carol pays          | the first finalize refused; the second pay refused (F × P)                                                                                                              | database                |
| SOD6  | strict    | Alice calculates, Bob approves and finalizes, Carol pays                                                | succeeds (A × F allowed)                                                                                                                                                | database                |
| SOD7  | relaxed   | Alice calculates, Bob approves, Alice finalizes and pays                                                | succeeds; every audit row carries `sodMode: "relaxed"`                                                                                                                  | database + audit        |
| SOD8  | relaxed   | Alice calculates, Alice approves                                                                        | refused                                                                                                                                                                 | database                |
| SOD9  | relaxed   | Alice calculates, Bob approves, Bob pays                                                                | pay refused                                                                                                                                                             | database                |
| SOD10 | switch    | a run calculated in strict mode, then the tenant relaxes, then the run is finalized and paid by Alice   | the run stays strict (finalize or pay by the calculator refused)                                                                                                        | database (run stamp)    |
| SOD11 | switch    | a run calculated in relaxed mode, then the tenant tightens                                              | the run keeps `relaxed`; A ≠ C and A ≠ P still hold                                                                                                                     | database                |
| SOD12 | switch    | update `sod_mode` of a run after `calculate`                                                            | refused (immutable)                                                                                                                                                     | database trigger        |
| SOD13 | switch    | change the tenant mode without S                                                                        | `403`; setting unchanged; no audit row of a change                                                                                                                      | authorization           |
| SOD14 | switch    | change the mode with S, once with and once without an `Idempotency-Key`; the same key replayed          | missing key rejected; success writes exactly one `critical` audit row with before/after mode and no free text; replay returns the first result and writes no second row | idempotency + audit     |
| SOD15 | switch    | relax with S when the principal is enrolled in MFA and has no recent step-up; tighten in the same state | relax requires step-up; tighten does not                                                                                                                                | step-up (ADR-0058 §E)   |
| SOD16 | switch    | an invalid mode value, or a free-text note in the payload                                               | `400`; nothing stored                                                                                                                                                   | validation              |
| SOD17 | role      | assign S and any of C, A, F or P to one user (each of the four, and via two roles)                      | refused at assignment (`sod_conflict`); at action time a pre-existing holder is denied                                                                                  | SoD assignment + action |
| SOD18 | role      | assign C × A, A × P, K × A, U × A, R × P to one user                                                    | each refused at assignment, in both modes; no exception accepted                                                                                                        | SoD assignment          |
| SOD19 | role      | assign C and P to one user in strict mode, in relaxed mode                                              | assignment succeeds in both (these pairs are per-instance only); the strict second action is refused as in SOD4                                                         | assignment + database   |
| SOD20 | role      | attempt a time-bound C × P exception                                                                    | no such exception exists (withdrawn); the request is rejected                                                                                                           | SoD exceptions          |
| SOD21 | isolation | tenant T1 relaxed, tenant T2 strict; T2 user acts on a T2 run                                           | T2 stays strict; T1's setting and audit rows are invisible to T2 (RLS)                                                                                                  | RLS                     |
| SOD22 | machine   | an API token without the permission performs calculate, approve, pay or the mode change                 | refused (`403`)                                                                                                                                                         | authorization           |

Finalize, pay and reverse should require the principal's step-up where enrolled,
applied **conditionally** as ADR-0058 §E prescribes (an unconditional step-up is
the trap); the exact rule is decided in the phase 3 PR.

## 8. State machines

```
Attendance correction:  pending ──approve──> approved (appends superseding event)
                           │ ──reject──> rejected      └─withdraw─> withdrawn

Shift assignment:       draft ──publish──> published ──cancel──> cancelled
                          └─────────────cancel──────────────────> cancelled

Commission accrual:     pending ──approve──> approved ──release──> payable ──pay──> paid
                           │                   │                     │             │
                           └────void───────────┘                     └──reverse────┴─> reversed
                                (no money moved)                       (new negative row)

Payroll period:         open ──lock──> locked              (no unlock)

Payroll run:            draft ──calculate──> calculated ──approve──> approved
                          │  ^ recalc ┘          │                     │
                          │                      └──────cancel─────────┤
                          └────────cancel────────────────────────────> cancelled
                        approved ──finalize──> finalized ──pay──> paid
                        finalized|paid ──reverse──> reversed       (via a reversal run)

Payslip:                derived at finalize (immutable) ──release──> released
```

Every machine is enforced by a `BEFORE UPDATE` trigger that allows exactly those
transitions and, per transition, only the columns it may change (the ADR-0128 §4
pattern), so immutability is a property of the data, not of a handler. Attendance
events, transitions and run events are append-only (no UPDATE/DELETE privilege and
a trigger). Nothing in the family is hard-deleted by the application role.

## 9. ERD and data dictionary

```
awcms_profiles (profile_identity) <--(tenant_id,profile_id)-- awcms_hr_employments
awcms_tenant_users <--(0..1)-- awcms_hr_employments 1--n awcms_hr_employment_terms --> awcms_offices
                                       | 1--n  awcms_hr_attendance_events  1--n corrections
                                       | 1--n  awcms_hr_shift_assignments <-- awcms_hr_shift_templates
                                       | 1--n  awcms_hr_commission_accruals --> _commission_rules, _transitions
                                       | 1--n  awcms_hr_compensation, _payout_accounts
awcms_hr_payroll_periods 1--n awcms_hr_payroll_runs 1--n _run_lines, _payslips, _run_events
awcms_hr_pay_rule_sets 1--n awcms_hr_pay_rule_versions   (runs snapshot the version ids)
```

### Phase 1 (`hr_workforce`)

| Table                             | Holds                                                                            | `awcms_app` privileges                   | Classification                               |
| --------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `awcms_hr_workforce_settings`     | clock skew bound, correction workflow key; **no evidence setting**               | SELECT, INSERT, UPDATE                   | internal                                     |
| `awcms_hr_employments`            | `profile_id` FK, `employee_no`, `hired_on`, `tenant_user_id`, soft-delete stamps | SELECT, INSERT, UPDATE (no DELETE)       | confidential (links a person to an employer) |
| `awcms_hr_employment_terms`       | effective-dated office, manager, title, type, status                             | SELECT, INSERT, UPDATE (closing only)    | confidential                                 |
| `awcms_hr_attendance_events`      | append-only events                                                               | SELECT, INSERT                           | confidential (behavioural data)              |
| `awcms_hr_attendance_corrections` | proposed change, reason, workflow instance id, status                            | SELECT, INSERT, UPDATE (status only)     | confidential; reason text sensitive          |
| `awcms_hr_shift_templates`        | patterns                                                                         | SELECT, INSERT, UPDATE (soft delete)     | internal                                     |
| `awcms_hr_shift_assignments`      | UTC intervals, kind, status                                                      | SELECT, INSERT, UPDATE (status, publish) | confidential                                 |

### Phase 2 (`hr_commission`)

| Table                             | Holds                                      | `awcms_app` privileges               | Classification                      |
| --------------------------------- | ------------------------------------------ | ------------------------------------ | ----------------------------------- |
| `awcms_hr_commission_rules`       | versioned rules                            | SELECT, INSERT, UPDATE (draft only)  | confidential                        |
| `awcms_hr_commission_accruals`    | ledger; immutable facts + advancing status | SELECT, INSERT, UPDATE (status only) | confidential (earnings of a person) |
| `awcms_hr_commission_transitions` | append-only transition log                 | SELECT, INSERT                       | confidential                        |

### Phase 3 (`hr_payroll`)

| Table                         | Holds                                          | `awcms_app` privileges                                              | Classification |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | -------------- |
| `awcms_hr_compensation`       | effective-dated salary versions                | SELECT, INSERT, UPDATE (status only)                                | **sensitive**  |
| `awcms_hr_payout_accounts`    | bank or wallet reference, mask, hash           | SELECT, INSERT, DELETE (audited)                                    | **sensitive**  |
| `awcms_hr_payroll_periods`    | period and lock                                | SELECT, INSERT, UPDATE (lock only)                                  | confidential   |
| `awcms_hr_payroll_runs`       | run header, snapshot ids, totals, actor stamps | SELECT, INSERT, UPDATE (trigger-limited)                            | **sensitive**  |
| `awcms_hr_payroll_run_lines`  | per employee per element amounts               | SELECT, INSERT, UPDATE/DELETE while draft/calculated only (trigger) | **sensitive**  |
| `awcms_hr_payslips`           | derived immutable payslip                      | SELECT, INSERT, UPDATE (`released_at`, `acknowledged_at`)           | **sensitive**  |
| `awcms_hr_payroll_run_events` | append-only run event log                      | SELECT, INSERT                                                      | confidential   |
| `awcms_hr_pay_rule_sets`      | rule set identity                              | SELECT, INSERT, UPDATE                                              | internal       |
| `awcms_hr_pay_rule_versions`  | immutable effective-dated rules + citation     | SELECT, INSERT, UPDATE (draft only)                                 | internal       |

Money and quantity are `numeric`, decimal **strings** on the wire, never floats.
Every cross-table reference, including to `awcms_profiles`, `awcms_offices`,
`awcms_tenant_users` and between HR tables, is a
composite `(tenant_id, id)` foreign key, so RLS is not the only wall between an
employment and another tenant's data. Every foreign key is indexed
(`db:fk-index:check`). Phase 3 totals are computed by the database in exact
`numeric`; a client can never assert a state, total or snapshot (a body naming one
is a `400` that names the field).

## 10. Provisional events

Defined here only. The AsyncAPI channels, `ModuleDescriptor.events.publishes`
entries and producers land with the phase that owns them. The family namespace is
`awcms.hr.*`, following `awcms.<area>.<entity>.<verb>` (compare
`awcms.procurement.document.finalised`); the exact producer-module mapping is
confirmed when the first channel is added. All go through the domain-event outbox
**in the producing transaction**; a refused or replayed call publishes nothing.

| Event                          | Phase | When                                                                 | Payload (ids, kinds, counts only)                                                |
| ------------------------------ | ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `awcms.hr.attendance.recorded` | 1     | a new (non-replayed) attendance event is stored                      | `eventId`, `employmentId`, `kind`, `occurredAt`, `source`, `officeId`            |
| `awcms.hr.shift.assigned`      | 1     | an assignment becomes `published` (and on cancel, `cancelled: true`) | `assignmentId`, `employmentId`, `kind`, `startsAt`, `endsAt`, `cancelled`        |
| `awcms.hr.commission.accrued`  | 2     | a new accrual is posted (not a replay)                               | `accrualId`, `employmentId`, `sourceType`, `ruleKey`, `ruleVersion`, `operation` |
| `awcms.hr.commission.approved` | 2     | an accrual is approved                                               | `accrualId`, `employmentId`                                                      |
| `awcms.hr.payroll.finalized`   | 3     | a run is finalized                                                   | `runId`, `periodKey`, `kind`, `employeeCount`, `currencyCode`                    |
| `awcms.hr.payroll.reversed`    | 3     | a run is reversed                                                    | `runId`, `reversalRunId`, `periodKey`, `employeeCount`                           |

**No event carries an amount, a name, an identifier, a note or a reason.** A
finance consumer that needs totals reads them through an authorized read in its own
transaction. A single-employee tenant would otherwise leak a salary through an
"aggregate". Envelope: the `DomainEvent` message of
[`asyncapi/awcms-domain-events.asyncapi.yaml`](../../asyncapi/awcms-domain-events.asyncapi.yaml).
Consumers are in-tenant adapters; none is registered by this family.

## 11. Permissions, RLS, masking, audit and idempotency

### 11.1 Permissions and RLS matrix

All routes are `defineTenantRoute`, authorize through `authorizeInTransaction`
(ADR-0063), are default-deny, and every permission is seeded by its phase's
migration, granted to **no** role, and delivered to existing tenants by
`identity-access:permissions:backfill`. Keys are `<module>.<activity>.<action>`.
"**own**" = also reachable through an `ownershipGrant` on the persisted
`tenant_user_id` (§12). "scope" = the `office` business scope may bound it.

| Module · activity            | Actions (risk)                                                                                                                                               | Notes                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `hr_workforce` · employments | read (scope), create, update, delete, restore, **assign** (link account, high)                                                                               | `assign` is the self-service basis                   |
| · attendance                 | read (**own**, scope), create (**own** = clock; others for supervisor/kiosk)                                                                                 | replay-safe by `client_event_key`                    |
| · corrections                | read (**own**, scope), create (**own**), cancel (withdraw); decision via `workflow.*` permissions                                                            | approval required, fail-closed                       |
| · shifts                     | read (**own**, scope), create, update, **publish** (high), cancel                                                                                            | `shifts.*` never implies `compensation.*`            |
| · templates                  | read, create, update, delete                                                                                                                                 |                                                      |
| · settings                   | read, **configure** (high)                                                                                                                                   |                                                      |
| `hr_commission` · rules      | read, create, update, **publish** (high), **retire** (high)                                                                                                  |                                                      |
| · accruals                   | read (**own**, scope), create (port/adapter), **approve** (high), **cancel**=void (high), **release** (high), **pay** (high, new action), **reverse** (high) | beneficiary cannot approve own (self-approval guard) |
| `hr_payroll` · compensation  | read, create, **approve** (high)                                                                                                                             | salary; no list shows amounts without `read`         |
| · payout_accounts            | read (masked), update, **reveal** (high)                                                                                                                     | `no-store`, audited, step-up per phase 3 decision    |
| · periods                    | read, create, **lock** (high)                                                                                                                                | no unlock                                            |
| · runs                       | read (scope), create, **calculate** (high, new), **approve** (high), **finalise** (high), **pay** (high, new), **reverse** (high), cancel (high)             | §7.5                                                 |
| · payslips                   | read (**own**), **release** (high)                                                                                                                           | employee sees own after release only                 |
| · rules                      | read, create, **publish** (high), **retire** (high)                                                                                                          |                                                      |
| · sod_policy                 | read, **configure** (high, new resource; never held with C, A, F or P)                                                                                       | §7.5, ADR-0136                                       |

Tables: every one has `tenant_id`, RLS `ENABLE` + `FORCE`, a policy with `USING`
and `WITH CHECK`, tested as the runtime role (`awcms_app`) including that it
cannot read or write another tenant's rows. `awcms_worker` is granted `SELECT` only
on a projection source it reads. `awcms_app` holds **no DELETE** on any table except
the two the matrix names. **RLS separates tenants, not duties**: the separation
between a scheduler and salary is the permission and the separate tables, which is
why the availability adapter's SQL is tested not to name a payroll table.

### 11.2 Masking and sensitive data

| Datum                                | Where it lives                 | Shown                                                                                     | Never in                                   |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| Name, contact, address               | `profile_identity` only        | per `profile_identity` rules                                                              | any HR table, event, log                   |
| NIK, NPWP                            | `profile_identity` identifiers | masked; resolved server-side by a run when needed, never copied to a payslip as plaintext | HR tables, logs, audit, events, exports    |
| Salary / base amount                 | `awcms_hr_compensation`        | only to `compensation.read`; absent from list views                                       | logs, audit, events, other responses       |
| Bank/wallet account                  | `awcms_hr_payout_accounts`     | mask only; clear via one audited `reveal`                                                 | logs, audit, events, exports               |
| Payslip amounts                      | run lines, payslips            | owner (after release) and `payslips.read` / `runs.read`                                   | notifications (a notice carries no amount) |
| Attendance reason, correction reason | corrections                    | requester, approver, `corrections.read`                                                   | audit rows, events                         |
| Time-off kind                        | assignments                    | coarse kind only; no reason ever                                                          | —                                          |

`account_ciphertext`, `account_hash` and `account_mask` of payout accounts are `redactedColumns` and
never ride in an export. Money in a response is a decimal string; in a log it is
absent.

### 11.3 Audit and idempotency

| Action                                    | `Idempotency-Key`        | Audit level                                             | Replay                                                           |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------- |
| employment create / terms change          | yes                      | info                                                    | unique `employee_no`                                             |
| link or change `tenant_user_id`           | yes                      | warning                                                 | state check                                                      |
| attendance event                          | yes + `client_event_key` | none (high volume; the event IS the record)             | returns the original                                             |
| correction request / decision             | yes                      | info                                                    | state check; workflow decision is audited by `workflow_approval` |
| shift publish / cancel                    | yes                      | info                                                    | state check                                                      |
| commission accrue (adapter)               | yes                      | info                                                    | source identity returns the original                             |
| accrual approve / release / pay / reverse | yes                      | warning (reverse: critical)                             | state check + unique reversal                                    |
| compensation propose / approve            | yes                      | warning                                                 | state check                                                      |
| payout account add / remove               | yes                      | warning                                                 | uniform acknowledgement (no oracle)                              |
| payout account **reveal**                 | no (a read)              | warning, records THAT a disclosure happened, never what | —                                                                |
| period lock                               | yes                      | critical                                                | state check                                                      |
| run create / **calculate**                | yes                      | info / warning                                          | unique `(period, run_no)`; state check                           |
| run **approve**                           | yes                      | warning                                                 | state check                                                      |
| run **finalize**                          | yes                      | warning                                                 | state check; second finalize returns the first                   |
| run **pay**                               | yes                      | warning                                                 | state check; unique payment per run                              |
| run **reverse**                           | yes                      | critical                                                | once per run (partial unique index)                              |
| rule publish / retire                     | yes                      | warning                                                 | state check                                                      |

No audit row carries an amount, a name, an identifier, a note or a reason text; the
correlation id joins the audit row, the outbox event and any ledger row. Replays
audit nothing.

## 12. RBAC/ABAC acceptance scenarios (testable statements)

Each statement is an integration test the implementing issue must write against a
real database as the runtime role, passing both ways (the named actor can; every
other actor cannot). "Mechanism" is what already exists in this repository.

| #   | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                             | Mechanism                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | An employee with only the base role reads **their own** attendance events and **cannot** read another employee's (both `403`).                                                                                                                                                                                                                                                                                                                        | `ownershipGrant` for `attendance.read`, computed server-side from `employment.tenant_user_id === ctx.tenantUserId`; widens only, ABAC/tenant/SoD still deny; the decision log records `ownership_grant:<reason>`.                          |
| S2  | An employee reads **their own released payslip** and cannot read it before release, nor anyone else's.                                                                                                                                                                                                                                                                                                                                                | `ownershipGrant` on `payslips.read` plus a state predicate (`released_at IS NOT NULL`) in the handler's query; no new attribute.                                                                                                           |
| S3  | An employee clocks in for themself; the same employee cannot record attendance for a colleague.                                                                                                                                                                                                                                                                                                                                                       | `ownershipGrant` on `attendance.create` limited to the own employment; recording for others needs the unmodified `attendance.create` key.                                                                                                  |
| S4  | A supervisor assigned to office O reads attendance and corrections for employments **in O and its descendants**, not for another office.                                                                                                                                                                                                                                                                                                              | `office` business scope with `requiredScopeType=office`, `requiredScopeId=<employment office>`, `requiredScopeRelations=["exact","descendant"]` and the existing hierarchy adapter (ADR-0060); unresolved scope denies a high-risk action. |
| S5  | A supervisor can approve a correction for a report but **cannot approve their own** correction.                                                                                                                                                                                                                                                                                                                                                       | `workflow_approval` decision + the existing self-approval guard (`approve` with `requestedByTenantUserId`).                                                                                                                                |
| S6  | A manager sees their direct reports even where they hold no scope on the reports' office.                                                                                                                                                                                                                                                                                                                                                             | a server-computed `ownershipGrant` reason (`manager_of`) from the persisted manager chain; **not** an ABAC attribute (`resource.managerTenantUserId` would need its own admission and is not assumed).                                     |
| S7  | A scheduler holding `shifts.*` creates and publishes assignments and **receives `403` on every `compensation.*`, `payout_accounts.*`, `runs.*` and `payslips.*` route.**                                                                                                                                                                                                                                                                              | RBAC default-deny: separate permissions, none granted by the scheduler role; separate tables.                                                                                                                                              |
| S8  | The availability adapter, run with a tenant-scoped `tx`, returns working intervals and **nothing else**; its SQL never names a compensation or payroll table.                                                                                                                                                                                                                                                                                         | `StaffAvailabilityPort` allow-list DTO; a source-text test over the adapter (the same style as `access:chokepoint:check`).                                                                                                                 |
| S9  | The user who calculated a run **cannot approve it**; the approver **cannot pay** it; a user holding both permissions is refused at role assignment (C × A, A × P) or at action time, in both SoD modes.                                                                                                                                                                                                                                               | DB CHECKs on the run row (`approved_by <> calculated_by`, `paid_by` distinct) **and** `sodRules` over the permission keys (`global_within_tenant`, `critical`); self-approval guard on `approve`.                                          |
| S9a | In `relaxed` SoD mode one person may calculate and pay a run, but the approver still **cannot** be the calculator or the payer (both refused by the database); switching a tenant to `relaxed` without the configure permission (`hr_payroll.sod_policy.configure`) is `403`, and with it writes a `critical` audit row with the before/after mode and no free text; a run calculated in `strict` mode stays strict if the tenant relaxes afterwards. | DB CHECKs conditional on the run's immutable `sod_mode`; settings permission; audit row.                                                                                                                                                   |
| S10 | A user who changes an employee's compensation cannot approve a payroll run that includes them; compensation proposed by A cannot be approved by A.                                                                                                                                                                                                                                                                                                    | SoD rule K × A; `approved_by <> proposed_by` CHECK; self-approval guard.                                                                                                                                                                   |
| S11 | A CRM marketer (holding `crm.*` and `profile_identity.profile_management.read`) and a receptionist (holding booking and shift-read only) receive `403` on every `compensation`, `payout_accounts`, `runs`, `payslips` and `commission.accruals` route and see **no salary or national id** through the profile list (names only; identifiers masked).                                                                                                 | RBAC default-deny: no `hr_*` payroll permission; `profile_identity` masking is unchanged; payroll tables are unreachable without their own keys.                                                                                           |
| S12 | Revealing a payout account without `payout_accounts.reveal` is `403`; with it the response is `no-store`, an audit row at `warning` records that it happened and by whom but never the value.                                                                                                                                                                                                                                                         | `reveal` high-risk action; the procurement reveal pattern.                                                                                                                                                                                 |
| S13 | With the module disabled for tenant T, every route of that module is denied for T and T's tables are untouched; T2's payroll is unaffected.                                                                                                                                                                                                                                                                                                           | module enable/disable (`awcms_tenant_modules`); FORCE RLS.                                                                                                                                                                                 |
| S14 | A machine credential (API token) cannot exercise an `ownershipGrant`.                                                                                                                                                                                                                                                                                                                                                                                 | ADR-0063 §A excludes machine credentials.                                                                                                                                                                                                  |
| S15 | A request supplying another tenant's `employment_id`, `profile_id` or `office_id` is rejected, even if the id exists.                                                                                                                                                                                                                                                                                                                                 | composite `(tenant_id, id)` FKs plus FORCE RLS; the handler re-reads inside `withTenant`.                                                                                                                                                  |

**What needs a new admission, said plainly.** Per-report scoping through an ABAC
_policy_ (rather than a server-computed ownership reason), a payroll-grade or
cost-centre scope, and an HR org-unit tree (§4.1 follow-up) each need either a new
ABAC allow-list attribute or a new business-scope type with an adapter extension.
None is assumed; the scenarios above are satisfiable without them.

## 13. Threat and privacy analysis

### 13.1 Threats

| Threat                                                            | Control                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant read or write of employment or pay data              | FORCE RLS + composite FKs + `defineTenantRoute`; RLS tested as `awcms_app`                                                                                                                                      |
| Scheduler or marketer reading salary (horizontal in-tenant)       | separate permissions and tables; S7, S11; the availability port is an allow-list                                                                                                                                |
| Self-service abuse: employee reading another's payslip/attendance | `ownershipGrant` computed from the persisted link, never from the request; machine credentials excluded                                                                                                         |
| Account-link hijack: linking my login to a colleague's employment | `assign` is high-risk, audited, SoD-able; changing it is an event                                                                                                                                               |
| Payroll fraud: insider alters salary, runs and pays               | propose/approve compensation; C/A/P per-instance DB CHECKs; immutable finalized runs; period lock; reversal-only correction                                                                                     |
| Double payment (double click, retry, replay)                      | state check + `Idempotency-Key` + unique payslip per period/employee + unique payment per run                                                                                                                   |
| Attendance tampering (back-dating, ghost clock-ins)               | append-only events, server `recorded_at`, supersession by approved correction, skew bound; no editing                                                                                                           |
| Time-theft by a colleague clocking in for another                 | clocking for another requires the unmodified key, audited by `source` and actor; geolocation evidence, if ever built, is §4.3 (O6)                                                                              |
| Ledger inflation by forged commission source                      | unique source identity; the adapter's duty to verify (documented); `approve` by a third party                                                                                                                   |
| Leakage through events, logs, exports, notifications              | ids/counts only; money absent from logs; `redactedColumns`; payslip notices carry no amount                                                                                                                     |
| Plaintext payout accounts at rest                                 | ciphertext only, keyed HMAC for lookup, key ring with rotation, fail-closed on a missing key: [ADR-0137](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md) (**decided, not yet implemented**) |
| Brute-forcing a payout account from the hash column or a dump     | HMAC under a separate tenant-bound key (never an unkeyed hash); keys outside the database and its backups; restore without the key cannot reveal (ADR-0137 §3, §6)                                              |
| Bulk harvesting of accounts through `reveal`                      | `reveal` is HIGH-RISK, `no-store`, audited at `warning`, conditional step-up, per-actor rate limit, `403` without the permission (ADR-0137 §4)                                                                  |
| Existence oracle (is X an employee? is X scheduled?)              | `unknown` is indistinguishable; uniform acknowledgements for identifier adds                                                                                                                                    |
| Rule tampering (a tax rate changed to under-withhold)             | rule versions immutable once published, published by maker/checker, citation required, audit at `warning`                                                                                                       |
| Backdated pay change after a period closed                        | period lock; `backdate` high-risk; no unlock                                                                                                                                                                    |
| Provider call inside a transaction                                | none; any bank/provider integration goes through the outbox in a later issue                                                                                                                                    |
| Offline replay of attendance forging time                         | `client_event_key` uniqueness; `late` flag for review; correction needs approval                                                                                                                                |

### 13.2 Privacy (UU PDP 27/2022)

This is a design analysis, not legal advice; applicability is a per-deployment
assessment.

- **Data subjects and categories.** Employees and workers. General personal data:
  identity (via `profile_identity`), employment, attendance and schedule.
  Financial: salary, bank account, withholding. **Specific personal data** under the
  law must be treated with extra care: health (sick-leave reasons: hence no time-off
  reason is stored), and potentially biometric or geolocation data (hence photo, biometric and device evidence are excluded for good, and geolocation evidence is off by default and verdict-only, ADR-0138, O6).
- **Lawful basis and purpose.** Processing is for the employment relationship and
  the employer's legal obligations (labour, tax, social security). Each column has
  a stated purpose through its `subjectData` rationale; data beyond that purpose
  (photo, precise location) is not collected.
- **Controller / processor (O5).** Whether the platform operator is controller,
  processor or both **per deployment** decides who answers subject requests, who
  signs processing terms, and who notifies a breach. It is **owner decision O5 and
  open**. What is designed regardless: per-tenant isolation, subject-data coverage
  for every table (ADR-0094), and an export that carries masked values.
- **Minimisation.** No copy of identity fields; no evidence; coarse time-off kind;
  events without amounts; payslip notices without amounts; NIK and NPWP stay in
  `profile_identity`.
- **Subject rights.** Access and portability: the `subject-data` export covers every
  table with masked values. Rectification: effective-dated history is corrected by
  appending, not editing, so the audit trail stays valid. Erasure: **limited by
  legal retention** — employment, attendance used for pay, payroll and tax records
  are retained for the periods the employer's counsel identifies (not asserted
  here), then purged by `data_lifecycle`; erasure of the _profile_ anonymises the
  name, while HR rows remain and resolve to the anonymised profile (the ADR-0128 §7
  posture), and a payslip is a snapshot that does not rewrite.
- **Retention.** Attendance events and shift history are bounded by a `data_lifecycle`
  descriptor; financial rows are retained for the life of the tenant until an
  archive-then-purge design exists (a recorded follow-up, as ADR-0128 §7).
- **Security safeguards.** Encryption in transit; access control above; payout
  accounts encrypted at rest (design in ADR-0137, to be implemented before phase 3 ships); audit of reveals; backup handling
  follows the existing runbooks, and a restore requires the reconciliations in §14.
- **Breach readiness.** Audit and the decision log answer "who read what"; the
  notification duties follow the O5 outcome.
- **Impact assessment.** Phase 1 (no evidence) is a routine employment-data
  processing; phase 3 and any evidence feature require a documented impact
  assessment before implementation.

## 14. Rollout, rollback and operations

Each phase ships as ordinary issues: migration (forward-only), OpenAPI, AsyncAPI,
tests (RLS as `awcms_app`, every high-risk guard both ways, the state-machine
triggers, concurrency on the conflict rule and on idempotent finalize), a security
review (the family is a "sensitive module" under AGENTS.md), and module registration
`experimental` until its admin screens land. To stop using a module: stop calling
it and disable it per tenant; the tables are inert. Dropping them is a
restore-class decision. After any restore, run the workforce reconciliation and,
for phase 3, the payroll reconciliation (lines sum to run totals, payslips sum to
lines, no payslip without a finalized run), together: attendance, commission and
payroll must come back from the same point in time.

## 15. Known limits and follow-ups

- Leave balances and accrual, loans, benefits, overtime _policy_ negotiation, and
  accounting posting are non-goals.
- No HR org-unit hierarchy (office is the unit); no manager-line ABAC attribute.
- Reveal of a payout account: step-up conditional on an enrolled factor and a
  per-actor rate limit, decided in ADR-0137 §4 (not unconditionally, ADR-0058 §E);
  the implementation is a later issue.
- Merge guard between two actively-employed profiles (landed, #945), the
  `btree_gist` question (decided: advisory-lock trigger, #946) and the `AccessAction` additions (`calculate`, `pay`) are implementation-time.
- Archive-then-purge for financial rows, admin screens, and bank-file output are
  later issues.
- `awcms_profile_entity_links` may additionally be written for discovery ("which
  module links this profile"); optional, follow-up.
- Owner answers recorded 2026-10-10 that need their own work before any
  implementation: an ADR amending ADR-0132 for the configurable SoD mode (§7.5)
  and its open sub-question O7a; geolocation attendance evidence is now
  decided in ADR-0138 (verdict-only, off by default; §4.3) and needs only its
  follow-up implementation issue, with a per-tenant DPIA before enabling.
  implementation: the configurable SoD mode and its sub-question O7a are decided by
  ADR-0136 (§7.5; enforcement lands in #957); an ADR for geolocation attendance evidence,
  after a data-protection impact assessment (§4.3).
- Delivery channels (O10, O11): the owner admitted a Telegram adapter (optional,
  off by default) and wants notification orchestration. Neither changes this
  pack: payslip notices carry no amount (ADR-0132) and, per ADR-0133 §7, must
  never reach Telegram or any fallback channel. Telegram is admitted by ADR-0140
  for operational and staff alerts only (implementation #965), so payroll,
  payslip and personal-data messages are refused by its registry. O11 is resolved by ADR-0139:
  notification orchestration is not admitted for now, so payroll notices have
  no cross-channel fallback or preference engine to depend on.

## 16. Open questions (owner decisions — answered ones marked, the remainder open)

Tracked downstream in `ahliweb/awcms-one` `docs/aw-business-platform-dor.md`. The owner answered O1–O12 on 2026-10-10; the rows below record the answers that bind this pack (O4, O6, O7). O1 and O5 were answered the same day but change nothing here and are not yet reconciled into this pack. ADR-0132 itself closes none of them.

| Id  | Question                                                                                                                                      | Why it matters here                                                                          | Blocks                                              | This pack's stance                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Scope and sequencing of the platform epic as tracked downstream (whether the phases ship together, in order, or per consumer)                 | The three phases are designed to ship one by one; a consumer may want payroll with workforce | the order of implementing issues                    | Designed to ship in order; payroll never ships before its gate                                                                                                                                                                  |
| O4  | Indonesian payroll profile: PPh 21 only, or BPJS, overtime, holiday allowance as well; and whether it is upstream seed data or consumer-owned | Regulatory content must be effective-dated and traceable; scope drives size and legal review | nothing (was: phase 3 gate)                         | **Answered 2026-10-10:** owned by each consumer; upstream ships only the engine and effective-dating, no Indonesian rates (§7.3)                                                                                                |
| O5  | Legal role of the platform operator per deployment: controller, processor or both                                                             | Decides subject-request ownership, processing terms, breach notification                     | privacy analysis, retention                         | Designed for per-tenant isolation either way (§13.2)                                                                                                                                                                            |
| O6  | Whether attendance may ever use geolocation, photo or device evidence                                                                         | Specific/biometric personal data; decides whether it is in any design at all                 | ADR-0138                                            | **Answered 2026-10-10:** geolocation only (no photo, biometric or device fingerprint), off by default per tenant; **decided in ADR-0138 (2026-10-12)**, built only by a follow-up issue, DPIA per tenant before enabling (§4.3) |
| O7  | Segregation of duties for payroll: who may calculate, approve, finalize, pay                                                                  | Authorization matrix and minimum ABAC scenarios; small-tenant impact                         | phase 3 gate (ADR-0132 amendment, sub-question O7a) | **Answered 2026-10-10:** configurable per tenant; default calculate != approve != pay; may relax to prepare != approve, the relaxation audited (§7.5)                                                                           |
| Id  | Question                                                                                                                                      | Why it matters here                                                                          | Blocks                                              | This pack's stance                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------   | ---------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                 |
| O1  | Scope and sequencing of the platform epic as tracked downstream (whether the phases ship together, in order, or per consumer)                 | The three phases are designed to ship one by one; a consumer may want payroll with workforce | the order of implementing issues                    | Designed to ship in order; payroll never ships before its gate                                                                                                                                                                  |
| O4  | Indonesian payroll profile: PPh 21 only, or BPJS, overtime, holiday allowance as well; and whether it is upstream seed data or consumer-owned | Regulatory content must be effective-dated and traceable; scope drives size and legal review | nothing (was: phase 3 gate)                         | **Answered 2026-10-10:** owned by each consumer; upstream ships only the engine and effective-dating, no Indonesian rates (§7.3)                                                                                                |
| O5  | Legal role of the platform operator per deployment: controller, processor or both                                                             | Decides subject-request ownership, processing terms, breach notification                     | privacy analysis, retention                         | Designed for per-tenant isolation either way (§13.2)                                                                                                                                                                            |
| O6  | Whether attendance may ever use geolocation, photo or device evidence                                                                         | Specific/biometric personal data; decides whether it is in any design at all                 | any geolocation-evidence ADR                        | **Answered 2026-10-10:** geolocation only (no photo, biometric or device fingerprint), off by default per tenant; still needs its own ADR after a DPIA (§4.3)                                                                   |
| O7  | Segregation of duties for payroll: who may calculate, approve, finalize, pay                                                                  | Authorization matrix and minimum ABAC scenarios; small-tenant impact                         | nothing (was: phase 3 gate; ADR-0136 decided O7a)   | **Answered 2026-10-10:** configurable per tenant; default calculate != approve != pay; may relax to prepare != approve, the relaxation audited (§7.5, ADR-0136)                                                                 |

## 17. Phase-3 review record (Issue #956)

> **Status: security review recorded; legal review NOT done.** This section is
> the evidence required by the phase 3 gate (§1). It records a **desk review of
> the design as written** (this pack, ADR-0132, ADR-0136, ADR-0137, ADR-0138)
> against the security review prompt of doc 12 (secrets, auth, tenant context,
> ABAC default-deny, RLS, audit, idempotency, masking, safe errors) and the
> threat table of §13.1. **No payroll code exists (phase 1 employment link excepted, PS-14), so nothing here is a test result.**
> The legal half needs human counsel and is a checklist (§17.3) with a blank
> sign-off (§17.4). **#957 and every later payroll implementation issue stay
> blocked until (a) counsel signs §17.4 and (b) the blocking findings of §17.2
> are written into the design and the issues' acceptance.** Issue #956 stays
> open until both are done. Control C-24 (regulatory review of a deployment's own
> rule data) is per deployment and is not replaced by this review.

### 17.1 Method and severity scale

Each area the issue names was read against the pack text and ADRs, and against
what the repository already enforces (`authorizeInTransaction`, FORCE RLS,
composite FKs, SoD descriptors, `requireStepUp`, idempotency, audit redaction).
Severity: **Blocking** = the design as written is unsafe or ambiguous in a way
that changes the schema or the SoD model, so the control must be amended into
the design before **#957** starts; **Required** = a control the named issue must
implement and test (added to that issue's acceptance by comment); **Low** =
hygiene. "OK" means the design, if implemented as written, meets the checklist
for that area; it is not a claim about code.

### 17.2 Results by area

| Area                                                                                                                                                                                                                                                                                                                 | Verdict                                                                                                                                                                                           | Findings                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Authorization matrix, default-deny, seeds granted to no role (§11.1)                                                                                                                                                                                                                                                 | OK, with one split                                                                                                                                                                                | PS-06                              |
| SoD: role-level rules, per-instance database CHECKs, strict and relaxed modes (§7.5, ADR-0136)                                                                                                                                                                                                                       | OK for the C/A/F/P pairs; gaps for payee-as-actor, reversal and stamp provenance                                                                                                                  | PS-01, PS-02, PS-05                |
| RLS and composite FKs (§9, §11.1)                                                                                                                                                                                                                                                                                    | OK (FORCE, `USING` + `WITH CHECK`, every reference composite, runtime-role tests required)                                                                                                        | PS-20 (test scope)                 |
| Immutability of finalized runs (§7.4, §8)                                                                                                                                                                                                                                                                            | OK (trigger per transition and column; no DELETE)                                                                                                                                                 | PS-20 (test scope), PS-03          |
| Immutability of published rule versions (§7.3)                                                                                                                                                                                                                                                                       | Finding                                                                                                                                                                                           | PS-07                              |
| Rule engine: no code execution, bounded evaluation (§7.3)                                                                                                                                                                                                                                                            | No code execution OK (closed kinds, no expression engine); bounds not specified                                                                                                                   | PS-08                              |
| Decimal money handling (§9)                                                                                                                                                                                                                                                                                          | Finding                                                                                                                                                                                           | PS-09                              |
| Idempotency on calculate, approve, finalize, reverse (§11.3)                                                                                                                                                                                                                                                         | Keys and state checks OK; binding and concurrency unspecified                                                                                                                                     | PS-03, PS-10                       |
| Audit and redaction: salary, payout account (§11.2, §11.3)                                                                                                                                                                                                                                                           | OK for writes and reveal; reads are not audited                                                                                                                                                   | PS-18                              |
| Payout encryption, reveal, step-up (ADR-0137)                                                                                                                                                                                                                                                                        | OK (AES-256-GCM v2 with key id and AAD, separate HMAC key ring, fail-closed, conditional step-up, rate limit); issue text diverges; removal and swap gaps; step-up has no teeth without enrolment | PS-11, PS-12, PS-13                |
| Payslip access and ownership (§12 S2, #961)                                                                                                                                                                                                                                                                          | OK in principle; the ownership link is the weak point                                                                                                                                             | PS-14                              |
| Period lock (§7.2)                                                                                                                                                                                                                                                                                                   | Finding (preconditions)                                                                                                                                                                           | PS-15                              |
| Reversal semantics (§7.4, §8)                                                                                                                                                                                                                                                                                        | Finding                                                                                                                                                                                           | PS-02                              |
| Backup and restore with keys (ADR-0137 §6, §14, #968)                                                                                                                                                                                                                                                                | OK (keys outside the database and its backups; restore with and without the ring both rehearsed)                                                                                                  | note for #968 below                |
| Subject rights and retention for payroll data (§13.2)                                                                                                                                                                                                                                                                | Finding (privacy process and descriptors)                                                                                                                                                         | PS-04, PS-17                       |
| Reporting projections leakage (§10, §11)                                                                                                                                                                                                                                                                             | Events OK (ids and counts only); projections and exports ungated                                                                                                                                  | PS-18                              |
| Denial of service by large runs                                                                                                                                                                                                                                                                                      | Finding                                                                                                                                                                                           | PS-16                              |
| Commission port into a run (#962)                                                                                                                                                                                                                                                                                    | Finding                                                                                                                                                                                           | PS-19                              |
| Offline/LAN profile and sync                                                                                                                                                                                                                                                                                         | Finding (low)                                                                                                                                                                                     | PS-20                              |
| Documentation hygiene                                                                                                                                                                                                                                                                                                | Finding (low)                                                                                                                                                                                     | PS-21                              |
| Checklist items with no finding: no secrets in repo (keys are env-only, `secret: true`, no default); safe errors (a body naming a client-asserted state is a `400` that names the field; the canary test of #959 covers account numbers); provider calls (none; outbox later); AI read-only (no AI path in the pack) | OK                                                                                                                                                                                                | extend the canary to salary: PS-18 |

#### Findings

| Id        | Severity     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Required control                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Implemented by                            |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **PS-01** | **Blocking** | **The payee can be the actor.** The SoD matrix separates duties but never says that the person acting on a run or on a compensation version may be the person it pays. An approver whose own login is linked to an employment in the run approves their own pay; the same holds for `compensation.create/approve` on their own employment (S10 covers only K × A).                                                                                                                                                                                                                                      | No actor may calculate, approve, finalize or pay a run that contains a line for the employment linked to their own `tenant_user_id`, and none may propose or approve compensation for their own employment. Enforced in the database path (trigger comparing the stamp with `employment.tenant_user_id`) and in the handler; refusal is `403`. Add SoD tests SOD23–SOD24 (own line in run; own compensation).                                                                   | #957 (+ #960 tests)                       |
| **PS-02** | **Blocking** | **Reversal has no SoD and a paid-run reversal can pay twice.** (a) `reverse` (R) is constrained only against P; nothing stops the person who calculated, approved or finalized the original from reversing it, nor requires a second person to approve the reversal run. (b) §7.4 reverses a finalized or **paid** run and then "a fresh regular run recalculates"; money already recorded as paid is not recovered by the reversal, so the replacement run pays the employee again. #962 compounds it ("reversal re-opens" the accruals).                                                              | (a) A reversal run follows the same calculate/approve chain; `reversed_by` and the reversal run's approver differ from the original run's `paid_by`, and R is added to the per-instance rules (decision recorded in an ADR amendment: R × C, R × A). (b) Decide and record before #957 fixes the columns: reversal of a **paid** run produces a recovery (receivable/netting) line or is refused in favour of adjustment lines in the next open period. Legal input §17.3 Q-L9. | #957 (columns, CHECKs), #960 (flow), #962 |
| **PS-03** | **Blocking** | **Approval is not bound to what the approver saw.** `calculated` can recalculate; an approver who opened a screen can approve numbers the preparer has since changed (a time-of-check/time-of-use hole), or a replayed approve can land on a recomputed run.                                                                                                                                                                                                                                                                                                                                            | The run carries a monotonically increasing `calculation_revision` and a totals digest, both written by the database on every calculate; `approve` and `finalize` must carry the revision they read and are refused (`409`) when it differs; the run row is locked (`FOR UPDATE`) during any transition.                                                                                                                                                                         | #957 (columns), #960                      |
| **PS-04** | **Blocking** | **The documented impact assessment does not exist.** §13.2 says phase 3 requires a documented impact assessment before implementation. No issue tracked it.                                                                                                                                                                                                                                                                                                                                                                                                                                             | A documented DPIA for phase 3 processing, linked from the gate row, before #957. Needs the data protection owner and counsel (§17.3 Q-P6).                                                                                                                                                                                                                                                                                                                                      | **#976** (new)                            |
| **PS-05** | Required     | **Stamp provenance and SoD identity.** CHECKs compare stamp columns; if a handler writes them, a bug or crafted path forges the comparison. SoD is also per `tenant_user`; if one human can hold two logins in a tenant, the CHECKs compare two ids for one person.                                                                                                                                                                                                                                                                                                                                     | Actor stamps are set from the authenticated session (a transaction-local setting read by the trigger), never from the request or handler parameters; a test proves a handler-supplied stamp is ignored or refused. Confirm and test whether two tenant users can map to one principal in a tenant; if so, compare principal ids. Strict-mode late refusal (the second action, not the role assignment) is accepted and must be documented in the admin screen.                  | #957                                      |
| **PS-06** | Required     | **One read permission exposes every salary.** `runs.read` covers header, totals and per-employee lines; a finance reader who needs totals can see every employee's pay.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Split `runs.read` (header, totals, counts) from `run_lines.read` (per-employee amounts, office-scoped), both granted to no role by the migration; `payslips.read` for other employees likewise separate from own-payslip ownership.                                                                                                                                                                                                                                             | #957 (catalog, seeds)                     |
| **PS-07** | Required     | **Rule versions: overlap, selection date, tamper evidence, retire.** "Draft-only editing" and "maker/checker" are stated, but not: non-overlapping effective ranges per rule set (two published versions in force on one date is ambiguous); which date selects a version for a period (start, end, pay date); a per-instance `published_by <> authored_by`; a content hash proving the published parameters were not altered by a privileged database role; and that `retire` is a stamp-only transition, not an edit. A version published with an effective date inside a finalized period is silent. | Exclusion/uniqueness so at most one published version per rule set is in force per date (the `btree_gist` question, §15, is resolved here); the selection date fixed in the design and recorded on the run; CHECK `published_by <> authored_by`; `content_digest` over canonical parameters computed at publish and verified at calculate; `retire` limited to its stamp columns by trigger; the citation, effective date and named reviewer NOT NULL and non-blank at publish. | #958                                      |
| **PS-08** | Required     | **Rule evaluation is closed but not bounded.** No `eval` (good) but no limits: bracket count, lookup size, parameter size, component dependency order or cycles, numeric range, `NaN`/`Infinity` (PostgreSQL `numeric` accepts `NaN`).                                                                                                                                                                                                                                                                                                                                                                  | Strict schema validation at draft and again at publish (unknown keys rejected); caps on tiers, lookup rows, parameter bytes and rules per set; components evaluated in a topological order validated acyclic at publish; percent and amount ranges bounded; finite values only (CHECK `amount = amount` style guard); the rounding mode and rounding point recorded on the version.                                                                                             | #958                                      |
| **PS-09** | Required     | **Decimal discipline is stated for the wire and totals, not for line computation.** A percent of a base computed with a JavaScript `Number` loses cents silently; currency mismatch between compensation and run is unaddressed.                                                                                                                                                                                                                                                                                                                                                                        | Money columns declared `numeric(p,s)` with explicit scale; line amounts computed in SQL `numeric` or with scaled-integer arithmetic and the recorded rounding mode, never `Number`; a source test forbids `Number`/`parseFloat` on money identifiers; one `currency_code` per run and any mismatch refused.                                                                                                                                                                     | #957, #960                                |
| **PS-10** | Required     | **Idempotency binding and concurrency.** A key must bind to the payload hash (same key, different body is an error), and `calculate` racing `calculate`, or `approve` racing recalculation, needs a defined winner. "Unique payment per run" must hold under two concurrent `pay` calls.                                                                                                                                                                                                                                                                                                                | Payload-hash binding on every high-risk mutation (the repository's idempotency helper); run row `FOR UPDATE` on every transition; unique `(period, run_no)` with retry; partial unique index for payment and reversal; concurrency tests for double calculate, double approve, double finalize, double pay.                                                                                                                                                                     | #960                                      |
| **PS-11** | Required     | **#959 acceptance contradicts ADR-0137.** #959 asks for a **critical** reveal audit and "reveal without step-up refused"; ADR-0137 §4 and §11.3 decide **warning** and a step-up **conditional** on an enrolled factor (ADR-0058 §E: unconditional is the trap).                                                                                                                                                                                                                                                                                                                                        | Align #959 to the ADR (or amend the ADR); a missing step-up where required is `403 STEP_UP_REQUIRED`, and the unenrolled case is recorded in the audit row. The per-actor rate limit's window and count are chosen and tested in #959.                                                                                                                                                                                                                                          | #959                                      |
| **PS-12** | Required     | **Account removal and swap.** The privilege table gives `awcms_app` DELETE on payout accounts: an insider adds an account, gets paid, deletes it, and only an audit row remains. Changing an account just before payment is the standard payroll fraud and has no control beyond a `warning` row.                                                                                                                                                                                                                                                                                                       | Removal is a `retired_at` stamp (soft retire), physical removal only through `data_lifecycle`; a payslip/line stores the `payout_account_id` it was calculated against; `pay` and finalize refuse (or flag for review) a run whose employment changed its account after the approved calculation; changing another person's account is proposed/confirmed by two actors or notifies the employee out of band (no account details in the notice).                                | #959, #960                                |
| **PS-13** | Required     | **Conditional step-up has no teeth without enrolment.** A holder with no MFA factor performs reveal, relax-SoD, approve, finalize, pay, reverse with no second factor; "enforceable through the tenant MFA policy" is unbuilt.                                                                                                                                                                                                                                                                                                                                                                          | Enrolment required to hold or exercise the payroll-critical permissions, with a bootstrap path and a readiness report, never an unconditional step-up.                                                                                                                                                                                                                                                                                                                          | **#977** (new)                            |
| **PS-14** | Required     | **The ownership link is the payslip key.** Whoever holds `employments.assign` can link their own login to a colleague's employment and read that person's payslips; a re-link later hands historical payslips to the new login. The phase 1 link as landed (#945) does not refuse a self-link, does not check that the login's profile matches, and treats a re-link like a first link.                                                                                                                                                                                                                 | Refuse a link to the assigner's own login; validate that the linked tenant user belongs to the same profile as the employment; re-linking after any payslip release needs step-up and a `critical` audit row with before/after ids and revokes the former owner; a payslip another user asks for returns `404` (not `403`: no existence oracle, #961).                                                                                                                          | #961, **#979** (new, phase 1 link)        |
| **PS-15** | Required     | **Period lock preconditions are unspecified.** What happens to a locked period with a `draft`/`calculated` run; and where a reversal's adjustment lines go when no next open period exists; who may lock.                                                                                                                                                                                                                                                                                                                                                                                               | Lock refused while any run in the period is non-terminal; a defined behaviour when no open period exists (the next period must be created first, else the reversal is refused); `lock` stays `critical`, idempotent and never combined with C, A, F or P in one actor under strict mode.                                                                                                                                                                                        | #960                                      |
| **PS-16** | Required     | **Large runs are unbounded.** Calculate over every employee and finalize creating one payslip per employee inside one request transaction hold locks and memory proportionally to headcount; list reads are not stated as paginated.                                                                                                                                                                                                                                                                                                                                                                    | Bounded batches or a lease-guarded job for calculate and payslip generation (resumable, idempotent, one active calculation per tenant), statement timeout, a maximum employees-per-run, keyset-paginated lists, per-actor rate limit on calculate.                                                                                                                                                                                                                              | #960, #961                                |
| **PS-17** | Required     | **Retention and subject-data coverage must exist when each table does.** The data-lifecycle doc still lists a different table (`awcms_payroll_records`) with retention "not yet set"; ADR-0094 coverage gates will fail late otherwise, and "retain for the life of the tenant" (§13.2) has no counsel-approved period.                                                                                                                                                                                                                                                                                 | Every phase-3 table ships with its `subjectData` entry and `data_lifecycle` descriptor in the same migration (retention class explicit, legal hold overrides; the retention value comes from counsel, §17.3); correct the stale row in `data-lifecycle.md`.                                                                                                                                                                                                                     | #957 and each table issue                 |
| **PS-18** | Required     | **Reads and aggregates are invisible.** §13.2 claims the audit answers "who read what", but only reveal is audited; nothing forbids a reporting projection or export over payroll tables; the canary test covers account numbers, not salary.                                                                                                                                                                                                                                                                                                                                                           | Audit rows (ids, counts, never amounts) for compensation, line-level and other-employee payslip reads and for every export; a gate forbidding payroll tables as projection, search, comments, cache or export sources; canary tests for salary amounts in logs and error bodies; formula-neutral CSV.                                                                                                                                                                           | **#978** (new); canary in #957/#961       |
| **PS-19** | Required     | **An accrual must be paid by exactly one run, including after reversal.** Two runs (regular and off-cycle) can select the same payable accrual concurrently; a reversal that re-opens accruals while the first payment was real pays them again.                                                                                                                                                                                                                                                                                                                                                        | A claim table or partial unique index `(accrual_id) WHERE not reversed` taken atomically at calculate or finalize (`FOR UPDATE SKIP LOCKED`); reopening tied to PS-02's recovery decision.                                                                                                                                                                                                                                                                                      | #962                                      |
| **PS-20** | Low          | **Scope of tests and sync.** Immutability and RLS proofs must run as `awcms_app` (an owner role bypasses triggers and policies); payroll tables must be explicitly excluded from the sync registry so they never replicate to an offline node.                                                                                                                                                                                                                                                                                                                                                          | Frozen-run, RLS and SoD tests as the runtime role; a registry assertion that no `awcms_hr_*` payroll table is a sync resource.                                                                                                                                                                                                                                                                                                                                                  | #957                                      |
| **PS-21** | Low          | **Duplicated and contradictory text in this pack.** §16 repeats its question table, the second copy carrying superseded stances (O6 "still needs its own ADR"; O7 "blocks phase 3 gate"), and §15 repeats a bullet about the same follow-ups.                                                                                                                                                                                                                                                                                                                                                           | Remove the stale duplicates in a follow-up docs change (not done here to keep this review record atomic); the first §16 table and the ADRs are authoritative.                                                                                                                                                                                                                                                                                                                   | docs follow-up                            |

**Blocking findings, stated plainly:** PS-01 (payee as actor), PS-02 (reversal
SoD and the paid-run double payment), PS-03 (approve not bound to the calculation
that was reviewed) and PS-04 (no documented impact assessment). The first three
change the schema or the SoD model of #957 and must be written into §7.5, §9 and
the issue acceptance before it starts; PS-04 needs people, not code.

**Note for #968 (restore drill).** In addition to its scope: keep every key id any
restorable backup still needs in both rings (encryption and hash); drill the
payroll reconciliation of §14 after restoring attendance, commission and payroll
together; drill restore **without** the ring (reveal and re-encryption fail
closed, masked reads work).

### 17.3 Legal-review checklist (for counsel; not answered here)

Every item is a yes/no question. "Decided in" says where the pack or an issue
fixes the behaviour counsel is asked to confirm; **an answer of "no" or "unsure"
is a finding to be turned into a design change or an issue**, and the matching
control stays unbuilt until resolved. This pack asserts no law, rate, ceiling or
retention period; the engine ships none (O4).

**A. Effective dating of rule versions**

| #    | Question                                                                                                                                                                                                                   | Decided in        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| L-A1 | Is it acceptable that a version is selected by one date per period (the date to be fixed per PS-07: period start, period end or pay date) rather than per payment line, for every kind of rule a consumer will transcribe? | §7.3, #958, PS-07 |
| L-A2 | Is a version's `effective_from` (with the next version superseding it) sufficient, or must a version also carry an explicit end date and transition rules?                                                                 | §7.3, #958        |
| L-A3 | When a regulation takes effect retroactively, is it lawful to correct only through the reversal of the affected finalized runs and a recalculation, rather than editing history?                                           | §7.4, §8          |
| L-A4 | May a version be published with an effective date inside a period that is already finalized, given that finalized runs never change and only open periods use it?                                                          | §7.2, §7.3, #958  |
| L-A5 | Where the law prescribes a rounding rule, is recording the rounding mode and point on the version (and applying it per line or per total as the version states) enough to comply?                                          | PS-08, #958       |

**B. Citation and provenance**

| #    | Question                                                                                                                                                                                     | Decided in         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| L-B1 | Is a stored citation (instrument, number, year, article) plus effective date sufficient provenance for a rule version, or must a copy or digest of the source text be stored on the version? | §7.3, #958         |
| L-B2 | Must the "named reviewer" who transcribes a version hold a particular professional qualification, or is a named, authenticated user of the consumer's tenant sufficient evidence?            | §7.3               |
| L-B3 | Is the retention of every published version, its citation and its audit trail for the life of the tenant acceptable, and is a longer or shorter period required?                             | §7.3, §13.2, PS-17 |
| L-B4 | May the payslip or a run export show the rule version and citation behind a figure to the employee, and is it required to?                                                                   | §7.2, #961         |

**C. Immutability and correction**

| #    | Question                                                                                                                                                                                                            | Decided in       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| L-C1 | Is "a published version is never edited; an error is fixed by a new version" sufficient for audit and inspection, including when a run was calculated under a version later found to contain a transcription error? | §7.3, §7.4, #958 |
| L-C2 | Is the immutable, derived payslip (a snapshot that does not rewrite) consistent with the employee's right to rectification, given that corrections flow by reversal and a new payslip?                              | §7.4, §13.2      |
| L-C3 | When a run already **recorded as paid** is reversed, may the recovery be netted in a later period, or must the amount be recovered by another route; and are there constraints on deducting a recovery from pay?    | PS-02, §7.4      |

**D. Who may publish a rule**

| #    | Question                                                                                                                                                                                                                  | Decided in             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| L-D1 | Is two-person publication (author and a different publisher, neither approving runs, SoD U × A) a sufficient maker/checker control for a payroll rule, or must a named qualified person approve each version?             | §7.3, §7.5, PS-07      |
| L-D2 | May an operator of the platform author or publish a rule version on a tenant's behalf, or must publication always be by the tenant's own staff or professional adviser?                                                   | §7.3, O4               |
| L-D3 | Given that upstream ships the engine and no rates (O4), is a stated disclaimer that rule content and its legal correctness are the consumer's responsibility needed in the product and in the terms, and is it effective? | §7.3, O4, control C-24 |
| L-D4 | Does the engine's neutrality (no jurisdiction constants) change who is responsible for the correctness of a withholding or contribution calculation as between operator, tenant and any adviser?                          | §7.3, O4, O5           |

**E. Personal data protection (UU PDP 27/2022) and retention**

| #     | Question                                                                                                                                                                                                                                 | Decided in            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| L-P1  | Is the platform operator a controller, a processor or both for payroll data, per deployment model, and is that fixed in each processing agreement (O5)?                                                                                  | §13.2, O5             |
| L-P2  | Is the lawful basis "employment relationship and the employer's legal obligations" correct for salary, payout accounts and payslips, with no separate consent needed for them?                                                           | §13.2                 |
| L-P3  | Is a payout bank account personal financial data that attracts additional obligations beyond general personal data, and are the controls of ADR-0137 (encryption, masking, audited reveal) enough?                                       | §11.2, ADR-0137       |
| L-P4  | Is a documented impact assessment (DPIA) required for phase 3 before implementation, and has one been completed to counsel's satisfaction (PS-04, #976)?                                                                                 | §13.2, PS-04          |
| L-P5  | Does a statutory retention period apply to each of: employment records, attendance used for pay, payroll runs and payslips, tax and withholding data, and audit trails of reads and reveals; and has counsel fixed each period in years? | §13.2, PS-17          |
| L-P6  | Is retaining payroll financial rows "for the life of the tenant" until an archive-then-purge design exists lawful, or must a purge or archive route exist before the first payroll run?                                                  | §13.2, §15            |
| L-P7  | On an erasure request, is the posture acceptable that the profile is anonymised while HR and payroll rows remain, resolving to the anonymised profile, for the duration of the retention period?                                         | §3, §13.2             |
| L-P8  | Are backups that still contain a purged or anonymised subject acceptable until they age out, and is a restore into a scratch environment without the key ring (reveal fails closed) acceptable evidence of protection?                   | ADR-0137 §6, #968     |
| L-P9  | What breach-notification duty and period apply, who must notify (operator or tenant), and does the audit and decision log satisfy "who accessed what" (PS-18)?                                                                           | §13.2, O5, PS-18      |
| L-P10 | Is hosting payroll data in the deployment's chosen location (including any cross-border transfer by a cloud or backup provider) permitted, and is a data-protection officer required for a tenant processing payroll at scale?           | §13.2                 |
| L-P11 | Is the notice given to employees about this processing (purposes, categories, retention, rights) adequate as designed, or must a specific notice or acknowledgement be built?                                                            | §13.2, §4.3 (pattern) |

### 17.4 Sign-off (to be completed by counsel; left blank)

| Field                                                                                                          | Entry                         |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Reviewer name and capacity                                                                                     |                               |
| Date                                                                                                           |                               |
| Scope reviewed (tick): A effective dating, B citation, C immutability, D who publishes, E UU PDP and retention | A [ ] B [ ] C [ ] D [ ] E [ ] |
| Documents and versions reviewed (pack, ADR-0132, ADR-0136, ADR-0137, ADR-0138; commit)                         |                               |
| Outcome (approved / approved with conditions / not approved)                                                   |                               |
| Conditions or blocking findings (each to become an issue)                                                      |                               |
| Retention periods fixed (reference)                                                                            |                               |
| Evidence location (not in this repository if it contains advice)                                               |                               |

Until this block is completed and linked from the phase 3 gate row, the legal
part of the gate is **not satisfied**, and the gate row stays unticked for it.
