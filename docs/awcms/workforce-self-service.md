🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](workforce-self-service.id.md)

# Workforce self-service — employee, supervisor and HR screens

> **Status:** built (Issue #952, Wave D of the platform epic; builds on Issues
> #946, #947, #950/#951 and #953). Modules: `hr_workforce` and `hr_commission`
> (both `active` since this issue: each now declares an admin screen, ADR-0021
> criterion 1). It also closes item M4 of Issue #1083 (the employee-facing
> screen of the workforce-metrics transparency and challenge route).

## 1. The screens

All five live inside the existing `/admin/*` shell, under `/admin/hr/`.

| Screen                    | For            | Opened by (`navigation.requiredPermission`) | Shows                                                                                                                         |
| ------------------------- | -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/admin/hr/my-work`       | the employee   | `hr_workforce.self_service.read`            | own published shifts (next 14 days), own effective attendance (last 14 days), own correction requests and the request form    |
| `/admin/hr/my-metrics`    | the employee   | `hr_workforce.self_service.read`            | own workforce facts for 7, 14 or 30 days, with the definition of each figure and the way to challenge one                     |
| `/admin/hr/my-commission` | the employee   | `hr_commission.my_accruals.read`            | own commission accruals, read-only                                                                                            |
| `/admin/hr/team`          | the supervisor | `hr_workforce.self_service.read`            | direct reports' facts, their recent attendance and their pending correction requests                                          |
| `/admin/hr/workforce`     | HR             | `hr_workforce.employments.read`             | employments (number, title, type, status), pending corrections (`corrections.read`) and recent attendance (`attendance.read`) |

## 2. What decides who sees what

- **The data is bound by the link, not by the key.** Every employee and
  supervisor read runs in basis `mine` or `reports`: the persisted login link on
  a live employment (`awcms_hr_employments.tenant_user_id`) and the current
  manager link, computed _in the query_. The screens have no person, employment
  or id parameter, so there is nothing to widen. A login linked to no employment
  gets an empty page. Drafts and cancelled shifts are never listed to an
  employee.
- **Every panel is authorised like its API route, not by the entry key.** The
  entry key opens the page; each panel then asks the question its route asks:
  the route's guard plus the route's ownership grant, through the chokepoint
  (`canReadPanel`, `src/lib/hr-self-service-access.ts`; the loads are in
  `src/lib/hr-self-service-loaders.ts`). A tenant ABAC `deny` on
  `attendance.read` therefore 403s `GET /attendance-events?mine=true` _and_ hides
  the events on `/admin/hr/my-work`: deny-overrides-allow holds for the page. A
  panel that is denied is not read and the page says "Some sections are not
  available to you". HR's `all` panels need their roles to grant them; there is
  no ownership widening.
- **Reads outside your own basis are audited.** `/admin/hr/team` (basis
  `reports`) and `/admin/hr/workforce` (basis `all`) record the same
  `sensitive_read` audit rows the routes record (ids and a count, never a time or
  a value, mode `reports`/`all`), in the same transaction and fail-closed: if the
  audit cannot be written the load fails and shows nothing. The employee's own
  basis is not recorded. `tests/hr-self-service-read-gate.test.ts` fails the
  build when any page or loader reads those rows in a non-own basis without
  recording it.
- **The supervisor screen reads direct reports only.** Events and corrections
  are queried for exactly the direct reports' ids and trimmed to when each
  reporting line began, so a supervisor never reads history from before they
  managed that person.
- **The two new permissions are screen gates and nothing more.** The sidebar
  needs a seeded permission to show an entry and an employee holds no HR
  permission by design, so `hr_workforce.self_service.read` and
  `hr_commission.my_accruals.read` (migration `sql/313`) open the screens. They
  grant no data the ownership grants of the existing routes did not already
  grant. Nothing grants them to any role: the tenant decides (usually every
  staff role). For tenants that exist already, run
  `bun run identity-access:permissions:backfill`.
- **`GET /api/v1/hr-workforce/me`** (`self_service.read`) returns only the
  caller's own employments (no profile id, name or contact) and whether anyone
  reports to them.
- **`GET /api/v1/hr-commission/my-accruals[/{id}]`** (`my_accruals.read`) joins
  the live employment linked to the caller's login. Another employee's accrual
  id answers **404, the same as an id that does not exist** (never 403), and the
  view omits the approver, the payer, the payment reference, the rule row id and
  the employment id. An employee reading their own earnings is not an audited
  sensitive read (the owner-reads-own precedent of `payslips.read`; recorded in
  `NOT_SENSITIVE_READS`); anyone else's earnings still go through
  `GET /accruals`, which is audited.
- **The existing `mine`/`reports` routes keep answering 403, not 404,** for a
  named employment outside the basis (`employmentId` on the attendance, shift,
  correction and metrics lists, and a correction by id): that 403 is the
  documented anti-oracle answer of ADR-0063 (a missing id and someone else's id
  are the same 403) and its tests are unchanged. The new routes, which have no
  caller-supplied employment, answer 404.

## 3. What no screen does

- **No export, download or print of any person's data.** An export of another
  person's data needs its own high-risk permission and an audit row; none is
  defined by this issue, so none is offered. `tests/admin-hr-self-service-page-contract.test.ts`
  fails the build if a screen grows one.
- **The correction reason is never shown back.** The form sends it once; the
  lists do not carry it (neither does the API's list). It is sensitive and only
  the requester, a workflow assignee or a `corrections.read` holder reads it.
- **HR does not read per-person productivity facts here.** HR's `all`-mode read
  of `workforce_metrics` is the audit decision of Issue #1083 (M3); a page that
  read it would bypass that audit, so it stays API-only until that lands.
- **No composite score, ranking or colour grade** on the facts: counts, minutes
  and ratios with their definitions (`workforce-metrics.md` section 4). A ratio
  with nothing to divide is a dash, never 0 %.
- **No mutation except the correction request**, which is
  `POST /api/v1/hr-workforce/attendance-corrections` with an `Idempotency-Key`,
  for the caller's own employment only (anything else is 403), starting the
  approval workflow; it never edits the original event.

## 4. Transparency and challenge (workforce-metrics section 7)

`/admin/hr/my-metrics` tells the employee what is counted, how each figure is
defined, that the figures are business facts and not an assessment, and links to
the correction request on `/admin/hr/my-work`. An employee who disputes a figure
asks for the underlying attendance record to be corrected and an approver
decides.

## 5. Accessibility and layout

Screens use the shared admin primitives only (stacked `data-table--stack` tables
with translated `data-label`, `admin-segmented` filters, `admin-stat-card`
tiles, `admin-status-pill`). Every status is a translated label, never the raw
enum. Strings are gettext `t()` entries in `locales/en.po` and `locales/id.po`.
`tests/e2e/a11y-axe.e2e.ts` covers all five with axe and
`tests/e2e/responsive-360.e2e.ts` sweeps them at 360, 640, 768 and 1024 px
automatically (it discovers `src/pages/admin/**`).

## 6. Proof items

1. Ownership (`tests/integration/hr-self-service-api.integration.test.ts`): you
   list only your own accruals; another employee's accrual id is 404 identical
   to a missing id; the own view carries no approver, payer or payment
   reference; `me` returns only the caller's employment; default-deny (401, 403)
   and the two keys are separate powers.
2. Contract (`tests/admin-hr-self-service-page-contract.test.ts`): every gated
   key is declared and seeded, every navigation entry has a real page and an
   enforcing route, no employee or supervisor page reads in `all` mode or takes a
   person parameter, no screen exports or downloads, no reason or payment
   reference is rendered.
3. Pure helpers (`tests/hr-self-service.test.ts`): the window never exceeds the
   31-day contract cap, hostile periods fall back, every enum label is
   exhaustive.

## 7. Limitations

- The employment write screens (create, terms, link a login, delete, restore),
  the settings screens and the shift roster editor are still API-only.
- Employee attendance is shown in UTC (events carry no time zone); shifts are
  shown in their own zone.
- Clock-in and clock-out are not offered on these screens (they need the
  geolocation notice flow of ADR-0138).
- A supervisor's attendance list reaches the whole manager chain in the API; the
  screen shows direct reports only (the metrics contract's one level).
