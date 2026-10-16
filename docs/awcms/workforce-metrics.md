🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](workforce-metrics.id.md)

# Workforce metrics — attendance, hours, shift coverage and productivity facts

> **Status:** built (Issue #953, Wave D of the platform epic; builds on the
> attendance and shift data of Issues #946/#947). Module: `hr_workforce`
> (experimental, no admin screen yet). **This document is the contract of record
> for the workforce metrics.** The upstream metrics catalogue the issue refers to
> (`docs/aw-business-platform-metrics.md`) is not in this repository; if it
> defines a workforce metric differently, reconcile by changing this contract and
> bumping `WORKFORCE_METRICS_CONTRACT_VERSION`, never by letting two definitions
> coexist.

## 1. What this is, and what it refuses to be

Metrics about people's working time are the most easily misused numbers a
back-office system produces. This contract is deliberately narrow:

- **Transparent business facts only.** Every figure is a count, a number of
  minutes, or a ratio of two stated numbers. The definition is written in §4 and
  the same definition runs in the code (`domain/hr-workforce-metrics.ts`).
- **No composite score.** There is no ranking, rating, grade, weighting,
  threshold, traffic light or "good/bad" flag, and no field that could carry one.
  Two employees' figures are never combined into a verdict. A test asserts the
  reported keys are exactly the contract's and that no response key is called
  score, rank, rating, grade or risk.
- **No photo, biometric, device or location data.** The source tables hold none
  (owner decision O6, ADR-0138) and the metric code has no input that could carry
  one. The geolocation verdict evidence of ADR-0138 is not read either.
- **No payroll.** The metrics read `awcms_hr_attendance_events` and
  `awcms_hr_shift_assignments` (plus the employment header and current terms for
  office and employed-in-window). They never read compensation, commission or
  payroll tables; the payroll boundary gates (`payroll:sql-boundary:check`, the
  projection-registry payroll rule) stay green.
- **A fact is not a judgement.** A missed shift can be an unrecorded clock-in; a
  late arrival can be a transit disruption. See §7 before using any figure for a
  decision about a person.

## 2. Where the figures come from

| Source                                                       | Used for                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `awcms_hr_attendance_events` (effective record)              | clock-in/out and break instants. A superseded event is excluded.     |
| `awcms_hr_shift_assignments` (published, `work` only)        | scheduled shifts and planned minutes. Draft, cancelled, time off: no |
| `awcms_hr_employments` + current `awcms_hr_employment_terms` | office grouping, manager link, employed-in-window test               |

Tenant isolation is the database's (RLS `FORCE` on every table above); the
queries also bind `tenant_id`.

## 3. Visibility — who sees whose figures

Default-deny. Three audiences for person-level facts and one for aggregates; they
are separate permissions and separate read paths, never combined.

| Audience             | How                                                                  | Sees                                                            |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Employee**         | `GET …/workforce-metrics/employees?mine=true` — no permission needed | their own employments only                                      |
| **Supervisor**       | `…/employees?reports=true` — no permission needed                    | their **direct** reports only (one level)                       |
| **HR**               | `hr_workforce.workforce_metrics.read`                                | every employee in the tenant                                    |
| **Aggregate viewer** | `hr_workforce.workforce_metrics.analyze` (or `.read`)                | per-office aggregates, small groups withheld; no individual row |

- `mine` and `reports` are **ownership grants** (ADR-0063): computed server-side
  from the persisted login link and the current manager link, never from the
  request; they widen only this read; ABAC, scope and SoD still run; a machine
  credential never carries them. A login linked to no employment sees an empty
  list, not an error and not other people.
- **Direct reports, not the chain.** The attendance list walks ten levels of the
  manager chain; the metrics deliberately do not. A skip-level person's
  performance-flavoured facts are the ones a manager is least entitled to. A
  soft-deleted employment is not covered. The facts begin when the reporting line
  did: a supervisor sees a report only from the `effective_from` of the report's
  current term under them (a later change of title starts a new term and moves
  that date forward), never the history from before they managed that person. A
  terminated manager, a terminated or soft-deleted report, or a report re-assigned
  to someone else drops out immediately.
- An `employmentId` outside the chosen basis is **403 — the same answer as for an
  id that does not exist**, so a refusal reveals nothing about who exists.
- Holding `analyze` does **not** open the individual list, and holding nothing is
  403 everywhere. Malformed input from a caller entitled to nothing is also 403
  (entitlement is judged before input).
- Neither key is granted to any role by default; "HR" is a role a tenant builds.
  Neither implies `attendance.read`, `corrections.read` or any compensation power.
- Every response is `Cache-Control: private, no-store` and carries the
  governance notice (§7).

## 4. The metric contract (version 1)

Window: `[from, to)` as UTC instants, both required, at most **31 days**. "Now" is
the request time. Figures are per employment; a group figure sums the members and
recomputes ratios from the sums (never an average of ratios).

| Key (JSON)               | Definition                                                                                                                  | Unit    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `scheduledShifts`        | published, non-cancelled `work` shifts whose start is in the window **and has passed**                                      | count   |
| `attendedShifts`         | of those, shifts matched to a clock-in (below)                                                                              | count   |
| `missedShifts`           | of those, shifts that have **ended** with no matching clock-in. A shift in progress is neither attended-late nor missed yet | count   |
| `lateArrivals`           | attended shifts whose matched clock-in is more than **5 minutes** after the start                                           | count   |
| `scheduledMinutes`       | planned length minus planned break, of shifts that have ended                                                               | minutes |
| `workedMinutes`          | for each completed session (clock-in … clock-out, clock-in inside the window): elapsed minutes minus breaks taken           | minutes |
| `breakMinutes`           | the breaks taken inside those sessions                                                                                      | minutes |
| `incompleteSessions`     | clock-ins with no clock-out within **24 hours** (a forgotten clock-out). Never counted as worked time                       | count   |
| `coverageRatio`          | `attendedShifts / (attendedShifts + missedShifts)`; `null` when no shift has settled                                        | ratio   |
| `workedToScheduledRatio` | `workedMinutes / scheduledMinutes`; `null` when nothing was scheduled. May exceed 1 (overtime). A fact, not a target        | ratio   |

**Matching.** A clock-in matches the earliest unmatched shift whose range
`[start − 2 h, end)` contains it; one clock-in matches at most one shift. A session
belongs to the window by its clock-in instant; a shift by its start instant.

**Session building** is forgiving and never corrects: a second clock-in while one
is open, a clock-out with nothing open and a break outside a session are ignored;
a break still open at clock-out ends there. Fixing the record is the correction
workflow's job, not the metric's.

**Mapping to the issue's four families.**

| Family         | Keys                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| Attendance     | `scheduledShifts`, `attendedShifts`, `missedShifts`, `lateArrivals`           |
| Hours          | `scheduledMinutes`, `workedMinutes`, `breakMinutes`, `incompleteSessions`     |
| Shift coverage | `coverageRatio` (per employee, and per office in the aggregate)               |
| Productivity   | `workedToScheduledRatio`, plus the stated numerator and denominator beside it |

"Productivity" here is limited to what the attendance and shift data can state:
time worked against time scheduled. Output-per-hour measures (sales, tickets) need
a source module's data and are not invented here; a later metric would be added to
this contract with its own definition, source and visibility, not smuggled in.

## 5. The registered reporting projection

`hr_workforce` registers one projection with the `reporting` engine
(`reportingProjections`, like `booking` and `inventory`): **`hr_workforce.attendance_events`**,
all-time counts of attendance events recorded per kind (`clock_in_events`,
`clock_out_events`, `break_start_events`, `break_end_events`), incrementally
derived from the append-only events table by the existing `cursor_table` worker
(cursor `recorded_at`, the database's insert-time clock; index in `sql/308`).
Rebuild and reconciliation are the engine's own. Permission to read it:
`hr_workforce.workforce_metrics.read` (HR).

**Why only volume is a projection.** The engine keeps tenant-wide counters, each
readable by whoever holds the descriptor's one permission. That shape cannot say
"for the employee only" or "withhold when fewer than five people contributed". So
the behavioural figures (§4) are **not** projected: they are computed live from
the effective record, where the viewer's relationship to each employee is checked
per request and suppression applies. This is the `drillDownPath` of the
projection. A superseded event still counts in the projection (a counter only
increases) and not in the live figures; the projection is event volume, not a
metric of §4.

## 6. Small-group suppression

**Window rule (differencing).** The `groups` route accepts exactly **one closed
UTC ISO week** (`from` a Monday 00:00Z, `to` the next Monday). Any other window,
a calendar month included, is `400`, and so is a week that has not ended yet.
Weeks are disjoint and never nest, so no two accepted windows can be subtracted
from one another to leave a slice (a month minus the whole weeks inside it would
leave its edge days, which is why months are not accepted). With free `from`/`to`, two requests that differ by
a tail slice isolate one person (the difference of the two sums _is_ that
person's contribution once a group sits near the threshold); with fixed buckets
every aggregate covers the same days for everyone, and a closed bucket does not
grow with the clock. A test replays the sliding-window attack and asserts every
misaligned window is refused.

**Rule.** A per-office aggregate computed from **fewer than 5 contributing
employees** is withheld entirely: the group is returned with `suppressed: true`
and `reason: "small_group"` and **no number** — not the facts, and not the
contributor count. A shown group reports only a **band** (`"5-9"`, `"10-19"`,
`"20+"`), never the exact count, so adding or removing one person does not move
the figure shown.

**Contributor floor.** A _contributor_ is an employee with at least
**`MIN_CONTRIBUTION_MINUTES = 240`** (four hours) of scheduled **or** worked time
in the bucket. An employee under the floor is neither counted toward the
threshold nor included in the sums. Without it, one real employee plus a few
planted short shifts or sessions would lift a group over five and make the
aggregate that one person's figures. Tested with planted 15-minute shifts.

**The constants.** `SMALL_GROUP_MIN_CONTRIBUTORS = 5` and
`MIN_CONTRIBUTION_MINUTES = 240`. The metrics catalogue the issue cites was not
available, so the values are chosen here: five is the figure the `booking`
utilization report already uses to withhold a ratio and a common floor in
public-statistics practice; four hours is half a standard shift. Both are **code
constants, not tenant settings**, on purpose: a tenant that could lower them
would turn suppression into a switch the party being protected against can flip.
Changing either is a code change with a contract-version bump. The response
states both (`suppression`).

**Differencing across groups.** The aggregate endpoint offers **no tenant-wide
total**, so a withheld group cannot be recovered by subtracting the shown groups
from a total. Ratios are recomputed from sums.

**Where it applies.** To aggregates only. A person-level fact is shown to the
people entitled to that person (the employee, their direct supervisor, HR); for
them there is no group to hide in. The aggregate permission exists so someone who
is not HR can see how a site is staffed without seeing any individual — which is
only worth anything if the aggregate cannot be narrowed to one.

**Residual risks (stated, not solved).**

1. Membership changes between buckets are visible by nature: if a group is shown
   in week 12 and not in week 13, a person left or fell under the floor.
2. A group of exactly five where four have identical figures reveals the fifth's
   to anyone who knows the four.
3. A closed bucket can still change slightly afterwards: an offline kiosk replay
   (up to seven days late) or an approved correction can alter it. Two reads of a
   bucket made before and after such a change differ by that late record.
4. The tenant-wide event-volume projection is HR-only because in a one-employee
   tenant any counter is personal.

## 7. Governance review before any consequential use

These figures describe recorded attendance and published shifts. They are an input
to a conversation, not an assessment. **Before any figure from this contract is
used to decide something consequential about a person** — discipline, pay,
promotion, demotion, termination, rota penalties, or any automated decision — the
employer must have completed, and recorded outside this system:

1. **A purpose statement** naming the decision and why attendance facts are
   relevant and proportionate to it.
2. **A data-protection assessment** where the law requires one (Indonesian
   PDP Law / the employer's counsel decides), covering retention and access.
3. **A human review step**: a person looks at the context behind the figure
   (unrecorded clock-ins, pending corrections, approved leave, system outages)
   before it is acted on. No automated adverse decision is based on these facts.
4. **Notice to employees** of which figures exist, who sees them and for what.
5. **A route to challenge**: the employee can read their own figures
   (`mine=true`) and request an attendance correction (`corrections.create`)
   through the approval workflow.

The API repeats a short form of this in every response (`governance`). The module
does not enforce the review — it cannot know a decision was made — which is why the
figures are facts, never flags, and why no field marks a person as a problem.

**Not yet mitigated by the product.** There is **no employee-facing screen** yet:
an employee can read their own figures and request a correction only through the
API, so the "route to challenge" above exists in the API but not as something an
employee can find. Until a screen lands, the employer must give employees another
way to see their own figures on request. The derived figures are not separately
exported or erased by the subject-rights tooling (they are computed live from the
attendance and shift rows, which are covered), and HR keeps seeing them, keyed by
`employeeNo`, for any employment whose person has since been anonymised, as long
as the employment row exists. Retention of the underlying attendance record is
the employer's decision (ADR-0132 section 13.2).

## 8. Proof items

| Proof                                                                                                                                                     | Where it is shown                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Each definition of §4 yields the stated number                                                                                                            | `tests/hr-workforce-metrics.test.ts` (worked time, breaks, late grace, matching, coverage, productivity ratio) |
| The same figures come out of real rows (effective record, published work shifts only, window edges)                                                       | `tests/integration/hr-workforce-metrics-database.integration.test.ts`                                          |
| No score, rank or flag; no photo/biometric/device/location key                                                                                            | key-set assertions in both the unit test and `…-api.integration.test.ts`                                       |
| Small-group suppression: 4 withheld with no digit, 5 shown; non-contributor does not count; no total                                                      | unit test + database test + API test                                                                           |
| Ownership: another employee's data is 403 (same as a missing id); skip-level, peer and outsider are refused for a supervisor; unlinked login sees nothing | `tests/integration/hr-workforce-metrics-api.integration.test.ts`                                               |
| Default-deny: no token 401; no permission 403; `analyze` does not open the individual list                                                                | API test                                                                                                       |
| Tenant isolation (RLS) for facts and groups                                                                                                               | database and API tests                                                                                         |
| The projection counts each kind once, reconciles, survives a rebuild without double counting                                                              | database test (worker role)                                                                                    |
| No payroll table is read                                                                                                                                  | `bun run payroll:sql-boundary:check` and the projection registry's payroll rule                                |

## 9. Limitations

- No admin screen yet (the module is `experimental`); the API is the surface.
- Window arithmetic is in UTC instants; a client wanting local-day windows
  converts them. Office grouping uses the **current** terms, not the terms at the
  time of each shift.
- Windows for the per-employee list are free UTC instants (31 days at most); the
  aggregate takes only one whole closed ISO week (section 6).
- A tenant above 10,000 employments gets `422 WORKFORCE_METRICS_SCOPE_TOO_LARGE`
  on the aggregate endpoint (decided from a COUNT before any page is read); chunked or precomputed aggregates are a follow-up.
- Reads are not audited (own and supervisor reads are routine, like the attendance
  list); the chokepoint's decision log records each authorisation.
- Existing tenants must be granted the two new permissions
  (`bun run identity-access:permissions:backfill`), as for every permission-seed
  migration.
