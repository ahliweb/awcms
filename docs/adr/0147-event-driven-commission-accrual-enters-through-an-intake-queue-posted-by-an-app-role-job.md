🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0147-event-driven-commission-accrual-enters-through-an-intake-queue-posted-by-an-app-role-job.id.md)

# ADR-0147 — Event-driven commission accrual enters through an `hr_commission`-owned intake queue that an `awcms_app` job posts; the worker role gets `INSERT` on that queue and nothing on payroll

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision maker:** ahliweb (owner: "implement the recommended option")
- **Resolves:** Issue #1138 (downstream `ahliweb/awcms-one#391`, whose ADR-0046 attributor is shipped dormant until this exists)
- **Amends:** [ADR-0132](0132-hr-payroll-module-family-admission.md) §7 (adds how a SYSTEM consumer, one with no signed-in person, posts a commission). It does not reverse anything in it and it does not touch §8 (payroll).
- **Extends:** [ADR-0006](0006-offline-first-sync-outbox.md) (no provider or privileged work inside the consumer's transaction), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md) (consumers depend on a neutral port), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md) §3 (one queue per concern, lease claim), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md) (consumers are declared in a module descriptor and run in `domain-events:dispatch` as `awcms_worker`), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md)
- **Related:** Issue #1015 (the payroll catalog boundary), #1077 (its hardening), #1095 (residual gaps), #951 and #1109 (`CommissionAccrualPort.accrue` and `void`), [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) §6 and §13.3, `src/modules/_shared/payroll-data-boundary.ts`, `scripts/lib/payroll-catalog-boundary.ts`

**Docs and governance only.** This ADR adds no table, migration, route, job, port file or dependency. The implementation is a new issue (linked from #1138) whose scope and acceptance derive from §7.

## Context

`CommissionAccrualPort` (ADR-0132 §7, contract `commission_accrual` 1.1.0) is posted from a consumer's **composition root**: a route handler or a job. The posting core (`accrueCommission`, `voidAccrual`) and the accrual guard triggers run in the **caller's transaction with the caller's privileges**.

A downstream adapter that accrues on a domain event, such as the commerce `order.paid` attributor in awcms-one, runs in `domain-events:dispatch` as `awcms_worker`. To post through the port it would need `SELECT` and `INSERT` on `awcms_hr_commission_accruals` and `awcms_hr_commission_transitions`, column `UPDATE` for `void`, and `FOR SHARE` on rules and employments (which Postgres treats as `UPDATE (id)`).

The payroll boundary correctly forbids every one of those grants. `PAYROLL_ALLOWED_GRANTEES = ["awcms_app"]`; `PAYROLL_WORKER_EXECUTE_ALLOWLIST` is empty and in any case limited to scalar-count functions. The reason is stated at the top of `payroll-data-boundary.ts`: `awcms_worker` runs unattended jobs and so must never read a person's pay row by row, and an accrual **is** one employee's earnings (the table name is in `FORBIDDEN_PAYROLL_TABLE_PATTERNS` for that reason). The result is that **there is no sanctioned way for an event-driven consumer to accrue or void**, and the downstream shipped the adapter dormant (its migration 1053 revokes the worker's payroll grants and enabling the adapter is refused).

Three facts shape the choice:

- The posting core is large and security-critical: exactly-once by source identity, the rule chosen by the event's own date, the `FOR SHARE` parent locks, the database re-computing the amount, the audit row and the domain event written in the caller's transaction, and the beneficiary snapshot. It exists once, in TypeScript, with a SQL twin only for the amount arithmetic.
- `accrue` already accepts a **null actor** (the columns `created_by` and the transition's actor are nullable for "system-created", `sql/188`); `void` does not, because every status edge stamps a person (`actor_required`).
- There is a precedent for "a privileged-table job runs as `awcms_app` instead of the worker": `telegram:chat:rekey` is a pure database operation run as `awcms_app` because the binding guard refuses the worker role. Since Issue #1132 (rows 5 and 6) `ops/run-job.sh` derives, from each job's import closure, which jobs keep the `DATABASE_URL` that role needs, so a new such job needs no hand-kept list.

## Decision

**An event-driven consumer does not post. It submits an intake record, and a job that runs as `awcms_app` posts.** Concretely:

### 1. The intake queue is owned by `hr_commission` and is not a payroll-family table

A new table (working name `awcms_hr_commission_intents`; the name is **not** matched by `FORBIDDEN_PAYROLL_TABLE_PATTERNS`, which is deliberate and is checked in the implementation's tests) holds one row per submitted request:

- `tenant_id`, `kind` (`accrue` | `void`), the source identity `(source_type, source_ref, source_line)`, `employment_id` (a composite foreign key with `tenant_id`), and the request fields the port already takes: `rule_key`, `base_amount` or `units`, `currency_code`, `occurred_at`, `occurred_on`, `correlation_id`; for `void` also `reason` and the person who voided the sale (`actor_tenant_user_id`).
- `request_digest` (the same canonical digest the ledger uses), `status` (`pending` | `posting` | `posted` | `refused` | `failed`), `outcome_code`, `attempts`, `next_attempt_at` (also the lease), and timestamps.
- A unique key on `(tenant_id, kind, source_type, source_ref, source_line, employment_id, request_digest)`: a redelivery of the **same** request is `duplicate`; the **same identity with a different request** is stored as a second row and surfaces at posting as the ledger's own `source_conflict`, instead of being swallowed by the unique key.
- RLS `FORCE` on `tenant_id`, `USING` and `WITH CHECK`; a `subjectData` descriptor (ADR-0094) and a `data_lifecycle` descriptor in the same migration; terminal rows are purged by the `delegated` form with `updated_at` as the cursor, never age alone.

**Grants.** `awcms_worker` receives `INSERT` on this table and **nothing else**: no `SELECT`, `UPDATE` or `DELETE`, and no privilege on any payroll-family object. The worker therefore cannot read back what it submitted or how it was settled, and cannot touch a posted accrual. `awcms_app` receives what the poster job needs. `scripts/security-readiness.ts` (`WORKER_ROLE_GRANTS`) lists exactly this one verb.

### 2. A new neutral port, `commission_intake` 1.0.0, in `_shared/ports/`

`submitAccrual(tx, tenantId, actorTenantUserId | null, request)` and `submitVoid(tx, tenantId, actorTenantUserId, request)` take **the same request shapes** as `CommissionAccrualPort` and run the **same pure validators**. They perform one `INSERT ... ON CONFLICT DO NOTHING` in the caller's transaction and return `queued`, `duplicate`, `input_invalid`, `actor_required` (a `void` with no person) or `disabled`. They never return an accrual, an amount or a rule. `CommissionAccrualPort` stays exactly as it is (`commission_accrual` 1.1.0): it remains the synchronous seam for a route that has a signed-in person and a live transaction.

### 3. The poster job runs as `awcms_app` and reuses the one posting core

A module job (working name `hr-commission:intents:post`, a short interval, declared in the module descriptor so the crontab and the registry gates cover it) opens the **app** client, claims intake rows per tenant with `FOR UPDATE SKIP LOCKED` in a short transaction, and for each row calls the existing `accrueCommission` / `voidAccrual` inside a tenant transaction with the stored actor. The ledger's outcome (`accrued`, `replayed`, `source_conflict`, `no_effective_rule`, `period_closed`, `not_found`, ...) is mapped to `posted` (success, replay, `already_voided`), `refused` (a business refusal: terminal, never retried) or a bounded retry for a transient error that ends in `failed`. There is **one** posting implementation, so the audit row, the domain event, the transition-log row, the SoD snapshot and the triggers are byte-identical to the synchronous path. Because the job reaches `getDatabaseClient()`, `ops/run-job.sh` keeps `DATABASE_URL` for it automatically (Issue #1132), and it is the only scheduled job that does.

### 4. Authorization is by registration and by a per-tenant opt-in, not by a session

There is no signed-in person in a domain-event consumer, and the port documentation is explicit that the composition root authorizes. For this path the authorization is two facts, both **default-deny**:

1. the consumer is declared in a module descriptor (ADR-0134) that lists `commission_intake` in `capabilities.consumes`, i.e. reviewed code, not a runtime caller; and
2. the tenant has switched the intake on: `hr_commission` enabled through Module Management **and** a tenant setting `commission_intake_enabled` (default `false`) changed only by a high-risk, separately grantable permission (working name `hr_commission.intake.configure`), audited at `warning`.

With the setting off, `submit*` answers `disabled` and writes nothing, and the poster claims nothing.

### 5. Outcomes are visible without giving the worker a read path

A refused or failed intake is a **monitored exception**, not a silent drop: the poster job reports counts through the job diagnostics, a read-only admin list of intake exceptions (permission-gated, outcome code and masked ids only, no amount) shows what a human must look at, and the existing `awcms.hr.commission.*` events carry the successes. The consumer never needs the answer synchronously.

### 6. What does not change

`PAYROLL_ALLOWED_GRANTEES` stays `["awcms_app"]`. `PAYROLL_WORKER_EXECUTE_ALLOWLIST` stays empty. No `SECURITY DEFINER` posting function is added, and the payroll catalog boundary check (`payroll:catalog-boundary:check`) needs no exemption. `commission_accrual` stays 1.1.0 and `POST /api/v1/hr-commission/accruals` is unchanged.

### 7. Gates for the implementation issue

A migration with RLS `FORCE` and the grants above; a boundary test that the worker holds no privilege on any payroll-family relation and exactly `INSERT` on the intake table; the payroll catalog check green with no new exemption; the `subjectData`, `data_lifecycle` and permission-seed gates; the port and descriptor wiring; OpenAPI for the exceptions list and AsyncAPI only if a new event is added; and tests for: two tenants (a submit in one never posts in the other), exactly-once under ten parallel submits and under a poster retried after a crash, `source_conflict` visibility, a `void` with no actor, `period_closed` routed to a human, the setting off, and a worker session that tries to `SELECT` the table or any accrual.

## Options considered

| Criterion              | **B. Intake queue + `awcms_app` poster (chosen)**                                                                                      | A. `SECURITY DEFINER` `accrue`/`void` functions with a worker allow-list class                                                                                                                                                        | C. The consumer calls the HTTP accrual route with a machine actor                                                                    | D. Stay dormant (status quo)          | E. Widen the worker's grants on accruals                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| Security               | The worker can only append an intent. It cannot read, post, void, or reach a payroll row. The boundary and its two lists are unchanged | The worker can **write** accruals for any tenant and employment it names, through a function that must set the tenant context from an argument (a cross-tenant primitive), and it widens the empty `PAYROLL_WORKER_EXECUTE_ALLOWLIST` | Needs a machine credential able to call a high-risk route, and a way for the worker to hold it; widens the secret surface of the job | None added; feature unusable          | Directly violates the boundary the audits (#1015, #1077) built; reads pay per row |
| Performance            | One INSERT per event; posting is batched off the request path                                                                          | One function call per event, inline                                                                                                                                                                                                   | A network hop and a full request pipeline per event                                                                                  | n/a                                   | Inline                                                                            |
| Maintainability        | **One** posting implementation (TypeScript) and one intake table                                                                       | A second posting implementation in PL/pgSQL (rule evaluation, parent locks, audit row, event, beneficiary snapshot) that must be kept equal to the first; the SQL twin today covers only the amount                                   | One implementation, but it couples the worker to the web tier's availability and auth                                                | None                                  | One implementation                                                                |
| Scalability            | Queue absorbs bursts; the poster is lease-based and bounded                                                                            | Inline cost in the dispatcher's transaction                                                                                                                                                                                           | Bounded by the web tier                                                                                                              | n/a                                   | Inline                                                                            |
| Compatibility          | Additive: a new port and table, existing port untouched                                                                                | Additive in SQL, but changes the meaning of the worker allow-list                                                                                                                                                                     | No change to hr_commission, but a new internal-HTTP dependency in every consumer                                                     | None                                  | Breaks `payroll-grant` findings                                                   |
| Operational complexity | One more job and one more table to monitor; latency is the poll interval                                                               | No new job, but a privileged function surface to review on every change                                                                                                                                                               | Credential rotation and retry logic in each consumer                                                                                 | None                                  | None, and a standing audit finding                                                |
| Long-term implications | The same shape serves any future system consumer (booking-driven commission, an import) without another privilege decision             | Each new consumer inherits a worker that can write earnings                                                                                                                                                                           | Re-implements an outbox by hand in every consumer                                                                                    | The downstream capability never ships | Erodes the boundary one exception at a time                                       |

**Why B.** It is the only option that keeps the boundary's invariant ("the worker never touches a person's pay") true by construction while reusing the single audited posting core. Its price is latency (the poll interval) and one more queue; both are acceptable for commission, which is approved by a human before it is ever payable.

### Compliance reading

- **UU PDP No. 27/2022.** Earnings are personal financial data. The design keeps the processing in the role that already holds the payroll controls, minimises what the unattended role can see to nothing, and bounds the intake table's retention (purge of terminal rows, default 30 days, floor 7, ceiling 90, to be confirmed by the owner in the implementation). Security safeguards of the controller (Art. 35) are strengthened rather than relaxed. Whether the operator is controller or processor (owner decision O5) is unaffected.
- **PP 71/2019 (electronic systems).** The operator must keep its systems secure and reliable; removing a standing write path from an unattended role is consistent with that and adds an auditable queue.
- **ISO/IEC 27001:2022 / 27002:2022.** Least privilege and access restriction (5.15, 5.18, 8.2, 8.3), logging (8.15), information deletion (8.10), secure coding (8.28: one implementation instead of two), PII protection (5.34).
- **ISO/IEC 27005.** The risk "an unattended job can create or alter earnings" is **removed** rather than mitigated. New residual risks are recorded in Consequences.
- **ISO/IEC 27701 and 27034.** The posting core is the application's normative control for exactly-once and segregation of duties; routing every path through it keeps that control single. The intake table inherits the data-subject and retention obligations of the module (ADR-0094).

## Consequences

- **Positive:** downstream `awcms-one#391` can enable its attributor once the implementation lands and the subtree is synced; the payroll boundary, its catalog check and its two lists are untouched; one posting implementation.
- **Negative / trade-off:** accrual is **eventually consistent** (it appears after the next poster tick); a business refusal is discovered by the exception list, not by the consumer; a second table and a job to operate.
- **Residual risks (ISO/IEC 27005):** (1) a compromised worker can **append** bogus intents for any tenant with the intake switched on, which become `pending` accruals that a human must still approve and, separately, pay (the existing maker/checker and beneficiary-SoD controls bound this; the per-tenant switch and the exception list make it visible). (2) The intake table holds a sale's base amount and an employment id for the retention window: it is derived earnings data and is treated as sensitive in logs and audit (ids and codes only). (3) A poster outage lets intents accumulate: monitored by age, with an alert threshold chosen in the implementation.
- **Rollback** is forward-only like every migration here: set `commission_intake_enabled` off (the port answers `disabled`), stop the job, keep the table inert.
- **Nothing is built by this ADR.** The downstream remains dormant until the implementation issue merges.

## Alternatives rejected

- **`SECURITY DEFINER` posting functions (A).** Duplicates the posting core in SQL, hands the worker a write primitive that needs the tenant as an argument, and turns the empty worker allow-list into a permanent exception class. Issue #1138 offered it as one example; the analysis above prefers the other example it offered.
- **A machine actor over HTTP (C).** An outbox reinvented per consumer, with a credential in the job.
- **Granting the worker accrual privileges (E).** The boundary exists to forbid exactly this.
- **Staying dormant (D).** Leaves the downstream capability permanently blocked, with no recorded decision.
- **Moving the dispatcher (or one consumer) onto the app role.** Changes the privilege of every consumer to serve one.
