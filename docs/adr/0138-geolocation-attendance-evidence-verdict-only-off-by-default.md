🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0138-geolocation-attendance-evidence-verdict-only-off-by-default.id.md)

# ADR-0138 — Geolocation attendance evidence: verdict-only, off by default, short retention

- **Status:** Accepted; **implemented by Issue #970** (migration `sql/306`, module `hr_workforce`; see "Status of the implementation")
- **Date:** 2026-10-12
- **Decision maker:** ahliweb
- **Extends:** [ADR-0132](0132-hr-payroll-module-family-admission.md) (the `hr_workforce` attendance design; this ADR is the "own ADR" its §4.3 required), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) (the subject is the tenant user; export and deletion are two authorities)
- **Related:** Issue #948; downstream `ahliweb/awcms-one` DoR owner decision O6, answered 10 Oct 2026, and that repository's `docs/aw-business-platform-threat-model.md` §5.2 (legal role), §5.4 (attendance geolocation), §5.5 (retention) and control C-22; [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) §4.2–§4.3; ADR-0037 and `src/modules/data-lifecycle` (the retention framework); ADR-0063 (authorization chokepoint)

## Context

Owner decision O6 allows attendance to use **geolocation only** — **no photo, no biometric and no device fingerprint, ever** — and requires it to be **off by default per tenant**. ADR-0132 recorded that the answer _permits_ a design but does not admit a feature, and left §4.3 empty by construction. The awcms-one threat model (§5.4) lists the constraints (default off, check-in/out only, purpose limitation, minimisation, exclusions, bounded retention, notice, restricted access, spoofing, impact assessment) and explicitly leaves the central question open for this repository: **raw coordinates or a verdict?**

Facts that shape the options:

- Location of a person at work is behavioural personal data and, at a home address or a clinic, can reveal far more than attendance (residence, health, religion, union activity). Whether it is "specific personal data" under UU No. 27 of 2022 (UU PDP) is not settled and is for counsel; this ADR treats it as high-sensitivity regardless.
- In employment the data subject cannot freely refuse, so **consent is not a safe sole lawful basis**; the lawful basis is the tenant's determination as controller (the platform is a processor for tenant employee data, threat model §5.2), with counsel.
- Client-reported coordinates are trivially spoofable. Evidence of this kind is a supporting indicator, never proof.
- `hr_workforce` attendance events are append-only and `supersedes`-chained (ADR-0132 §4.2); evidence must not break that, and must be purgeable independently of the event, which is payroll-relevant and retained longer.

## Options considered

| Option                                                                                                              | Security / privacy (UU PDP)                                                                                    | Accuracy for the purpose                                            | Operational complexity                                                                  | Verdict                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A. Store raw coordinates + accuracy on the event                                                                    | Worst: a movement trail and home location sit in the table, in every backup, export and breach                 | Highest; allows re-analysis (also a purpose-creep risk)             | Low to build, high to defend (access, masking, retention, DSR)                          | Rejected                                                                 |
| B. Store rounded coordinates (for example 3 decimals, about 100 m)                                                  | Still pins a home or clinic to a street; false comfort, still a trail; needs the same controls as A            | Good                                                                | As A                                                                                    | Rejected                                                                 |
| **C. Evaluate server-side against a tenant geofence, persist only a verdict and coarse bands, discard coordinates** | Best: no coordinate ever at rest, so none in backups, exports or breaches; nothing to track a person with      | Sufficient: the purpose is "was the check-in at an authorised site" | Medium: geofence definitions and a pure evaluator; coordinates must be kept out of logs | **Chosen**                                                               |
| D. Evaluate on the client and send only the verdict                                                                 | Good at rest, but the server cannot re-check, the verdict is trivially forged and its provenance is unprovable | Poor                                                                | Low                                                                                     | Rejected                                                                 |
| E. Raw coordinates kept in a short-lived table for a dispute window, then reduced to the verdict                    | Better than A, but the raw window is still a trail and a purge job becomes the only safeguard                  | Highest during the window                                           | Highest (two stores, two retentions)                                                    | Rejected for v1; revisit only by a new ADR with a DPIA that shows a need |

## Decision

### 1. Verdict-only evidence (option C)

When the feature is enabled for a tenant and an employee records a `clock_in` or `clock_out` (no other event kind, no continuous or background capture), the client may send one position sample with its reported accuracy. The **server evaluates it in the request against the geofence(s) of the event's office and discards the coordinates**. Only this is persisted:

- `verdict` ∈ {`inside`, `outside`, `not_provided`}: `not_provided` covers an employee who declined, a device with no fix, or a sample whose accuracy is worse than the tenant's configured ceiling (never counted as `inside`);
- a **coarse distance band** to the nearest geofence (for example `within`, `lt_250m`, `lt_1km`, `gte_1km`) and a coarse **accuracy band**;
- the geofence reference, the evaluator rule version and the server evaluation time.

**No coordinate, no raw accuracy, no altitude, no speed, no heading, no address, no device or network identifier, no photo or image, no biometric** is stored in any table, queue, outbox row, event payload, audit row, log line, export or cache. Request-log scrubbing of the position parameters is part of the implementation and has a test. Raw coordinates exist only in the request's memory.

A **geofence** is an authorised work-site definition owned by the tenant (a circle or a small polygon attached to an office), configured by an administrator. It describes a place of business, not a person, and is not personal data.

### 2. A separate append-only table, linked to the event, never a column on it

Evidence lives in its own table (planned name `awcms_hr_attendance_location_evidence`), one row per attendance event at most, `tenant_id`, RLS `FORCE`, append-only for `awcms_app`, tenant-scoped composite FK to the event. The attendance event row itself is unchanged and carries **no** location column. Consequences: the evidence can be purged by retention without touching the payroll-relevant event (ADR-0132 §4.2), and a tenant that never enables the feature has no evidence row in its blast radius. Corrections that supersede an event do not copy or rewrite evidence.

### 3. Off by default, enabled by an audited, gated act

The per-tenant switch is `false` for every tenant and cannot be enabled by a migration, a seed or an environment variable. Turning it on requires **all** of:

1. the dedicated permission `hr_workforce.geolocation_evidence.configure` (high-risk, `Idempotency-Key`, audit at `critical` severity with before/after state and actor, never any location). It is **not** granted to the default tenant roles by seed: a tenant owner or HR administrator receives it only by explicit assignment;
2. a recorded reference to the tenant's **data-protection impact assessment** (a document reference and date, not the content);
3. a **published notice version** (item 4) and at least one geofence for the office concerned.

Turning it off is always allowed (no precondition) and is audited the same way. Disabling stops capture at once; existing evidence ages out under the retention below (a tenant may additionally request erasure, §7). Module enablement is orthogonal: disabling `hr_workforce` denies everything as usual.

### 4. Notice and acknowledgement, not consent-as-basis

Before the first sample is accepted for an employee, that employee must have **acknowledged** the current notice version: what is captured (a position at check-in/out only), when, for what (verifying presence at an authorised site for the attendance record — nothing else), who can see it, how long it is kept, and that declining does not stop them clocking in. The acknowledgement is a record (employment, notice version, time) in its own small table and is re-requested when the notice version changes. The notice text is the tenant's, in the tenant's locales; the platform supplies a template. The platform records the acknowledgement as **evidence of notice**; it does not assert that consent is the lawful basis. **Declining is a first-class path**: the clock event is recorded with `not_provided` and no penalty is automated.

### 5. Purpose limitation, and what the verdict may never do

Purpose: verify presence at an authorised work site for the attendance record. The evidence **must not** feed movement tracking, productivity or performance scoring, geofence-exit alerts, route reconstruction, or any automated adverse decision. An `outside` or `not_provided` verdict only raises a **flag for human review** by an authorised reader and changes no pay, status or approval by itself. Reuse for another purpose needs a new ADR. Because client position is spoofable, the verdict is documented everywhere as a supporting indicator, not proof.

### 6. Who may read

Reads are authorised through the chokepoint (ADR-0063), default-deny. Planned permissions in `hr_workforce`:

| Permission                                    | Holder (by assignment, not by default seed) | Notes                                                                                                                          |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hr_workforce.attendance_evidence.read`       | HR and, within their scope, a supervisor    | `ownershipGrant` widens it to the employee's **own** rows only (S1 pattern); each read of another person's evidence is audited |
| `hr_workforce.geolocation_evidence.configure` | tenant HR administrator / owner             | switch, ceiling, notice version, geofences; high-risk                                                                          |

Schedulers, cashiers, marketers and payroll operators have **no** path to evidence (an S11-style test). Evidence is **not** a `profile_identity` field and appears in no list endpoint of another module. Responses are `no-store`.

### 7. Retention, enforced by `data_lifecycle`, and subject rights

The evidence table registers in the owning module's descriptor `dataLifecycle` array (the same shape `logging` uses for `awcms_audit_events`) **in the same change that creates the table** (no table without a descriptor), validated by `validateLifecycleDescriptorShape` and run by the shared `data_lifecycle` archive/purge job. Planned values, for the implementation to confirm with counsel: `cursorColumn: "evaluated_at"`, **`retentionMinDays: 30`, `defaultRetentionDays: 90`, `retentionMaxDays: 180`** — the shortest period that serves a correction or dispute window (the evidence is also not needed once the pay period it relates to is closed and its corrections window has passed), `deletion.mode: "hard_delete"` (a verdict row has no residual value once aged), `archive.archivable: false` with a stated rationale (archiving would keep personal data past its purpose), and `legalHold.applicable: true` with `precedence: "overrides_retention"`. A tenant may only shorten the default within the bounds; it cannot exceed the maximum. The table also needs a `SubjectDataDescriptor` so the `subject-data:coverage:check` gate is satisfied: an export (a separate, audited authority, ADR-0094 Decision 3) includes the employee's own evidence rows, and an erasure deletes them (maker/checker as ADR-0094); both are per tenant, the subject being the tenant user. Evidence rows must be deletable by the purge job despite being append-only for the application role, following the established lifecycle-table pattern (purge runs under the lifecycle role, not `awcms_app`).

### 8. Data-protection impact assessment is a precondition to enabling, not to building

The decision here is the design. **Enabling the feature in any tenant** (§3 item 2) requires that tenant's recorded DPIA. This ADR is itself not that assessment: it fixes the design the assessment must examine (verdict-only, 90-day default, the read roster) and the questions only counsel can answer — whether location is "specific personal data" under UU PDP, the lawful basis for employee data, the retention actually defensible, and cross-border transfer if the deployment uses a provider outside Indonesia (the threat model's section 6 list). The platform ships no legal conclusion.

### 9. Explicitly out

- **Photo, face, biometric template, device fingerprint, device or advertising identifier, network/IP or Wi-Fi/cell identifiers as evidence** — never (O6). Ordinary request logs and IP-derived data must not be repurposed as attendance evidence.
- Raw or rounded coordinates at rest, location history, continuous or background tracking, location at any moment other than `clock_in`/`clock_out`, geofence-entry/exit alerts, route or time-on-site analytics.
- Automated adverse decisions on location alone; use for productivity scoring or any non-attendance purpose.
- Any provider call (maps, reverse geocoding) in this path: the evaluator is pure geometry against stored geofences, so no coordinate leaves the server.
- Kiosk or `import` sources claiming a position; only `source = self` may carry a sample (a kiosk is a place, not a person).
- A tenant-wide hard requirement that every employee share location; the feature never blocks clocking.

## Consequences

- No coordinate is ever at rest, so none appears in a backup, export, breach or legal-hold set; the privacy and breach-impact surface of the feature is the smallest that still serves the purpose.
- The cost is lower analytical power (no re-evaluation if a geofence was mis-drawn) and a pure evaluator plus geofence administration to build; accepted.
- A real attacker can still spoof a fix; the design says so and forbids automated decisions on it.
- Because the DPIA gates **enabling**, the work can be built and tested while remaining inert everywhere.

## Status of the implementation

**Implemented by Issue #970** (migration `sql/306`, `src/modules/hr-workforce`, OpenAPI `hr-workforce.openapi.yaml`). No AsyncAPI event was added: nothing publishes a domain event about evidence, by design (an event payload is a copy). What exists, point by point against this ADR:

- **§1 verdict-only.** `awcms_hr_geofences` (circle or 3-32 vertex polygon, attached to an office, soft delete and restore) and a pure evaluator (`domain/hr-geolocation-evaluator.ts`, rule version 1). The clock route accepts an optional `positionSample` (`latitude`, `longitude`, `accuracyMeters`, nothing else) only on a `self` `clock_in` / `clock_out`; the server evaluates it in the request and drops it. Only the verdict, a distance band (`within`, `lt_250m`, `lt_1km`, `gte_1km`), an accuracy band (`lt_25m`, `lt_100m`, `lt_500m`, `gte_500m`), the geofence, the rule version and the database time are stored. Request-log scrubbing: the shared redaction (`_shared/redaction.ts`) now redacts the keys `latitude`, `longitude`, `coordinate`, `geolocation`, `positionsample` and the same words printed into free text; the idempotency request hash covers only the presence of a sample, never its value; validation errors name the field and never echo a value.
- **§2 separate table.** `awcms_hr_attendance_location_evidence`: RLS `FORCE`, composite tenant keys to the event, the employment and the geofence, one row per event, no UPDATE / DELETE / TRUNCATE for `awcms_app` and an UPDATE trigger for everyone. The event table is untouched.
- **§3 off by default, audited gate.** `awcms_hr_geolocation_settings.enabled` defaults `false` and no migration or seed writes a row. Enabling needs `hr_workforce.geolocation_evidence.configure` (403), a DPIA reference and date, a published notice and a live geofence (409 each, also enforced by a CHECK and a trigger). The permission is **not** granted to the tenant owner: it stays `scope = 'tenant'` but is listed in `OWNER_GRANT_EXCLUDED_PERMISSION_KEYS`, which both the new-tenant blanket grant and the owner backfill job honour. Disabling has no precondition, and a holder of the ordinary `hr_workforce.settings.configure` may send a bare `{ "enabled": false }`. Both directions are audited at `critical` severity with the before / after state. The database refuses an evidence insert while the switch is off, so disabling stops capture immediately.
- **§4 notice and acknowledgement.** Append-only `awcms_hr_geolocation_notices` (locale -> text) and `awcms_hr_geolocation_notice_acknowledgements` (employment, notice version, time; written only by the employment's own linked login). A sample from an employee who has not acknowledged the current version is dropped and recorded as `not_provided`, exactly like a declined fix.
- **§5 purpose.** The verdict feeds nothing: no event, report, projection or notification reads it. It is documented everywhere as a supporting indicator.
- **§6 readers.** `hr_workforce.attendance_evidence.read` (by assignment) and an `ownershipGrant` on `?mine=true`; every read of other people's verdicts is audited; responses are `no-store`. Both permissions are new catalogue rows seeded by `sql/306`. `attendance_evidence.read` is tenant-wide and HR-only: there is no supervisor scope and no manager-chain basis (a recorded limitation, M-3). A supervisor reads nothing unless HR deliberately assigns the permission, and then reads every employee's verdicts.
- **§7 retention.** The evidence descriptor is `executionMode: "generic"`, `evaluated_at`, 30 / 90 / 180 days, `hard_delete`, no archive, legal hold overrides; the engine runs as `awcms_worker` with `SELECT, DELETE` on that table only. The four other new tables are retained (`delegated`) and counted through the `sql/306` replacement of the count-only function of `sql/303`. Subject data: the evidence and acknowledgement tables are exportable through the employment (ADR-0142); because ADR-0142 allows only `retain_under_obligation` for an indirect path and the table is append-only for the application role, an erasure request is satisfied by the retention bound (at most 180 days, a tenant may shorten it) and a legal hold, not by an immediate delete. **Open for counsel:** whether an erasure request must delete the verdicts sooner than the bound.
- **§8-§9.** The DPIA is a precondition to enabling, not to building: the work is inert in every tenant. Nothing in the path calls a provider, stores a photo, biometric, device or network identifier, or blocks clocking.

**Deviation from §7, pending counsel (H-1).** §7 says an erasure deletes the employee's evidence rows. The implementation does not do that through the subject-request executor, and this is recorded as a deviation, not a settled design:

- The ADR-0142 registry gate allows only `erasure: "retain_under_obligation"` for a table reached through an indirect subject path (the evidence table has no person column of its own, by design: it holds a verdict and an employment reference). A direct subject column would be needed to declare `hard_delete`, and the executor runs `DELETE` as the request role (`awcms_app`), which has no DELETE on this append-only table. Granting it would remove the append-only guarantee the ADR requires (§2). So the framework forbids erasure-through-the-executor for this table without changing ADR-0142 or ADR-0138 §2.
- What exists instead: the verdicts leave by retention at most 180 days after the check (a tenant may only shorten the default), a legal hold overrides retention, and an operator-run `awcms_hr_erase_location_evidence(tenant, employment)` (`sql/306`, EXECUTE to `awcms_worker` only, a NOLOGIN owner holding DELETE and a two-column SELECT, audited at `critical` by `eraseLocationEvidenceForEmployment`) deletes one employment's verdicts immediately. It is NOT wired to the subject-request executor. **Counsel decides whether an erasure request gets immediate deletion (run that function) or waits for the retention bound; until counsel signs off, enabling the feature in any tenant is blocked** (it is also gated by the tenant's DPIA, §3 and §8).
- The `retain_under_obligation` value in the subject-data descriptor is a registry label. It must not be read as "a law obliges the employer to keep these rows": the rows are kept only for the purpose they were collected for (checking a check-in within the correction and dispute window) and for the bounded retention.

Hardening after the security audit: a geofence is at least a 50 m circle or a simple polygon of at least 2,500 square metres spanning at most 10 km (no repeated vertex, no crossing edges), an office has at most 10 live geofences, a tenant whose switch is on cannot delete its last live geofence (database trigger and 409), every geofence create/replace is audited with a revision and a geometry fingerprint (never coordinates), the evidence guard refuses a verdict naming a deleted geofence or one of another office than the check-in's, the worker may read only `id`, `tenant_id` and `evaluated_at` of a verdict (plus DELETE), and a trigger on `awcms_role_permissions` refuses attaching the configure permission to a system `owner` role. **§6 is narrower than written:** `attendance_evidence.read` is tenant-wide and HR-only. There is no supervisor scope and no manager-chain basis; a supervisor reads nothing unless HR deliberately assigns the permission, which then reads every employee's verdicts. A client-reported position is forgeable: the verdict is a supporting indicator for human review, never proof.

**Open questions recorded by the audit (documented, not implemented):** two items are open and not decided here.

- **L-2, the enabling preconditions are self-attested.** The DPIA reference passes the CHECK with any non-empty text (even `x`) and any date, and the configure permission is enforced in application code only, so an actor with direct SQL can enable. Open: require a stricter reference shape and a date no later than today, and/or a second approver (maker/checker, ADR-0094) so the person who assigns themselves `configure` cannot also enable alone.
- **L-5, notice acknowledgements are retained indefinitely.** The descriptor is `retained`, personal, class `financial_tax`, and is never purged. The database trigger checks that `acknowledged_by` equals the employment's linked login but cannot verify the session actor (only the route does). Open: a retention decision for acknowledgements (for example the notice is superseded plus N years) and an appropriate retention class.

For counsel: whether location is specific personal data under UU PDP; the lawful basis for employee data; whether acknowledgement of a notice is adequate evidence of notice; the defensible retention bound (30 / 90 / 180 days); whether an erasure request overrides the bound; cross-border transfer for any provider outside Indonesia.

Other deviations a reader should know about: the retention class is `system_event` (the registry has no personal-data class); the notice is a per-locale text map rather than a separate template table; and there is no admin screen (the issue asks for none), so both permissions are on the shrink-only `NOT_YET_SCREENED` ledger.

## Required tests for the implementation (acceptance carried into the issue)

1. A fresh tenant has the switch off; a clock event with a position sample records **no** evidence row; enabling without the permission is `403`, without a DPIA reference or notice or geofence is `409`.
2. No column, queue row, event payload, audit row, log line or response contains a coordinate (a source-level scan plus a runtime assertion with a distinctive sample value).
3. A sample worse than the accuracy ceiling yields `not_provided`, never `inside`; a declined sample records the clock event normally.
4. Only `source = self` may carry a sample; a kiosk or import event with a position is refused.
5. The reader roster: an employee reads only their own rows; HR/supervisor within scope; scheduler, cashier, marketer, payroll operator receive `403`; reads of another person's evidence are audited.
6. The descriptor validates, the purge job removes rows past the bound under a legal-hold-aware path, and a legal hold blocks it; the subject-data descriptor satisfies the coverage gate and export/erasure include the rows.
7. Disabling the switch stops capture immediately; module disablement denies everything.
