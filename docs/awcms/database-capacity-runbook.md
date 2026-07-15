# Database Capacity Runbook — Deployment-Aware Pool/Work-Class Budgets

> **Status dokumen (AWCMS).** Mekanisme di bawah (`capacity-config.ts`,
> `database:capacity:check`, formula kapasitas) diwarisi dari base teknis
> `awcms-mini` (Issue #743 di repo asal, epic `platform-evolution`) dan
> berlaku generik terlepas dari modul ERP mana yang aktif. Ini sudah
> merupakan mekanisme fondasi yang tersedia di AWCMS sejak awal; yang
> **belum ada** adalah beban nyata dari modul ERP (finance/inventory/
> payroll dsb.) untuk memvalidasi angka kapasitas terhadap trafik
> produksi — angka contoh di dokumen ini tetap ilustratif sampai ada
> deployment nyata untuk diukur.

Companion to [`database-pooling.md`](database-pooling.md) (per-process
pool config, work-class concurrency gate, circuit breaker) and
[`production-preflight-runbook.md`](production-preflight-runbook.md) (the
operational procedure around `bun run production:preflight`, which
includes this runbook's `database:capacity` stage).

## Why this exists

`database-pooling.md`'s three layers (`Bun.SQL` pool, work-class gate,
circuit breaker) size and protect ONE process's own connection usage. None
of them know how many OTHER instances of the same process are running
elsewhere. A pool size that is perfectly safe alone can still cause a
connection storm once multiplied across a horizontally-scaled fleet:

```text
10 application instances x pool_max 20 = 200 application connections
approved PgBouncer/PostgreSQL capacity = 80
result = connection storm during scale-out or restart
```

`src/lib/database/capacity-config.ts` closes this gap: a typed,
env-configurable model of every database-using process class's expected/
min/max instance count and pool budget, a pure calculator, and a validator
that fails on unsafe or internally inconsistent combinations — enforced by
a READ-ONLY `database:capacity` stage in `bun run production:preflight`
and the standalone `bun run database:capacity:check`.

## Process class inventory

| Class    | What it is                                                  | Role           | Connection string     |
| -------- | ----------------------------------------------------------- | -------------- | --------------------- |
| `app`    | Every web/SSR instance (`bun run start`/`preview`/`dev`)    | `awcms_app`    | `DATABASE_URL`        |
| `worker` | Unattended background scripts (`getWorkerDatabaseClient()`) | `awcms_worker` | `WORKER_DATABASE_URL` |
| `setup`  | `POST /api/v1/setup/initialize` only (one-time wizard)      | `awcms_setup`  | `SETUP_DATABASE_URL`  |

**`DATABASE_CAPACITY_WORKER_INSTANCES_MAX`'s default (1) is narrower than
it looks.** It only accounts for one instance of the SAME job NAME running
at a time — the case `job-runner.ts`'s Postgres advisory lock already
mitigates (see §Known limitation below). It does NOT budget for two
DIFFERENT worker scripts scheduled to run concurrently on the same host
(e.g. a payroll batch job and an audit-log purge both firing in the same
cron minute) — each is a separate process opening its own `worker`-role
pool at the same time, so real overlap of N distinct scripts needs
`DATABASE_CAPACITY_WORKER_INSTANCES_MAX >= N`, not `1`, even though the
advisory lock guarantees no SINGLE job name ever overlaps itself.
Multi-job-concurrent cron layouts should size this explicitly.

Exempted, with rationale (not part of the instance x pool_max sum, see
`capacity-config.ts`'s header comment for the full reasoning):

- **Migration/backup/restore CLI tools** (`bun run db:migrate`,
  `deploy/backup/*.sh`) — ad hoc, privileged, operator-serialized
  connections. They draw from `DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS`
  instead.
- **Test/CI processes** — an isolated test/CI database with its own
  independent `max_connections`, never sharing budget with a real
  deployment.

## The formula

```text
sum(instance_count[class] x pool_max[class]) + reserved_headroom
  <= approved PgBouncer/PostgreSQL capacity
```

evaluated at each class's configured **max** instance count (the
horizontal ceiling an operator has approved, not just today's steady
state) — "before horizontal deployment" means "if you scale up to your
configured max, does it still fit."

### Direct PostgreSQL (default, `DATABASE_PGBOUNCER=false`)

Every `app`/`worker`/`setup` pool connection is a real PostgreSQL backend
connection — the formula is checked directly against
`DATABASE_CAPACITY_APPROVED_CONNECTIONS`.

### PgBouncer transaction pooling (`DATABASE_PGBOUNCER=true`)

Two separate checks, because PgBouncer multiplexes many client-side
connections onto far fewer server-side ones:

1. **App-side**: `sum(instance_count x pool_max)` must fit within
   `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN` (`pgbouncer.ini`'s
   `max_client_conn`).
2. **Server-side**: `DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE +
DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS` must fit within
   `DATABASE_CAPACITY_APPROVED_CONNECTIONS` — PgBouncer's OWN backend
   connections to PostgreSQL, independent of how many app-side clients are
   multiplexed onto them.

Keep `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN`/
`DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE` in sync with the operator's
real `pgbouncer.ini` (see
[`../../deploy/pgbouncer/pgbouncer.ini.example`](../../deploy/pgbouncer/pgbouncer.ini.example))
— the check is only meaningful if these mirror the actual deployed config;
nothing reads `pgbouncer.ini` itself (it's a separate process this
application does not introspect).

## Configuration reference

Full env var table: configuration reference doc (mengikuti pola doc 18
base `awcms-mini`) §Kapasitas deployment-aware. Every variable is OPTIONAL
with a conservative default that reproduces a single-instance offline/LAN
topology — `bun run database:capacity:check` passes with zero of them set.

## Worked example — sizing for a 4-instance scale-out

Deployment: 4 `app` instances behind a load balancer, 1 dedicated worker
host (e.g. running payroll batch/reporting jobs), no PgBouncer, a managed
PostgreSQL with an approved budget of 100 connections.

```bash
DATABASE_CAPACITY_APP_INSTANCES_EXPECTED=4
DATABASE_CAPACITY_APP_INSTANCES_MAX=6        # headroom for a rolling restart
DATABASE_POOL_MAX=15                          # lower per-instance max to fit the budget
DATABASE_CAPACITY_WORKER_INSTANCES_MAX=1
DATABASE_CAPACITY_APPROVED_CONNECTIONS=100
DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS=5
```

Worst case: `app` 6 x 15 = 90, `worker` 1 x 15 = 15 (worker falls back to
`DATABASE_POOL_MAX` unless `DATABASE_POOL_MAX_WORKER` is set separately),
`setup` 1 x 15 = 15 (same fallback) = 120, plus 5 reserved = 125 > 100 —
**this configuration FAILS** `database:capacity:check` as-is. Fix by also
setting `DATABASE_POOL_MAX_WORKER=5`/`DATABASE_POOL_MAX_SETUP=5` (worker/
setup rarely need as many connections as the request-serving `app` class):
`90 + 1x5 + 1x5 + 5 = 105` — still over. Lower `DATABASE_POOL_MAX` to 12:
`6x12 + 5 + 5 + 5 = 87 <= 100` — passes. This iterative "run the check,
read the finding, adjust one number" loop IS the intended workflow; the
check exists specifically so this arithmetic happens before a scale-out,
not during one.

## Running the check

```bash
bun run database:capacity:check
```

Or as part of the full read-only preflight sequence (recommended before any
scale-out or restart plan, same rehearsal-first discipline as
[`production-preflight-runbook.md`](production-preflight-runbook.md)):

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight
```

Both are 100% read-only — pure config arithmetic, no database connection,
no network call, and neither can change pool/database configuration. A
`[FAIL]` finding blocks preflight's overall `GO-LIVE DIIZINKAN` verdict
exactly like any other stage; a `[WARNING]` finding (currently only the
work-class-vs-pool oversubscription check, see `database-pooling.md`'s
corrected header comment) is printed but never blocks.

## Graceful saturation behavior

The work-class FIFO queue is also bounded
(`DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`, default 4x a class's own
concurrency max — see `work-class.ts`). Once a class's queue is at that
cap, a NEW caller is rejected immediately (`WorkClassQueueFullError`, HTTP
`503 DATABASE_BUSY` + `Retry-After: 2`) instead of joining an
ever-growing queue and eventually timing out — "controlled 503 instead of
cascading timeouts." A caller that DOES queue and later times out also now
gets `Retry-After: 2`; a request rejected because the circuit breaker is
open gets `Retry-After: 30` (roughly the breaker's own `openDurationMs`).
Neither number is computed from live state (see `tenant-context.ts`'s doc
comment for why) — both are fixed, conservative constants.

## Operational signals

`GET /api/v1/database/pool/health` includes a `capacity` field (this
process's configured pool max per class, the approved budget, and reserved
headroom) alongside the pre-existing work-class saturation snapshot (each
entry also reports `maxQueueDepth`). Metrics
(`src/lib/observability/metrics-port.ts`), all low-cardinality/code-defined
labels only, no tenant ids, no DSNs:

| Metric                                         | Type      | Labels                    | Meaning                                               |
| ---------------------------------------------- | --------- | ------------------------- | ----------------------------------------------------- |
| `db_pool_work_class_rejected_total`            | counter   | `workClass`               | Immediate rejections (queue was already full)         |
| `db_pool_work_class_wait_ms`                   | histogram | `workClass`, `outcome`    | How long a queued caller waited (saturation duration) |
| `db_pool_capacity_configured_connections`      | gauge     | `processClass`            | This process's configured pool max                    |
| `db_pool_capacity_estimated_total_connections` | gauge     | `scenario` (expected/max) | Fleet-wide estimate from this process's own config    |
| `db_pool_capacity_approved_budget`             | gauge     | (none)                    | The configured approved connection budget             |

## Incident response — saturation / connection storm

1. **Symptom**: a burst of `503 DATABASE_BUSY` responses, or
   `GET /api/v1/database/pool/health` reporting `status: "degraded"`/
   `"unhealthy"`.
2. **Check circuit-breaker state first** (`circuitBreakerState` in the pool
   health response). `open` means the database itself is failing (real
   outage/connectivity problem) — this is NOT a capacity-sizing problem;
   follow normal database-outage diagnosis (connectivity, DB server health,
   `db:connectivity` preflight stage), not the steps below. The circuit
   breaker's own fail-fast behavior (doc `database-pooling.md` §3) is
   already doing its job: preventing unbounded retries against a failing
   dependency.
3. **If the breaker is `closed`/`half_open` but a work class shows
   `active >= max` with `queued > 0`** (or `db_pool_work_class_rejected_total`
   is climbing): this IS a capacity/backpressure event, not an outage.
   - Confirm whether this was an EXPECTED scale-out/restart (a new
     `app` instance came up, or several restarted at once) — if so, this
     is exactly the bounded-queue/controlled-503 behavior working as
     designed; it should self-resolve within `queueTimeoutMs` (2s default)
     once the burst passes. Clients that honor `Retry-After` recover
     automatically.
   - If saturation persists beyond a few queue-timeout windows, re-run
     `bun run database:capacity:check` against the CURRENT real instance
     count (not just the configured `expected`/`max`) — an unplanned extra
     instance (a stuck old deployment not yet drained, a runaway worker
     re-run — e.g. a duplicate payroll batch) pushes actual usage above
     what was budgeted.
   - Do NOT respond by manually raising `DATABASE_POOL_MAX` on a live
     production instance without re-running the capacity check first — a
     larger per-instance pool without a corresponding increase in the
     approved budget is exactly the connection-storm risk this closes.
4. **Record the incident** the same way as any other production event —
   timestamp, which class saturated, instance count at the time, resolution
   (self-recovered vs. manual pool/instance-count change).

## Known limitation

Background jobs (the `worker` process class) are NOT runtime-gated through
`work-class.ts`'s concurrency gate — they are classified in
`src/lib/database/work-class-registry.ts` for the capacity CONNECTION
BUDGET (counted in the formula above) and for the CI drift gate
(`bun run db:work-class:check`), but a job's actual DB calls do not
currently call `acquireWorkClassSlot`. Job-level concurrency is instead
bounded by a different, already-existing mechanism —
`src/lib/jobs/job-runner.ts`'s Postgres advisory lock ensures at most ONE
instance of a given job NAME runs cluster-wide at a time, which is the
dominant connection-storm risk for scheduled jobs (an overlapping re-run of
the SAME job, e.g. a payroll run or purge job). Retrofitting all worker
scripts onto the work-class gate itself is a reasonable follow-up.

## CI drift gate — work-class registry

`docs/awcms/work-class-registry.generated.json` (generated,
`bun run db:work-class:generate`) snapshots which work class every API
route (`src/pages/api/v1/**` that calls `withTenant(...)`) and every
worker/setup job (`scripts/*.ts` that calls
`getWorkerDatabaseClient()`/`getSetupDatabaseClient()`) is classified as.
`bun run db:work-class:check` (part of `bun run check`) regenerates in
memory and diffs against the committed file — a new or reclassified route/
job changes the snapshot, so it cannot merge without a reviewable diff to
this file. A new worker script with no entry in
`work-class-registry.ts`'s `JOB_WORK_CLASS_REGISTRY` makes the GENERATOR
itself refuse to run (not just the check) — see that file's header comment.

This registry is currently empty of ERP-domain entries in AWCMS — it will
grow as finance/inventory/procurement/manufacturing/HR-payroll endpoints
and jobs are implemented.
</content>
