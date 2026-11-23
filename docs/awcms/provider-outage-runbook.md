🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](provider-outage-runbook.id.md)

# Provider outage, queue age, and uncertain-outcome runbook

> **Status (Issue #1412):** an audit of what already exists, the few measurements that were proven absent and are now added, and the operator procedure. It builds on the existing telemetry ([`observability-metrics.md`](observability-metrics.md), `src/lib/observability/metrics-port.ts`, `src/lib/database/circuit-breaker.ts`) and creates **no second metrics path, no shared gateway, no new provider queue, and no mandatory external monitoring service**. The outcome vocabulary it uses (`succeeded`, `accepted`, `not_sent`, `confirmed_failed`, `unknown`) is the contract of Issue #1410 (`src/lib/integration/provider-outcome.ts`, `provider-outcome-contract.md`); where that contract has not landed in a deployment yet, read it as the classification below. Provider boundaries stay port/outbox owned by the domain (ADR-0169).

## 1. Evidence table: existing versus added versus absent

### 1.1 Shared signals

| Signal                                                                                              | State                         | Evidence                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider call count and latency, by provider family                                                 | Existing                      | `provider_call_total{provider,outcome}`, `provider_call_duration_ms{provider}` in `METRIC_DEFINITIONS`; emitted by `decorateWithMetrics` in `circuit-breaker.ts` |
| Circuit state per provider family (0 closed, 1 half-open, 2 open)                                   | Existing                      | `provider_circuit_state{provider}`; family label bounded by `deriveProviderFamilyLabel`                                                                          |
| Job run status, duration, per-run item counts                                                       | Existing                      | `job_run_total`, `job_run_duration_ms`, `job_run_item_count` from `src/lib/jobs/job-runner.ts`; **only** jobs that use `runJob` (see 1.2)                        |
| Domain event outbox backlog, oldest pending age, dispatch outcomes                                  | Existing, **corrected** (1.3) | `domain_event_delivery_backlog`, `domain_event_delivery_oldest_pending_seconds`, `domain_event_dispatch_total`                                                   |
| Pending depth, longest-overdue age, expired leases for email, whatsapp, telegram, push, object sync | **Added**                     | `queue_pending_count`, `queue_oldest_due_age_seconds`, `queue_expired_lease_count`; `src/lib/observability/queue-health.ts`                                      |
| Uncertain-outcome counter for email, social publishing, telegram engagement                         | **Added**                     | `queue_uncertain_outcome_total{queue}`; recorded by the dispatch scripts from the counts the dispatchers already return                                          |
| Job-log line per dispatcher: `<job> queue — pending=N oldestDueAgeSeconds=N expiredLeases=N`        | **Added**                     | `formatQueueHealthLine`; shape pinned by `tests/queue-health-metrics.test.ts`                                                                                    |
| Provider HTTP 429 / 5xx counter                                                                     | **Absent** (deferred)         | `provider_call_total` has only two outcomes and `circuit-breaker.ts` is not changed here; the outcome classification belongs to #1410 / #1426 (section 8)        |
| Circuit flapping                                                                                    | Derivable, no new code        | `changes(provider_circuit_state[15m])` over the existing gauge (section 5)                                                                                       |
| Authorized dependency-health endpoint (`GET /api/v1/logs/observability/dependency-health`)          | **Absent**                    | Documented as planned in `observability-metrics.md`; no route exists. `getProviderCircuitBreakerFamilyStates` has no caller outside `circuit-breaker.ts`         |
| Public aggregate DB health                                                                          | Existing                      | `GET /api/v1/database/pool/health`, `GET /api/v1/health` (database breaker only, no provider families)                                                           |
| A registered metrics adapter or scrape endpoint                                                     | **Absent by design**          | No code path calls `setMetricsPort` outside documentation; the default is the no-op port. A deployment opts in (`observability-metrics.md`)                      |

### 1.2 Per delivery domain

"Attempts" is the per-message retry counter or the per-attempt ledger; "age" is a gauge of how old the oldest waiting row is; "dead letter" is a terminal status that needs a human.

| Domain (job)                                         | Attempts                                                       | Queue age and depth                                                     | Expired lease                                                            | Uncertain outcome                                                                                                   | Dead letter / terminal                     | Operator lever                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Email (`email:dispatch`)                             | `retry_count`, `awcms_email_delivery_attempts`                 | **Added** (`email`)                                                     | **Added**; re-claim marks the row uncertain                              | **Added** counter + log `email.dispatch.uncertain_redelivery`; **not persisted** as a column (note in `last_error`) | `failed`, `suppressed`                     | `POST /api/v1/email/messages/{id}/cancel`                                        |
| WhatsApp (`whatsapp:dispatch`)                       | `retry_count`, `awcms_whatsapp_delivery_attempts`              | **Added** (`whatsapp`)                                                  | **Added**                                                                | Re-claim after lease expiry only; no counter (not returned by the dispatcher)                                       | `failed`, `expired`                        | `GET /api/v1/whatsapp/diagnostics`; senders/suppressions routes                  |
| Telegram staff (`telegram:dispatch`)                 | `retry_count`, `awcms_telegram_delivery_attempts`              | **Added** (`telegram`)                                                  | **Added**                                                                | No counter (not returned)                                                                                           | `failed`, `expired`                        | `GET /api/v1/telegram/diagnostics`                                               |
| Push (`push:dispatch`)                               | `retry_count`, `awcms_push_delivery_attempts`                  | **Added** (`push`)                                                      | **Added**                                                                | No counter (not returned)                                                                                           | `failed`                                   | `GET /api/v1/push/diagnostics`; `POST /api/v1/push/messages/{id}/cancel`         |
| Object sync (`sync:objects:dispatch`)                | `retry_count`                                                  | **Added** (`object_sync`)                                               | **Added**                                                                | Not modeled                                                                                                         | `failed`                                   | `POST /api/v1/sync/object-queue/{id}/retry` (`sync_storage.object_queue.retry`)  |
| Social publishing (`social-publishing:dispatch`)     | `attempt_count`, `hold_count`, `awcms_social_publish_attempts` | Not probed (dedicated DB role, section 8)                               | Not probed; an expired `publishing` lease becomes `needs_reconciliation` | **Added** counter (`unknown`); status `needs_reconciliation` is persisted                                           | `failed`, `needs_reconciliation`           | `POST /api/v1/social-publishing/jobs/{id}/retry` with `confirmPossiblyPublished` |
| Telegram engagement (`telegram-engagement:dispatch`) | `next_attempt_at`, `lease_until`                               | Not probed (dedicated DB role, section 8)                               | Recovered as `uncertain` by the dispatcher itself                        | **Added** counter; status `uncertain` is persisted and never retried                                                | `failed`, `uncertain`                      | Diagnostics of the module                                                        |
| Domain events (`domain-events:dispatch`)             | per-delivery attempt counters                                  | Existing backlog and oldest-pending gauges (**corrected** to aggregate) | n/a (atomic claim, handler, finalize)                                    | n/a                                                                                                                 | `dead_letter` (gauge `status=dead_letter`) | `POST /api/v1/domain-events/deliveries/{id}/replay`, consumer pause and resume   |

The dispatchers other than domain events and the few `runJob` jobs do **not** use `runJob`, so they emit no `job_run_*` series: the job-log lines (`<job> complete — ...` and the new `<job> queue — ...`) are their output.

### 1.3 A defect found and fixed by the audit

`recordDomainEventBacklogGauges` was called once per tenant and **set** the gauge each time, so the value left in the process was whichever tenant ran last: a tenant with an hour of lag in the middle of the loop was erased by a healthy tenant at the end. The backlog is now folded across tenants once per run (counts add, oldest age is the maximum) and recorded once (`foldDomainEventBacklogRows`, `flushDomainEventBacklogGauges`). The same aggregation is used by the new queue gauges. Gauges that have no row this run (a consumer whose backlog just drained) are not reset to 0 by this module; read an absent series after a successful run as "no rows", not as "stale".

## 2. Visibility: what one process can and cannot tell you

- **The circuit breaker is per process.** Each web or worker process has its own registry. `provider_circuit_state` from one process is that process's opinion; it is **not** a global provider-health oracle, and an `open` breaker in a worker says nothing about the web process. Judge a provider by several independent signals: breaker state across processes, `provider_call_total` failure ratio, and queue age. Two workers can disagree for the length of one breaker window.
- **The new gauges are a per-run, per-process snapshot** of the tenants that run visited, aggregated across tenants (sum for depth and leases, maximum for age). They are not a fleet total. Run each dispatcher from **one** cron entry under `flock` (as `ops/awcms-jobs.crontab` does); with several hosts, take the maximum of `queue_oldest_due_age_seconds` and the maximum of `queue_expired_lease_count` across hosts, never the sum of ages.
- **The dispatchers are short-lived processes.** No code in this repository registers a metrics adapter, and a cron job exits in seconds, so the gauges and counters exist only in a deployment that registers an adapter and ships a snapshot before exit (for example a textfile exporter). Without that, the **job log line** is the signal and it is sufficient: section 5 alerts on it.
- **A probe that failed records nothing.** If the queue probe fails (permission, timeout), the dispatcher logs `queue_health.probe_failed` (queue name and a sanitized error, no tenant id) and prints no `queue` line. A missing line after a run is itself an alert condition, never "all clear".

## 3. Detect

| Signal                                                                                        | Meaning                                                                                         | First action                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `oldestDueAgeSeconds` rising across consecutive runs while `expiredLeases=0`                  | Rows are due but not being sent: provider outage (breaker open or backing off), credits, config | Section 4; check `provider_circuit_state`, the module diagnostics, and `<job> complete` (`deferred`, `breakerOpen`, `misconfigured`) |
| `expiredLeases > 0` that does not return to 0 on the next run                                 | A worker died or hung mid-send and nothing re-claims it: the dispatcher is not running          | Check the cron entry and its lock; the next pass re-claims as an **uncertain redelivery** (possible duplicate)                       |
| `queue_uncertain_outcome_total` increases, or `needs_reconciliation` / `uncertain` rows exist | The provider may have accepted the message                                                      | Section 4 classification, then reconciliation. Never a blind retry                                                                   |
| No `<job> queue` line in the job log after a run                                              | The probe failed or the job did not finish                                                      | Read the `queue_health.probe_failed` line and the job exit status                                                                    |
| `domain_event_delivery_backlog{status=dead_letter}` > 0                                       | An event consumer exhausted its retries                                                         | Inspect `GET /api/v1/domain-events/deliveries`, fix the cause, replay                                                                |

## 4. Classify, hold, reconcile

Classify every affected message into exactly one outcome before touching it:

| Outcome                  | How it shows up                                                                                                     | May it be re-sent?                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `succeeded` / `accepted` | `sent` / `published`, external id recorded                                                                          | Never                                                                          |
| `not_sent`               | `queued` / `retry_wait`, or `deferred` (breaker open, credit hold): no contact with the provider happened           | Yes, the dispatcher does it by itself once the provider recovers               |
| `confirmed_failed`       | terminal `failed` with a provider rejection (non-retryable) or attempts exhausted                                   | Only by repeating the originating action; a confirmed failure is not re-queued |
| `unknown`                | expired lease re-claimed (email uncertain note), `needs_reconciliation` (social), `uncertain` (telegram engagement) | **Only after reconciliation**: check the provider side first                   |

**Hold.** While a provider is down, do not raise dispatcher concurrency and do not re-enqueue: backoff and the breaker are the throttle. To stop a specific message, cancel it (`email` and `push` have a cancel route). To stop a whole domain-event consumer, `POST /api/v1/domain-events/consumers/{name}/pause` (audited, `Idempotency-Key`); resume after recovery.

**Reconcile.** For `unknown` outcomes, look at the provider's own record (sent folder, delivery report, the social account) for the message's correlation id, not its recipient. If the provider has it, mark the message as delivered through the module's own flow (a social job: do not retry); if it does not, the retry in the next section is safe.

## 5. Alerts, with fault tests

Log-based (works with nothing but the job log; thresholds are placeholders to set from the baseline in section 6, not fabricated production values):

```bash
# Alert if the most recent email queue line shows overdue rows older than T seconds.
# T is a placeholder; derive it from the measured baseline (section 6).
T=900
tail -n 200 "$AWCMS_JOB_LOG/email-dispatch.log" | grep -E 'email:dispatch queue — ' | tail -n 1 \
  | awk -F'oldestDueAgeSeconds=' '{split($2,a," "); if (a[1]+0 > '"$T"') exit 1}'
```

With a registered adapter, the equivalent PromQL (adapt the thresholds):

```promql
queue_oldest_due_age_seconds{queue="email"} > 900
queue_expired_lease_count > 0
increase(queue_uncertain_outcome_total[1h]) > 0
changes(provider_circuit_state{provider=~".+"}[15m]) >= 4   # flapping
```

Fault tests that prove each alert fires (run in the second, non-production environment of ADR-0083, never in production):

| Fault                         | How to inject                                                                       | Expected signal                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider outage (stale queue) | Set the provider disabled or point it at an unreachable address; enqueue messages   | `oldestDueAgeSeconds` grows run over run; breaker `open` after the failure threshold                   |
| Dead worker (stuck lease)     | `kill -9` the dispatcher while it is sending                                        | `expiredLeases >= 1` on the next run, then an uncertain redelivery and `queue_uncertain_outcome_total` |
| Probe blind spot              | Revoke `SELECT` on the queue table from the worker role                             | `queue_health.probe_failed` in the log and **no** `queue` line (not a zero)                            |
| Stale queue drill             | Stop the cron entry for one dispatcher for longer than the alert threshold; restart | Alert fires; after restart the age falls to 0 and the alert clears                                     |

Automated coverage: `tests/queue-health-metrics.test.ts` (label bounds, cross-tenant aggregation, failed-probe behavior, log line shape) and `tests/integration/queue-health.integration.test.ts` (real PostgreSQL, worker role, overdue versus future, terminal rows, tenant isolation).

## 6. SLI and SLO: proposals that need a measured baseline

These are **proposals**. No production result is claimed. Set a target only after collecting a baseline (at least 14 days of the `queue` lines or gauges per queue, in normal operation and across at least one provider incident), then review it with the owner.

| Proposed SLI                           | Measurement                                                         | Target                          |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| Delivery freshness per queue           | fraction of runs where `oldestDueAgeSeconds` is at or below a bound | **to be set from the baseline** |
| Stuck-lease freedom                    | fraction of runs with `expiredLeases = 0`                           | **to be set from the baseline** |
| Uncertain-outcome rate                 | `queue_uncertain_outcome_total` per 1000 deliveries                 | **to be set from the baseline** |
| Dead-letter drain time (domain events) | time from first `dead_letter` to replay or resolution               | **to be set from the baseline** |

## 7. Authorized manual replay

Replay is a human, audited action, only for outcomes classified `not_sent` that the dispatcher will not pick up, or `unknown` after reconciliation. Every route below is permission-gated by default-deny ABAC in its own tenant, writes an audit event, and (where noted) requires an `Idempotency-Key`:

| Domain        | Route                                               | Permission                                              | Notes                                                                                                           |
| ------------- | --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Domain events | `POST /api/v1/domain-events/deliveries/{id}/replay` | `domain_event_runtime.deliveries.replay`                | `Idempotency-Key`; reason required; schema-compatibility checked                                                |
| Social        | `POST /api/v1/social-publishing/jobs/{id}/retry`    | `social_publishing.jobs.retry`                          | `Idempotency-Key`; `confirmPossiblyPublished: true` required for `needs_reconciliation`; bounded extra attempts |
| Object sync   | `POST /api/v1/sync/object-queue/{id}/retry`         | `sync_storage.object_queue.retry`                       | only `failed` entries                                                                                           |
| Email, push   | `POST .../messages/{id}/cancel`                     | `email.message.cancel`, `push_delivery.messages.cancel` | stop, not replay; no re-queue route exists                                                                      |

Never replay by editing rows with SQL: the status transitions, audit, and database triggers are the controls.

## 8. Rollback, incident, escalation

- **Rollback.** If a deploy caused the signal, roll back the image first; the queues are durable and the dispatchers resume from the rows. Do not purge a queue to "clear" the alert.
- **Owner and escalation.** The platform on-call owns detection and hold; the domain owner of the failing module owns reconciliation; a security owner is pulled in if the cause is a credential exposure. Contacts live in the deployment's own on-call roster, not in this repository.
- **Incident follow-up.** Record: first-detected time, affected queues, outcome counts per class (section 4), duplicates found, replays performed (with audit ids), and the baseline adjustment it justifies.
- **Known limits and follow-ups.**
  - Provider 429/5xx counting and the outcome label on `provider_call_total` need the shared outcome classification (#1410 / #1426); `circuit-breaker.ts` is deliberately untouched here.
  - Email does not persist an "uncertain" column; the count is a counter and a note in `last_error`.
  - Social publishing and Telegram engagement run as dedicated database roles with column-limited grants, so their queue age is **not** probed here (granting that role a new read would be a security-surface change that needs its own review); their uncertain counters are recorded.
  - The authorized dependency-health endpoint remains planned.

## 9. Cost budget and redaction

- **Query cost.** One aggregate per (tenant, queue) per dispatcher run: five queues, so five small index-ordered reads per tenant per run, over non-terminal rows only (`(tenant_id, status, next_attempt_at)`), in the `background_sync` work class, inside the dispatcher that already iterates tenants. It never runs on a request path. With the existing cron cadence (1 to 2 minutes) the added load is a handful of tiny reads per tenant per cadence; if a deployment has thousands of tenants, raise the cadence or sample, and verify with `bun run db:work-class:check` and the query budget.
- **Series cost.** Four new metrics, each with the single `queue` label from a code-defined set (at most 8 values): about 20 series in total. The tenant id, recipient, template, provider response text, and object key are never labels (`filterLabels` drops any key not declared in `METRIC_DEFINITIONS`).
- **Redaction.** Log lines carry counts and the queue name only. The probe failure line carries a sanitized error (`safeErrorDetail`), never a tenant id, recipient, or provider body. Correlation ids (not tenant or user ids) are the join key between a signal and the audit and attempt records.
- **Tenant-safe access.** The probes run per tenant under row-level security as the worker role; the admin diagnostics routes listed above are tenant-scoped and permission-gated. No cross-tenant read surface is added.
