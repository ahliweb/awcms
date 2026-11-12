🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](database-capacity-runbook.id.md)

# Database Capacity Runbook — Deployment-Aware Pool/Work-Class Budgets

> **Document status (AWCMS).** The mechanism below is inherited from the
> `awcms-mini` technical base (Issue #743 in the original repo, epic
> `platform-evolution`) and applies generically regardless of which ERP
> module is active.
> **`src/lib/database/capacity-config.ts` (the library) is active at
> runtime**: `GET /api/v1/database/pool/health`'s `capacity` field uses it and
> `recordGauge` records the `db_pool_capacity_*` metrics.
> **`bun run database:capacity:check` (the standalone CLI) exists** since
> Issue #1286 (`scripts/database-capacity-check.ts`): offline by default, with
> an optional `--live` read of the server's `max_connections`. There is still
> **no `production:preflight` script** in `package.json` (see
> [`production-preflight-runbook.md`](production-preflight-runbook.md)), so the
> check is a **manual step** before any scale-out or restart plan and is not
> wired into a preflight stage. What also **does not exist yet** is a measured
> baseline from real load (ADR-0161); the example numbers in this document
> stay illustrative until there is one.

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
that fails on unsafe or internally inconsistent combinations. This library
is real and runs read-only every time `GET
/api/v1/database/pool/health` is called (its `capacity` field).
`bun run database:capacity:check` runs the same validator on demand, from
configuration alone, so the arithmetic happens before a scale-out instead of
during one.

## Process class inventory

| Class    | What it is                                                  | Role           | Connection string     |
| -------- | ----------------------------------------------------------- | -------------- | --------------------- |
| `app`    | Every web/SSR instance (`bun run start`/`preview`/`dev`)    | `awcms_app`    | `DATABASE_URL`        |
| `worker` | Unattended background scripts (`getWorkerDatabaseClient()`) | `awcms_worker` | `WORKER_DATABASE_URL` |
| `setup`  | `POST /api/v1/setup/initialize` only (one-time wizard)      | `awcms_setup`  | `SETUP_DATABASE_URL`  |

**`DATABASE_CAPACITY_WORKER_INSTANCES_MAX`'s default (1) is narrower than
it looks.** It only accounts for one instance of the SAME job NAME running
at a time — the case `job-runner.ts`'s Postgres advisory lock already
mitigates (see §Jobs and the concurrency gate below). It does NOT budget for two
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
2. **Server-side**: `DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE x pools +
DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS` must fit within
   `DATABASE_CAPACITY_APPROVED_CONNECTIONS` — PgBouncer's OWN backend
   connections to PostgreSQL, independent of how many app-side clients are
   multiplexed onto them. `default_pool_size` is **per (database, user)
   pair**, and this application can use three roles (`awcms_app`,
   `awcms_worker`, `awcms_setup`), so "pools" is the number of distinct
   pairs. It is derived from the user and database names in `DATABASE_URL`,
   `WORKER_DATABASE_URL` and `SETUP_DATABASE_URL` (classes that can run) and
   can be forced with `DATABASE_CAPACITY_PGBOUNCER_POOL_COUNT`. `reserve_pool_size`,
   when you set it in `pgbouncer.ini`, adds to the ceiling per pool and is not
   modelled; leave headroom for it in the approved budget. With more than one
   PgBouncer process in front of one PostgreSQL, multiply by their count.

Keep `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN`/
`DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE` in sync with the operator's
real `pgbouncer.ini` (see
[`../../deploy/pgbouncer/pgbouncer.ini.example`](../../deploy/pgbouncer/pgbouncer.ini.example))
— the check is only meaningful if these mirror the actual deployed config;
nothing reads `pgbouncer.ini` itself (it's a separate process this
application does not introspect).

## Configuration reference

Full env var table: configuration reference doc (following the doc 18
pattern of the `awcms-mini` base) §Deployment-aware capacity. Every
variable is OPTIONAL
with a conservative default that reproduces a single-instance offline/LAN
topology — the underlying `capacity-config.ts` validator passes with zero
of them set (`bun run database:capacity:check` passes on a clean checkout).

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
**this configuration would FAIL** `bun run database:capacity:check` as-is. Fix by also
setting `DATABASE_POOL_MAX_WORKER=5`/`DATABASE_POOL_MAX_SETUP=5` (worker/
setup rarely need as many connections as the request-serving `app` class):
`90 + 1x5 + 1x5 + 5 = 105` — still over. Lower `DATABASE_POOL_MAX` to 12:
`6x12 + 5 + 5 + 5 = 87 <= 100` — passes. This iterative "run the check,
read the finding, adjust one number" loop is the intended workflow; the
check exists specifically so this arithmetic happens before a scale-out, not
during one.

## Worked example — the same fleet with and without PgBouncer

10 `app` instances, 1 `worker`, `DATABASE_POOL_MAX=20`, a dedicated worker
role (`WORKER_DATABASE_URL`), and a PostgreSQL with `max_connections=100`:

| Profile                                                  | Arithmetic                                                                          | Result                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| Direct                                                   | `10 x 20 + 1 x 20 + 1 x 20 (setup) = 240`, available `100 - 5 = 95`                 | **FAIL** (240 > 95)           |
| PgBouncer, `max_client_conn=400`, `default_pool_size=20` | clients `240 <= 400`; backend `20 x 2 pools + 5 reserved = 45 <= 100`               | **OK**                        |
| PgBouncer, `max_client_conn=200`                         | clients `240 > 200`                                                                 | **FAIL** (clients outgrow it) |
| PgBouncer, `default_pool_size=50`                        | backend `50 x 2 + 5 = 105 > 100` (a per-pool reading, `50 + 5`, would wrongly pass) | **FAIL**                      |

All four rows are unit-tested (`tests/database-capacity-check.test.ts`).

## Running the check

```bash
# offline, from the same env the application reads
DATABASE_CAPACITY_APP_INSTANCES_MAX=10 DATABASE_CAPACITY_APP_INSTANCES_EXPECTED=10 \
  bun run database:capacity:check

# also cap the budget at what the live server accepts (read-only: two settings
# and one session count). Point it at PostgreSQL directly.
DATABASE_CAPACITY_LIVE_URL=<direct-postgres-url> bun run database:capacity:check --live

bun run database:capacity:check --json   # machine-readable
```

It prints the per-class arithmetic for the `expected` and `max` scenarios, the
budget it was compared with, and one line per finding. Exit codes: `0` pass
(a `[WARNING]` never blocks), `1` the budget fails or is inconsistent, `2` a
usage error or an unreadable `--live` server (never a silent pass). It changes
no configuration and prints no connection string. Run it with the production
values of `DATABASE_POOL_MAX*`, `DATABASE_PGBOUNCER` and
`DATABASE_CAPACITY_*` before any scale-out or restart plan, and again whenever
you change an instance count or a pool size. There is no
`production:preflight` script yet, so nothing runs it for you.

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
   - If saturation persists beyond a few queue-timeout windows, re-check
     capacity against the CURRENT real instance count (not just the
     configured `expected`/`max`) — run `bun run database:capacity:check`
     with the current instance counts. An unplanned extra
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

## Jobs and the concurrency gate — corrected 22 August 2026

This section used to be headed "Known limitation" and said background jobs are
**not** runtime-gated through `work-class.ts`, that "a job's actual DB calls do
not currently call `acquireWorkClassSlot`", and that retrofitting them was a
reasonable follow-up. **That was true when written and false by the time anyone
read it.** Jobs open their tenant transactions through `withTenantOrThrow`,
which acquires a work-class slot exactly as a request does — so they have been
going through the gate for some time, and the only question was which bucket.

Finding D11 of the 17 August 2026 round is what that ambiguity cost: **seven
scripts passed no `workClass` at all**, so their transactions took
`withTenant`'s documented `"interactive"` default and nightly purges queued in
the bucket sized for live users. The drift also ran the other way —
`site-search-reconcile.ts` passed `maintenance` where the registry says
`background_sync`.

**Where it stands now.** Every job script that opens its own transaction passes
the class `src/lib/database/work-class-registry.ts` declares for it, and
`bun run db:work-class:generate` REFUSES to run when one does not — in both
directions, a missing option and a contradicting one. The refusal reads one
file, the script: a job whose transactions live in a module under `src/` has no
call of its own to inspect and is not covered by it.

Job-level concurrency is still bounded by a second, independent mechanism:
`src/lib/jobs/job-runner.ts`'s Postgres advisory lock ensures at most ONE
instance of a given job NAME runs cluster-wide at a time, which is the dominant
connection-storm risk for scheduled jobs (an overlapping re-run of the SAME job,
e.g. a slow purge still running when the next cron tick fires). The work class
governs which bounded queue a job's transactions wait in; the advisory lock
governs how many of the job there are. Neither replaces the other.

## CI drift gate — work-class registry (BUILT, Issue #263)

`docs/awcms/work-class-registry.generated.json` is generated by
`bun run db:work-class:generate` and verified by `bun run db:work-class:check`,
which is part of `bun run check` and of `ci.yml`'s `quality` job. The check
regenerates in memory and diffs against the committed file, so a new route, a
reclassified route, a new worker script, or a changed job rationale cannot merge
without a reviewable diff to that file.

**Two halves, two sources of truth.** Routes are GENERATED, because every route
already declares its class inline — via `defineTenantRoute({ workClass })`
(Issue #255, where omitting it is a compile error), via an explicit literal on
`withTenant(...)`/`withTenantOrThrow(...)`, or by relying on the documented
`"interactive"` default. Jobs are DECLARED in
`src/lib/database/work-class-registry.ts`, because a worker script's class is a
property of the SCRIPT, not of any one transaction inside it, so there is
nothing to generate from; the
generator discovers them by ground truth (`getWorkerDatabaseClient(` /
`getSetupDatabaseClient(` in `scripts/*.ts`) and **refuses to run** — not merely
to check — when the declared map and the scripts on disk disagree.

That refusal fired on the very first run and was right to: four worker scripts
from the awcms-micro absorption wave (`comments-retention`, `edge-cache-purge`,
`site-search-reconcile`, `tenant-domain-dns-sync`) were outside the capacity
model entirely, and four entries described scripts that do not exist in this
repo (`social-publish-dispatch`, `organization-structure-metrics-snapshot`,
`integration-hub-outbound-dispatch`, `data-exchange-worker`), carried over from
awcms-mini with their ADR-accepted-but-unimplemented modules.

**What the snapshot says today: 216 routes, 18 jobs.** Of the routes, **176 still
rely on `withTenant`'s `"interactive"` default** — they share login's pool budget
by omission rather than by decision. 28 pass an explicit literal and 4 go through
`defineTenantRoute`. Shrinking that 176 is the migration tracked in Issue #255;
this file is how you watch it happen.

> **Before Issue #263 this section described a target, and the file described
> awcms-mini.** It listed ~284 of that repo's routes while its own `_disclaimer`
> claimed "96 real routes" for a repo that had 221 — the data was stale and so
> was the warning meant to stop you trusting the data. Any capacity figure taken
> from that file before this date should be re-derived.

</content>
