🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](booking-benchmarks.id.md)

# Booking and Attendance Benchmarks (Issue #967)

Reproducible load, stress and concurrency benchmarks for the `booking`
allocator, availability reads, the hold-expiry reaper under backlog, and
`hr_workforce` attendance event ingest. One command: `bun run bench:booking`
([`scripts/bench-booking.ts`](../../scripts/bench-booking.ts), implementation in [`tests/bench/booking-bench.ts`](../../tests/bench/booking-bench.ts)).

## Not part of the test suites

A benchmark asserts on wall-clock time, and a timing assertion in `bun test` is
a flaky test. So the script is **not** a `*.test.ts`: neither `bun test` nor
`bun test tests/integration/` discovers it, and it is **not** in the
`bun run check` chain. Like `build:asset-budget:check` it is a documented-budget
script run on demand or in a dedicated lane (see
[`performance-suite.md`](performance-suite.md) for the wider target design).

It checks two things, and keeps them apart:

- **Invariants** (always enforced, exit 1). Exactly one winner for the last
  slot or night; exactly `capacity` winners for a pool; live allocations equal
  the winners (no double allocation, no partial claim left behind); every
  loser is `SLOT_UNAVAILABLE`; no contender throws; the reaper expires and
  releases every elapsed hold and a claim racing it is never refused; every
  attendance event is stored exactly once and a replay returns the original.
  These are correctness under load, not timing, so they do not flake.
- **Thresholds** (enforced by default on the `standard` profile; pass
  `--no-thresholds` to only report). Each is a wide
  margin over the recorded baseline below, so machine variance does not trip
  it but an order-of-magnitude regression (a lost index, an N+1, a lock held
  across a round trip) does. The `smoke` profile checks invariants only: a
  handful of samples has no meaningful p95.

## Running it

```bash
# needs the same superuser DATABASE_URL as the integration suite
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres bun run bench:booking
bun run bench:booking --profile smoke        # seconds; invariants only
bun run bench:booking --json bench.json      # machine-readable report
bun run bench:booking --no-thresholds        # report, do not gate
```

It reuses the integration harness: a throwaway `awcms_it_<pid>` database, the
real migrations, claims through the production runtime role `awcms_app` (FORCE
RLS in effect) and the reaper through `awcms_worker`. Each contender has its
own pooled connection and its own transaction (the `withTenant` shape without
the in-process work-class gate, so the database sees every contender at once).
It never touches the database that `DATABASE_URL` names beyond creating and
dropping its own.

Because `awcms_app` and `awcms_worker` are cluster-scoped, another process's
integration teardown can switch their login off in the middle of a minutes-long
run; the script re-asserts both logins at the start of each section
(`reassertRuntimeRoleLogins` in the harness). Do not run it on a cluster whose
roles you do not own.

## What each scenario does

| #   | Scenario                | Shape                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Concurrent claims       | 30 rounds per case on a fresh resource, N simultaneous `placeHold` calls released together: **last slot** (capacity 1, slot), **last night** (capacity 1, stay), **pool of 3** (capacity 3, quantity 1). N is 8 and 32.                                                                                 |
| 2   | Availability read       | 500 resources x 2 units, each with a schedule, and 2,000 live holds spread over them; a 7-day slot window for one resource. 400 sequential questions, then 400 with 16 readers in flight.                                                                                                               |
| 3   | Reaper under backlog    | 5,000 elapsed holds over 100 resources in one tenant, drained by `runBookingHoldExpiry` as `awcms_worker` until a run finds nothing, while 8 claimers keep placing holds on other resources. Reports drain throughput and the claimers' latency (a reaper lock must never refuse or stall a free slot). |
| 4   | Attendance event ingest | 5,000 `recordEvent` calls (200 employments, 16 writers, about 10% supervisor-recorded, the audited path), then 1,000 replays of an existing `clientEventKey`.                                                                                                                                           |

The bench tenant's default abuse caps (500 live holds per tenant, 5 per
customer) are raised for that tenant only: a backlog benchmark would otherwise
measure the 429.

## Recorded numbers

Two consecutive `standard` runs on the machine below, with the cluster shared
with other processes (so these are not a quiet-machine best case). All times
are milliseconds unless stated; "claim" is one `placeHold` including time spent
waiting on the winner's lock.

**Hardware and software:** 4 logical CPUs (Intel Xeon Processor @ 2.80 GHz),
16 GB RAM, PostgreSQL 16.14 (Ubuntu 24.04, x86_64, default configuration,
loopback TCP), Bun 1.3.14, runtime pool of 34 connections. Date: 16 October 2026.

### 1. Concurrent claims (p50 / p95 / p99 of one claim)

| Case                   | Run 1           | Run 2           |
| ---------------------- | --------------- | --------------- |
| last slot, 8 workers   | 38 / 103 / 132  | 56 / 142 / 169  |
| last night, 8 workers  | 38 / 61 / 69    | 59 / 128 / 172  |
| pool of 3, 8 workers   | 49 / 72 / 77    | 82 / 151 / 260  |
| last slot, 32 workers  | 72 / 99 / 103   | 97 / 175 / 220  |
| last night, 32 workers | 70 / 110 / 126  | 118 / 187 / 201 |
| pool of 3, 32 workers  | 104 / 131 / 141 | 175 / 234 / 250 |

Every round: one winner (three for the pool), the rest `SLOT_UNAVAILABLE`, no
double allocation. A whole 32-way round settles in about 75-185 ms at the median.

### 2. Availability read (500 resources, 2,000 live holds, 7-day window)

| Mode                   | Run 1 p50 / p95 / p99 | Run 2 p50 / p95 / p99 |
| ---------------------- | --------------------- | --------------------- |
| sequential             | 6.5 / 16.6 / 24.5     | 4.8 / 13.6 / 18.4     |
| 16 readers in flight   | 55.9 / 106 / 119      | 35.4 / 62.6 / 78.6    |
| throughput, 16 readers | 256 questions/s       | 407 questions/s       |

### 3. Hold-expiry reaper (5,000 elapsed holds)

| Measure                             | Run 1     | Run 2     |
| ----------------------------------- | --------- | --------- |
| drain time (2 job runs)             | 8.6 s     | 9.4 s     |
| holds expired and released / second | 581       | 531       |
| claim p50 / p95 while draining      | 218 / 285 | 214 / 280 |

The job's per-tenant pass limit means a backlog takes more than one run, as the
scheduler would also see it; the last run finds nothing. Claims racing the drain
are slower than the undisturbed ones in scenario 1 (about 2x at the median) but
none was refused: `SKIP LOCKED` keeps the reaper from ever waiting on, or
blocking, a claim.

### 4. Attendance event ingest (5,000 events, 16 writers)

| Measure                  | Run 1        | Run 2        |
| ------------------------ | ------------ | ------------ |
| events recorded / second | 780          | 738          |
| record p50 / p95 / p99   | 18 / 37 / 60 | 20 / 40 / 70 |
| replay p50 / p95 / p99   | 7 / 15 / 19  | 7 / 18 / 26  |

## Thresholds (the regression gate)

Defined as `THRESHOLDS` in `tests/bench/booking-bench.ts` and applied to the `standard` profile:

| Budget                            | Limit           | Worst recorded |
| --------------------------------- | --------------- | -------------- |
| any race, claim p95               | <= 1,500 ms     | 234 ms         |
| availability, sequential p95      | <= 250 ms       | 16.6 ms        |
| availability, 16 readers p95      | <= 750 ms       | 106 ms         |
| reaper drain throughput           | >= 100 holds/s  | 531 holds/s    |
| claim p95 while the reaper drains | <= 1,500 ms     | 285 ms         |
| attendance ingest throughput      | >= 100 events/s | 738 events/s   |
| attendance record p95             | <= 500 ms       | 40 ms          |

The margin is roughly 5-10x because the numbers move 1.5-2x between two runs on
the same machine. Re-baseline (update this table and `THRESHOLDS` together) when
the hardware or the PostgreSQL major version changes; do not tighten a limit to
the measured value.

## Limits of this benchmark

- One database server on the same host as the load generator: network latency
  and a separate application tier are not modelled, and the numbers include the
  generator's own CPU.
- A single tenant per scenario; cross-tenant interference and the in-process
  work-class gate (`withTenant` admission) are not exercised.
- Availability is read against a settled backlog; reads concurrent with heavy
  claim traffic are not measured.
- No HTTP layer: handlers, authentication and ABAC are outside the timings.
- Not wired into CI: shared runners give unstable timing. The invariants it
  checks are also proved, without timing, by
  `tests/integration/booking-concurrency.integration.test.ts`.
