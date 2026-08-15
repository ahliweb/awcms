🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](performance-suite.id.md)

# Performance Suite — Representative Load, Soak, and Query-Plan Regression Budgets

> **Document status:** a target standard, not an implementation status. The `awcms` repo does not yet have `src/lib/performance/`, `scripts/performance-suite.ts`, or any ERP module to measure — this document adapts the performance suite architecture already proven in the `awcms-mini` base into a mandatory design that must be implemented as soon as the ERP domain modules (finance, inventory, procurement, manufacturing, HR/payroll) start being built. The mechanism (deterministic fixtures, load/soak/saturation-and-recovery scenarios, versioned query-plan regression budgets, safety interlock) is kept as a mandatory standard; the example workloads/tables are adjusted to the ERP domain.

It depends on the deployment-based connection capacity model (`database-capacity-runbook.md`, forthcoming) and is planned to reuse the same safety interlock and scenario-runner shape as the DR/chaos drill (`resilience-dr-verification.md`, forthcoming) instead of reinventing either. A companion to the "measure before optimising" audit/tuning discipline.

## Why this is needed

Without this suite, "performance" in any ERP repo tends to mean ad hoc `EXPLAIN ANALYZE` during a tuning session, plus at best one micro-benchmark proving that recording metrics itself adds no material overhead. Nothing proves anything about representative multi-tenant scale, long-run memory stability, RLS query plans at real volume, or how interactive workloads (e.g. cashier/PO transaction entry) and reporting workloads (financial reports, stock reconciliation) fight over the same connection pool under load. This suite closes that gap: deterministic synthetic fixtures, load/soak/mixed-workload/saturation-and-recovery scenarios, and versioned query-plan regression budgets — all runnable locally, in CI (the safe subset), or on a schedule (the full lane).

## Architecture (planned)

```text
src/lib/performance/
  prng.ts                    deterministic seeded PRNG (mulberry32) — the root of
                              every reproducibility guarantee below
  scale-profiles.ts          safe/standard/large scale profiles: tenant count,
                              row count per table, noisy-neighbor multiplier,
                              the documented soak duration
  fixture-generator.ts       pure row generator (no I/O) — the same seed + profile
                              always produces the same fixture plan
  fixture-seeder.ts          I/O: bulk-inserts the generated rows through
                              withTenant (RLS-enforced, never a privileged
                              bypass) using the unnest(...) + sql.array(...) pattern
  metrics-aggregate.ts       pure: p50/p95/p99 latency, throughput, error rate
                              from raw call samples
  process-metrics.ts         thin I/O: process CPU/memory sampling, plus a
                              read-only passthrough to the REAL work-class gate
                              snapshot (getWorkClassSaturation) and
                              pg_stat_activity/pg_locks for connection/lock signals
  redaction.ts               pure: DSN credential redaction, deterministic
                              per-run UUID pseudonymization
  query-plan-budgets.ts      pure: versioned regression budget registry +
                              EXPLAIN (FORMAT JSON) evaluator
  query-plan-runner.ts       I/O: runs EXPLAIN under RLS, always
                              rolled back
  workload.ts                I/O: one real withTenant-gated operation per work
                              class (interactive/critical_transaction/reporting/
                              background_sync/maintenance)
  scenario-context.ts        shared mutable state (sql client, fixture plan,
                              scale profile) — set once by the orchestrator
  scenarios/*.ts              ScenarioDefinition implementations, REUSING
                              the same resilience scenario-runner types
                              (runScenario, computeDrOverall) — not a
                              parallel/duplicate runner
  report.ts                  machine-readable + human report builder, with
                              redaction applied before anything is written to disk

scripts/
  performance-suite.ts            bun run performance:suite
  performance-query-plan-check.ts bun run performance:query-plan:check
```

## Safety interlock — reused, not reinvented

Both scripts are planned to import `authorizeDrDrill` from `src/lib/resilience/target-guard.ts` UNMODIFIED — the same non-overridable production target guard used by `scripts/dr-drill.ts`:

- `APP_ENV=production` is rejected unconditionally, with no override flag.
- The `DATABASE_URL` host must be a known local/isolated allowlist entry (default-deny for anything unknown).
- `--confirm-non-production=<APP_ENV value>` is a mandatory typo-catcher.

See `resilience-dr-verification.md` (forthcoming) for the full safety-interlock flowchart — it applies identically here.

## Synthetic data — deterministic, configurable, documented distribution

`scale-profiles.ts` defines three versioned profiles:

| Profile    | Tenants | Noisy-neighbor multiplier | Soak duration | Used by                                   |
| ---------- | ------: | ------------------------: | ------------: | ----------------------------------------- |
| `safe`     |       5 |                        6x |   0 (skipped) | CI `quality` job, default of both scripts |
| `standard` |      20 |                       10x |           60s | manual investigation                      |
| `large`    |      50 |                       15x |          600s | scheduled/manual `--full` lane            |

Every profile provides a representative set of seeded tables per tenant — planned to cover: audit events, the ABAC decision log, sync outbox/deliveries, the external object sync queue, idempotency keys, and a representative tenant-scoped business table per ERP domain (e.g. `awcms_finance_journal_entries` for finance, `awcms_inventory_stock_movements` for inventory — the driving tables of the full-text/reporting query-plan budgets). The LAST tenant in every profile is the designated noisy-neighbor tenant, its row counts multiplied — never an accidental scale, always the same deterministic position for a given seed.

All randomness flows through the seeded `mulberry32` generator in `prng.ts` — `Math.random()`/`crypto.randomUUID()` never appear in any generator, so `buildFixturePlan(profile, seed)` is byte-identical across runs/machines for the same inputs. Every string field is drawn from a small fixed vocabulary — purely synthetic data, never resembling real customer identities, credentials, NPWP/NIK, real transaction amounts, or any other PII.

Row TIMESTAMPS are just as seed-deterministic as the row counts/ids: every row generator computes `createdAt` relative to an anchor function that is pure in the seed alone, never `Date.now()`/`new Date()` — ensuring the same `(scaleProfile, seed)` produces the same absolute row timestamps regardless of the real-world day the suite is run, preserving release-to-release comparability.

Fixture seeding writes through `withTenant` (`fixture-seeder.ts`), the SAME chokepoint every production mutation goes through — RLS is genuinely enforced during seeding, not bypassed by a privileged connection, so a freshly seeded database is real evidence that "the cross-tenant negative RLS tests are still active in a large-data environment", not an assumption.

## Workload scenarios — real work-class-gated operations, not simulations

`workload.ts` maps the workload models onto this repo's five work classes (`src/lib/database/work-class.ts`), each through a real `withTenant`:

| Work class             | Workload model                     | Real operation (ERP example)                                                                                     |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `interactive`          | interactive API read/write         | RLS-scoped keyset-style audit-event/transaction list reads (the same shape as `GET /api/v1/finance/journals`)    |
| `critical_transaction` | critical idempotent transaction    | A real idempotency store — e.g. a journal posting/payroll run that must not be duplicated                        |
| `reporting`            | reporting/analytics reads          | RLS-scoped financial/stock report aggregates (e.g. trial balance, stock summary per warehouse)                   |
| `background_sync`      | sync/event/job workload            | An outbox claim probe with `FOR UPDATE SKIP LOCKED` (the same shape as the external integration sync dispatcher) |
| `maintenance`          | controlled degradation / retention | A real retention purge (audit/log), with the retention window set to match zero rows against the fixture data    |

The scenarios (`src/lib/performance/scenarios/*.ts`), each a `ScenarioDefinition` reusing the resilience scenario-runner's `runScenario`/`computeDrOverall`:

| Scenario                         | Tier | What it proves                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactive-load`               | safe | p50/p95/p99/throughput/error-rate under concurrent interactive reads                                                                                                                                                                                                                                            |
| `critical-transaction-integrity` | safe | N concurrent racers for the SAME idempotency KEY (e.g. a duplicate journal posting) -> exactly 1 persisted row (atomicity under load)                                                                                                                                                                           |
| `reporting-under-load`           | safe | Concurrent reporting reads never break the correctness of concurrent critical transactions                                                                                                                                                                                                                      |
| `background-sync-claim-load`     | safe | `FOR UPDATE SKIP LOCKED` claim throughput/error-rate under concurrency                                                                                                                                                                                                                                          |
| `saturation-and-recovery`        | safe | **The core proof**: deliberately over-subscribes the real "maintenance" work-class gate (capacity 5), asserts the exact number of immediate `503 DATABASE_BUSY` + `Retry-After: 2` rejections, confirms the gate drains back to empty (`active=0/queued=0`), and that follow-up calls succeed (recovery proven) |
| `soak-stability`                 | full | Repeated interactive calls for the scale profile's `soakDurationMs`; asserts RSS growth stays under a loose ceiling (no unbounded growth) — self-skips on the `safe` profile (`soakDurationMs = 0`)                                                                                                             |

`saturation-and-recovery` is the concrete answer to the criterion "saturation behaviour matches the capacity model and recovery is proven" — it does not simulate backpressure, it genuinely drives the real bounded FIFO queue up to its documented capacity and asserts the existing 503+`Retry-After` behaviour.

## Query-plan regression budgets

`query-plan-budgets.ts` is a versioned governance artifact — planned to cover the real production query shapes per category relevant to ERP (RLS-scoped pagination, full-text/document search, outbox claims, retention purge batches, financial/inventory reporting aggregates), each with:

- `forbiddenNodeTypes`/`requiredNodeTypesAny` — plan SHAPE assertions (e.g. "must not contain a Seq Scan", "must contain an Index/Bitmap scan").
- `maxTotalCost`/`maxExecutionTimeMs` — versioned numeric budgets.
- `approval: { approvedBy, approvedAt, reason }` — an explicit process for approving a deliberate threshold change. There is no env var or flag that loosens a budget — the ONLY way to change one is a reviewed source diff, the same governance pattern as the work-class registry.

`query-plan-runner.ts` runs `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)` for each budget's real SQL against a REAL RLS-enforced connection (`app.current_tenant_id` set via `SET LOCAL`, exactly like `withTenant`), inside a transaction that is ALWAYS rolled back — so even the two write-shaped queries (the outbox claim `UPDATE`, the retention purge's internal `SELECT`) never permanently mutate the seeded fixture data.

### Adversarial evidence (why this gate can be trusted)

A checker that has only ever been tested against already-good input proves nothing about its ability to catch a real regression. This suite must ship TWO independent adversarial proofs:

1. **A pure-function proof** — a hand-built `EXPLAIN` JSON containing a `Seq Scan`, asserting `evaluateQueryPlan` fails it.
2. **A real-Postgres proof** — a regression fixture query (deliberately NOT part of the real `QUERY_PLAN_BUDGETS` registry) run against the same tables with the planner's index/bitmap-scan strategies forcibly disabled (`SET LOCAL enable_indexscan = off`, etc.) for that one `EXPLAIN` — reproducing exactly what a missing/disabled/outvoted index incident looks like in real `EXPLAIN` output, asserting the gate really does report the `Seq Scan` result as a failure against the REAL PostgreSQL planner, not just a hand-built fixture.

   (A design note from the base: adding an unindexed `ILIKE` predicate on top of an indexed `tenant_id` filter is NOT enough — PostgreSQL still picks an efficient Index Scan on the `tenant_id` prefix, because RLS always injects the `tenant_id = current_setting(...)` filter and every RLS-scoped table has an index prefixed with `(tenant_id, ...)`. Forcing the planner GUCs is the honest way to reproduce "missing/disabled index", not a workaround for a flaky test.)

## Machine-readable + human report artifacts

Both scripts are planned to accept `--json-output=<path>` (machine-readable) and `performance-suite.ts` additionally accepts `--report-path=<path>` (a concise human Markdown). Every report goes through `redaction.ts`'s `redactReport` before being written — three sequential passes: redacting `DATABASE_URL` at the source, a defensive backstop over the ENTIRE report tree for DSN-shaped substrings anywhere, and a second defensive backstop for UUID-shaped substrings anywhere (replaced with stable per-run pseudonyms `id#1`, `id#2`, ..., never real tenant/user ids).

The JSON report's `environment` section documents the hardware/container/database configuration explicitly (platform, arch, CPU count, total memory, Bun version, scale profile, tenant count, total planned rows) plus an explicit disclaimer: **the numbers are only comparable release-to-release on the SAME environment, never a universal production capacity guarantee**.

Example (redacted):

```json
{
  "environment": {
    "generatedAt": "2026-07-14T00:00:00.000Z",
    "appEnv": "test",
    "databaseUrlRedacted": "postgres://<redacted>@localhost:5432/awcms",
    "scaleProfileId": "safe",
    "tenantCount": 5,
    "noisyNeighborMultiplier": 6,
    "totalSeededRowsPlanned": 37500,
    "hardware": {
      "platform": "linux",
      "arch": "x64",
      "cpuCount": 8,
      "totalMemoryMb": 16384,
      "bunVersion": "1.3.14"
    },
    "disclaimer": "Numbers reflect THIS container/hardware/database configuration..."
  },
  "tier": "safe",
  "overall": "pass",
  "scenarios": [
    /* ScenarioResult[] — name, tier, status, detail, durationMs, metrics */
  ],
  "queryPlanChecks": [],
  "seedSummary": {
    "tenantCount": 5,
    "rowCounts": { "...": "..." },
    "durationMs": 989
  }
}
```

## Safe subset vs. the full lane

- **Safe (CI, every PR — planned as part of the `quality` job):** `bun run performance:suite -- --confirm-non-production=test` (the default `safe` scale, 5 scenarios) and `bun run performance:query-plan:check -- --confirm-non-production=test`. Both run as the least-privilege role `awcms_app` so that RLS is genuinely enforced, not bypassed. Together they finish in a few seconds against the `safe` fixture scale.
- **Full (`--full`, scheduled/manual only — NEVER wired into `bun run check` or every-PR CI):**
  ```bash
  APP_ENV=test DATABASE_URL=<isolated-url> \
  bun run performance:suite -- --confirm-non-production=test --full \
    --json-output=/tmp/performance-report.json \
    --report-path=/tmp/performance-report.md
  ```
  It uses the `large` scale profile as the default (override with `--scale=`), adding the `soak-stability` scenario. Suggested cadence: alongside a release rehearsal or before a major infrastructure/capacity change.

## Comparing two releases/commits

Run the safe or the full lane with the SAME `--seed` on two different commits (or against a before/after infrastructure change), diff the `scenarios[].metrics` and `queryPlanChecks[]` sections of the two `--json-output` reports, and confirm the `environment` matches closely enough to be comparable (same scale profile, similar hardware). A metric or query-plan regression between two runs is a signal to investigate — not a hard CI gate on latency deltas (deliberately: absolute wall-clock numbers are only ever comparable on matching hardware).

## Running locally

```bash
# Safe subset (fast, a few seconds):
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:suite -- --confirm-non-production=test
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:query-plan:check -- --confirm-non-production=test

# Full lane (large scale + soak, minutes):
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:suite -- --confirm-non-production=test --full
```

`DATABASE_URL` must point at the least-privilege role `awcms_app` (or any connection where RLS is genuinely enforced) — a superuser connection still runs without error, but the RLS-enforcement evidence this suite exists for is only meaningful under a real least-privilege role, exactly like every other RLS-sensitive integration test in this repo.

## Known limitations

- Absolute latency numbers depend heavily on the container/hardware/database configuration where the measurement was taken (see the report's own `disclaimer` field) — they are never presented as a universal production guarantee.
- The `soak-stability` scenario only runs in the `full` lane (`soakDurationMs > 0`); the `safe` lane cannot prove long-run memory stability by design (it has to stay fast).
- Background job concurrency (as distinct from the connection budget) is not yet gated through `work-class.ts` for every real worker script — this suite's `background_sync`/`maintenance` workloads exercise the WORK-CLASS gate directly (the mechanism this suite proves), not the job-runner's own advisory-lock serialisation, which already has its own dedicated evidence (the `worker-interruption` resilience scenario).

## Related documents

- `database-capacity-runbook.md` (forthcoming) — the fleet-wide connection-budget model whose process-local half is exercised by this suite's `saturation-and-recovery` scenario.
- `resilience-dr-verification.md` (forthcoming) — the target-guard/scenario-runner pattern this suite reuses directly.
- `database-pooling.md` (forthcoming) — the work-class concurrency ceilings/queue-depth formula that this suite's scenarios drive to capacity.
- [`observability-metrics.md`](observability-metrics.md) — the metrics port architecture the `saturation-and-recovery` scenario reads directly, with no second accounting mechanism.
- The "measure -> find the bottleneck -> fix -> measure again" audit/tuning discipline that this suite completes.
