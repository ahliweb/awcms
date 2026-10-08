🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](hr-payroll.id.md)

# HR and payroll — workforce, commission, payroll (design pack)

> **Status:** admitted by [ADR-0132](../adr/0132-hr-payroll-module-family-admission.md)
> (Issue #916). **Design only: no module, table, route or migration exists.**
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

| Phase | Module key      | Scope                                                                                | Depends on                             | Buildable when                                                                                                                                  |
| ----- | --------------- | ------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `hr_workforce`  | employment context, attendance, corrections, shifts, **staff-availability port**     | `tenant_admin`, `profile_identity`     | now (usual DoD, security review of the new port and the ownership paths)                                                                        |
| 2     | `hr_commission` | commission rules and accrual ledger                                                  | `hr_workforce`                         | phase 1 landed                                                                                                                                  |
| 3     | `hr_payroll`    | compensation, payout accounts, periods, runs, lines, payslips, payroll rule versions | `hr_workforce`, `hr_commission` (soft) | **O4 and O7 answered; payout-account at-rest encryption decided; security review; legal review of any jurisdiction profile; restore rehearsal** |

**Out of scope for the whole family:** general ledger and any accounting entry;
fiscal documents (annual return, withholding certificates); bank-file generation
and any payment-provider call (a later issue, through the outbox, never inside a
database transaction); leave balances and accrual; loans and benefits; applicant
tracking; performance review; **affiliate commission** (a different beneficiary,
not an employee); geolocation/photo/device attendance evidence (§4.3).

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

| Acceptance criterion (from the issue)                                                        | Where                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Employment stores a `profile_identity` reference and never copies name, contact, national id | §3, `profile_id` composite FK; no personal column in any HR table |
| Org unit, manager, effective-dated status                                                    | §4.1 `employment_terms`                                           |
| Attendance events, corrections, approval via `workflow_approval`                             | §4.2                                                              |
| Geolocation/photo/device evidence is a separate feature, off by default                      | §4.3 (absent in phase 1; O6)                                      |
| Shift templates and assignments with conflict detection                                      | §4.4                                                              |
| A staff-availability port for Booking                                                        | §5                                                                |

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

| Acceptance criterion                                          | Where           |
| ------------------------------------------------------------- | --------------- |
| Period, run, line, payslip                                    | §7              |
| SoD: calculate vs approve vs pay                              | §7.5, O7 (open) |
| Period lock; immutable finalized runs; correction by reversal | §7.2, §7.4      |
| Effective-dated, jurisdiction-neutral rules                   | §7.3            |
| Indonesian profile is rule data, ownership an owner decision  | §7.3, O4 (open) |

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

**Not part of this admission and absent from phase 1 by construction:** no table,
no column, no setting, no route (owner decision **O6** open). If O6 is ever
answered yes, the minimum bar is its own ADR, a data-protection impact
assessment, a separate table with its own permission and consent record, off by
default per tenant, **coarse** evidence preferred over precise (for example "within
the office geofence: yes/no" rather than coordinates), photos stored through
`media_library` under a confidential tier, and a short retention enforced by
`data_lifecycle`.

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
id only. Enforcement: one transaction that locks the employment row `FOR UPDATE`,
checks overlap, and writes, plus a **deferred constraint trigger as backstop** so a
maintenance session cannot create an overlap. A GiST exclusion constraint on
`tstzrange(starts_at, ends_at, '[)')` is tighter but requires `btree_gist`, never
used in this repo's migrations; the phase 1 PR decides, with the provisioning
owner. Only `published` assignments are visible to the availability port.
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
  label, grade, rate or any HR attribute. The adapter's SQL names only the two
  schedule tables; a test fails if it ever names a compensation, payroll or
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

`awcms_hr_commission_accruals` is the ledger. The monetary facts —
`employment_id`, `rule_id` and `rule_version` snapshot, `source_type`,
`source_ref`, `source_line`, `operation` (`accrue`, `reversal`), `base_amount`,
`rate` snapshot, signed `amount`, `currency_code`, `occurred_at` — are
**immutable**. Only `status` and its stamps advance, by a transition trigger.
`awcms_hr_commission_transitions` is the append-only log of who moved what when.

### 6.2 Exactly-once accrual

Unique key `(tenant_id, source_type, source_ref, source_line, employment_id,
operation)`. A downstream adapter calls a port (shape deferred to the phase 2 PR)
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
`sensitive`, `normalized_value`, **unkeyed** hash, mask (the procurement identifier
pattern); **encryption at rest of the value is a phase 3 gate**, and keyed hashing
the same follow-up ADR-0128 recorded for supplier identifiers.

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
regulation arrives as a **new version**, never an edit. Whether this profile ships
upstream as seed data or is owned by each consumer is **owner decision O4**
(§12). Until it is answered, the engine ships empty of Indonesian content. A
proposal, not a decision: the engine upstream with no regulatory content; the
Indonesian profile a **separate, versioned data package** with provenance,
consumer-owned until a legal reviewer is named.

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

### 7.5 Segregation of duties (owner decision O7 — proposal)

Duties are separate permissions: **C**alculate (`runs.calculate`), **A**pprove
(`runs.approve`), **F**inalize (`runs.finalize`), **P**ay (`runs.pay`), **R**everse
(`runs.reverse`), plus **K** compensation write (`compensation.update`) and
**U** rule publish (`rules.publish`).

| Pair held by one person                 | Proposed default | Role-level mechanism                                                                                                   |
| --------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C × A (calculate and approve)           | forbidden        | SoD rule, `global_within_tenant`, `critical`, no exception                                                             |
| A × P (approve and pay)                 | forbidden        | SoD rule, `critical`, no exception                                                                                     |
| C × P (calculate and pay)               | forbidden        | SoD rule, `high`; exception allowed, time-bound (≤ 30 days), approved by a third person holding a different permission |
| C × F, F × P                            | forbidden        | SoD rules, `high`                                                                                                      |
| A × F (approve and finalize)            | **allowed**      | same duty tier, F freezes what A approved                                                                              |
| K × A (change salary and approve a run) | forbidden        | SoD rule, `critical`, no exception                                                                                     |
| U × A (publish rules and approve a run) | forbidden        | SoD rule, `high`                                                                                                       |
| R × P (reverse and pay)                 | forbidden        | SoD rule, `high`                                                                                                       |

Whatever the tenant configures, the **per-instance rule is in the database** and
cannot be configured away: `approved_by <> calculated_by`; `finalized_by <>
calculated_by`; `paid_by` differs from `calculated_by`, `approved_by` and
`finalized_by`. The existing self-approval guard also applies to `approve`. The
consequence for a very small tenant is stated, not hidden: running a regular
payroll needs **at least three distinct people**, or the time-bound C × P exception
above. Whether that is the right default is O7.

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

`normalized_value`, hashes and masks of payout accounts are `redactedColumns` and
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

| #   | Statement                                                                                                                                                                                                                                                                                                                                             | Mechanism                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | An employee with only the base role reads **their own** attendance events and **cannot** read another employee's (both `403`).                                                                                                                                                                                                                        | `ownershipGrant` for `attendance.read`, computed server-side from `employment.tenant_user_id === ctx.tenantUserId`; widens only, ABAC/tenant/SoD still deny; the decision log records `ownership_grant:<reason>`.                          |
| S2  | An employee reads **their own released payslip** and cannot read it before release, nor anyone else's.                                                                                                                                                                                                                                                | `ownershipGrant` on `payslips.read` plus a state predicate (`released_at IS NOT NULL`) in the handler's query; no new attribute.                                                                                                           |
| S3  | An employee clocks in for themself; the same employee cannot record attendance for a colleague.                                                                                                                                                                                                                                                       | `ownershipGrant` on `attendance.create` limited to the own employment; recording for others needs the unmodified `attendance.create` key.                                                                                                  |
| S4  | A supervisor assigned to office O reads attendance and corrections for employments **in O and its descendants**, not for another office.                                                                                                                                                                                                              | `office` business scope with `requiredScopeType=office`, `requiredScopeId=<employment office>`, `requiredScopeRelations=["exact","descendant"]` and the existing hierarchy adapter (ADR-0060); unresolved scope denies a high-risk action. |
| S5  | A supervisor can approve a correction for a report but **cannot approve their own** correction.                                                                                                                                                                                                                                                       | `workflow_approval` decision + the existing self-approval guard (`approve` with `requestedByTenantUserId`).                                                                                                                                |
| S6  | A manager sees their direct reports even where they hold no scope on the reports' office.                                                                                                                                                                                                                                                             | a server-computed `ownershipGrant` reason (`manager_of`) from the persisted manager chain; **not** an ABAC attribute (`resource.managerTenantUserId` would need its own admission and is not assumed).                                     |
| S7  | A scheduler holding `shifts.*` creates and publishes assignments and **receives `403` on every `compensation.*`, `payout_accounts.*`, `runs.*` and `payslips.*` route.**                                                                                                                                                                              | RBAC default-deny: separate permissions, none granted by the scheduler role; separate tables.                                                                                                                                              |
| S8  | The availability adapter, run with a tenant-scoped `tx`, returns working intervals and **nothing else**; its SQL never names a compensation or payroll table.                                                                                                                                                                                         | `StaffAvailabilityPort` allow-list DTO; a source-text test over the adapter (the same style as `access:chokepoint:check`).                                                                                                                 |
| S9  | The user who calculated a run **cannot approve it**; the approver **cannot pay** it; a user holding both permissions is refused at role assignment and, if the exception path was used, at action time.                                                                                                                                               | DB CHECKs on the run row (`approved_by <> calculated_by`, `paid_by` distinct) **and** `sodRules` over the permission keys (`global_within_tenant`, `critical`); self-approval guard on `approve`.                                          |
| S10 | A user who changes an employee's compensation cannot approve a payroll run that includes them; compensation proposed by A cannot be approved by A.                                                                                                                                                                                                    | SoD rule K × A; `approved_by <> proposed_by` CHECK; self-approval guard.                                                                                                                                                                   |
| S11 | A CRM marketer (holding `crm.*` and `profile_identity.profile_management.read`) and a receptionist (holding booking and shift-read only) receive `403` on every `compensation`, `payout_accounts`, `runs`, `payslips` and `commission.accruals` route and see **no salary or national id** through the profile list (names only; identifiers masked). | RBAC default-deny: no `hr_*` payroll permission; `profile_identity` masking is unchanged; payroll tables are unreachable without their own keys.                                                                                           |
| S12 | Revealing a payout account without `payout_accounts.reveal` is `403`; with it the response is `no-store`, an audit row at `warning` records that it happened and by whom but never the value.                                                                                                                                                         | `reveal` high-risk action; the procurement reveal pattern.                                                                                                                                                                                 |
| S13 | With the module disabled for tenant T, every route of that module is denied for T and T's tables are untouched; T2's payroll is unaffected.                                                                                                                                                                                                           | module enable/disable (`awcms_tenant_modules`); FORCE RLS.                                                                                                                                                                                 |
| S14 | A machine credential (API token) cannot exercise an `ownershipGrant`.                                                                                                                                                                                                                                                                                 | ADR-0063 §A excludes machine credentials.                                                                                                                                                                                                  |
| S15 | A request supplying another tenant's `employment_id`, `profile_id` or `office_id` is rejected, even if the id exists.                                                                                                                                                                                                                                 | composite `(tenant_id, id)` FKs plus FORCE RLS; the handler re-reads inside `withTenant`.                                                                                                                                                  |

**What needs a new admission, said plainly.** Per-report scoping through an ABAC
_policy_ (rather than a server-computed ownership reason), a payroll-grade or
cost-centre scope, and an HR org-unit tree (§4.1 follow-up) each need either a new
ABAC allow-list attribute or a new business-scope type with an adapter extension.
None is assumed; the scenarios above are satisfiable without them.

## 13. Threat and privacy analysis

### 13.1 Threats

| Threat                                                            | Control                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant read or write of employment or pay data              | FORCE RLS + composite FKs + `defineTenantRoute`; RLS tested as `awcms_app`                                                  |
| Scheduler or marketer reading salary (horizontal in-tenant)       | separate permissions and tables; S7, S11; the availability port is an allow-list                                            |
| Self-service abuse: employee reading another's payslip/attendance | `ownershipGrant` computed from the persisted link, never from the request; machine credentials excluded                     |
| Account-link hijack: linking my login to a colleague's employment | `assign` is high-risk, audited, SoD-able; changing it is an event                                                           |
| Payroll fraud: insider alters salary, runs and pays               | propose/approve compensation; C/A/P per-instance DB CHECKs; immutable finalized runs; period lock; reversal-only correction |
| Double payment (double click, retry, replay)                      | state check + `Idempotency-Key` + unique payslip per period/employee + unique payment per run                               |
| Attendance tampering (back-dating, ghost clock-ins)               | append-only events, server `recorded_at`, supersession by approved correction, skew bound; no editing                       |
| Time-theft by a colleague clocking in for another                 | clocking for another requires the unmodified key, audited by `source` and actor; evidence is O6                             |
| Ledger inflation by forged commission source                      | unique source identity; the adapter's duty to verify (documented); `approve` by a third party                               |
| Leakage through events, logs, exports, notifications              | ids/counts only; money absent from logs; `redactedColumns`; payslip notices carry no amount                                 |
| Plaintext payout accounts at rest                                 | **phase 3 gate**: encryption at rest and keyed hashing decided before the table exists                                      |
| Existence oracle (is X an employee? is X scheduled?)              | `unknown` is indistinguishable; uniform acknowledgements for identifier adds                                                |
| Rule tampering (a tax rate changed to under-withhold)             | rule versions immutable once published, published by maker/checker, citation required, audit at `warning`                   |
| Backdated pay change after a period closed                        | period lock; `backdate` high-risk; no unlock                                                                                |
| Provider call inside a transaction                                | none; any bank/provider integration goes through the outbox in a later issue                                                |
| Offline replay of attendance forging time                         | `client_event_key` uniqueness; `late` flag for review; correction needs approval                                            |

### 13.2 Privacy (UU PDP 27/2022)

This is a design analysis, not legal advice; applicability is a per-deployment
assessment.

- **Data subjects and categories.** Employees and workers. General personal data:
  identity (via `profile_identity`), employment, attendance and schedule.
  Financial: salary, bank account, withholding. **Specific personal data** under the
  law must be treated with extra care: health (sick-leave reasons: hence no time-off
  reason is stored), and potentially biometric or geolocation data (hence evidence
  is excluded, O6).
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
  accounts encrypted at rest before phase 3; audit of reveals; backup handling
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
- Reveal of a payout account: step-up and rate limit decided conditionally in
  phase 3 (not unconditionally, ADR-0058 §E).
- Merge guard between two actively-employed profiles, the `btree_gist` question and
  the `AccessAction` additions (`calculate`, `pay`) are implementation-time.
- Archive-then-purge for financial rows, admin screens, and bank-file output are
  later issues.
- `awcms_profile_entity_links` may additionally be written for discovery ("which
  module links this profile"); optional, follow-up.

## 16. Open questions (owner decisions — open, not decided)

Tracked downstream in `ahliweb/awcms-one` `docs/aw-business-platform-dor.md`. None
is closed by ADR-0132.

| Id  | Question                                                                                                                                      | Why it matters here                                                                          | Blocks                           | This pack's stance                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| O1  | Scope and sequencing of the platform epic as tracked downstream (whether the phases ship together, in order, or per consumer)                 | The three phases are designed to ship one by one; a consumer may want payroll with workforce | the order of implementing issues | Designed to ship in order; payroll never ships before its gate                                              |
| O4  | Indonesian payroll profile: PPh 21 only, or BPJS, overtime, holiday allowance as well; and whether it is upstream seed data or consumer-owned | Regulatory content must be effective-dated and traceable; scope drives size and legal review | phase 3 gate                     | Engine jurisdiction-neutral and empty of Indonesian content; profile as a separate versioned package (§7.3) |
| O5  | Legal role of the platform operator per deployment: controller, processor or both                                                             | Decides subject-request ownership, processing terms, breach notification                     | privacy analysis, retention      | Designed for per-tenant isolation either way (§13.2)                                                        |
| O6  | Whether attendance may ever use geolocation, photo or device evidence                                                                         | Specific/biometric personal data; decides whether it is in any design at all                 | any evidence ADR                 | Excluded from phase 1 by construction; minimum bar stated (§4.3)                                            |
| O7  | Segregation of duties for payroll: who may calculate, approve, finalize, pay                                                                  | Authorization matrix and minimum ABAC scenarios; small-tenant impact                         | phase 3 gate                     | Default matrix proposed (§7.5); per-instance DB checks regardless; three-person minimum stated              |
