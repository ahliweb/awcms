🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](capacity-baseline-2026-11-22.id.md)

# Capacity baseline, 22 November 2026 (LOCAL; not NFR evidence)

> **This is a LOCAL baseline, not proof of any ADR-0161 NFR.** It was measured
> on a shared developer workstation, with the app, the database and the load
> generators on the same machine, no CDN, no edge cache, and PostgreSQL on tmpfs
> with `fsync=off`. It shows that the harness works and where the first limit of
> an uncached origin sits. A production-like baseline waits for the environment
> decision in #1281 and is a separate run (issue #1283 stays open).

Method and tooling: [`load-testing.md`](load-testing.md). Targets:
[ADR-0161](../adr/0161-capacity-targets-are-measured-nfrs-and-the-scale-path-is-staged.md).

## Environment

| Item           | Value                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host           | One laptop-class workstation: 13th-gen Intel Core i7-13650HX, 20 logical CPUs, 31 GB RAM, Linux 6.8. **Shared**: unrelated builds, tests and containers were running, load average 8 to 16 during the runs (host CPU peaks of 85% to 95%).    |
| App            | `Dockerfile.production` image, `APP_ENV=production`, roles `awcms_app` and `awcms_setup` (RLS in force), `EDGE_CACHE_MODE=off`, container limited to **2 CPUs** (`docker update --cpus 2`) so it can be compared with "per 2-vCPU node".      |
| Database       | PostgreSQL 18 in a container on tmpfs, `fsync=off`, no CPU limit. Synthetic tenant, 50 published posts.                                                                                                                                       |
| Generators     | 3 k6 processes (`grafana/k6:1.1.0`, `--k6-docker`) on the same host, aggregate rate split evenly. k6 was not installed on the host; the Docker image was used. No second machine was available, so the generators were not on separate hosts. |
| Profile        | `baseline`: 60 s ramp, **60 s hold**, 15 s ramp down (shorter than the 5-minute default). `spike`: 30 iterations/s for 2 min, 10x within 60 s, 60 s hold, return.                                                                             |
| Run            | Run id `lt-local1122`, one ephemeral environment for all runs below, destroyed afterwards.                                                                                                                                                    |
| Generator load | k6's own CPU stayed between 1.1% and 4.9% of the whole host; no run dropped more than 0.01% of iterations. The generators were never the limit.                                                                                               |

**Acceptance basis.** The default saturation check judges the generator by
whole-host CPU. On this shared host that reads 85% to 95% in every run, so the
default check rejected all of them for reasons that have nothing to do with the
generators (the same thing happened in the 15 November dry run). These runs
were merged with `--cpu-basis process`, which judges the k6 processes' own CPU
(the k6 CPU above) and prints the host CPU and load beside it. "Accepted" below
therefore means **the generators were not the limit**; it does **not** mean the
host was quiet. Neighbours may have taken CPU from the app and the database, so
every figure is likely pessimistic and none is repeatable to better than a wide
margin (see the 400 and 500 iterations/s rows).

## What a "rate" means here

One iteration is one page view or one API call. A public page view is **two
HTTP requests**: the origin answers `/blog/<tenant>/<post>` with a 307 to the
locale-prefixed path and k6 follows it. The report shows both counts; the table
below uses **iterations per second** (page views per second, or API calls per
second) unless it says "requests".

## Results

Mean requests/s is over the whole run including ramps. All runs: 3 generators, `--cpu-basis process`, no HTTP 429, no dropped
iterations to speak of. Latency is the worst generator's value (the
conservative bound); percentiles do not merge exactly.

### Public page at the origin (scenario 2), uncached

| Target iter/s | Mean requests/s | p50 ms | p95 ms | p99 ms | 5xx    | k6 thresholds | App CPU avg / peak (of 200%) | DB CPU avg / peak |
| ------------- | --------------- | ------ | ------ | ------ | ------ | ------------- | ---------------------------- | ----------------- |
| 300           | 421             | 3.2    | 6.9    | 14.3   | 0%     | pass          | 53% / 99%                    | 32% / 61%         |
| 400           | 558             | 4.5    | 130.0  | 353.0  | 18.77% | **fail**      | 69% / 124%                   | 46% / 83%         |
| 500           | 700             | n/a    | 121.8  | 238.0  | 14.98% | **fail**      | not kept                     | 57% / 88%         |
| 900           | 1,262           | 34.8   | 183.8  | 622.2  | 72.37% | **fail**      | 92% / 117%                   | 49% / 93%         |

The 400 and 500 rows are not monotonic (the 400 run served fewer requests and
failed harder than the 500 run). That is the neighbours: the same workstation
was running other work during the first and the later runs. The only
conclusion drawn is the bracket: **300 iterations/s passed cleanly, 400 and
above did not.**

**The limit is the database pool, not CPU.** At 400 and above the app logged
`database.pool.rejected` for the `interactive` work-class over 150,000 times across the runs
(8 connections active, queue of 32 full) and answered 5xx. On average the app was at
35% to 46% of its 2-CPU allowance (peaks of 58% to 62%) when it did. With the edge cache off, every
public render takes one pooled connection, so the ceiling is the size of that
pool and its queue. That agrees with what the 15 November dry run suggested.

### Scenario 1 (public page through a CDN)

**Not run.** There is no CDN in the ephemeral environment and no approved
CDN-fronted environment (#1281). Scenario 1 and the cache hit ratio remain
open.

### Authenticated admin read (scenario 3), `GET /api/v1/offices`

| Target iter/s | Mean requests/s | p50 ms | p95 ms | p99 ms | 5xx    | k6 thresholds | App CPU avg / peak | DB CPU avg / peak |
| ------------- | --------------- | ------ | ------ | ------ | ------ | ------------- | ------------------ | ----------------- |
| 300           | 210             | 8.3    | 20.4   | 42.0   | 0.03%  | pass          | not kept           | 94% / 156%        |
| 600           | 420             | 30.1   | 125.9  | 171.5  | 12.92% | **fail**      | 74% / 103%         | 176% / 277%       |

Here the database CPU, not the app, climbs (PostgreSQL was not CPU-limited and
reached nearly 3 cores); at 600 the 5xx rate is again pool rejection.

### Authenticated API write (scenario 4), `POST /api/v1/blog/posts`

| Target iter/s | Mean requests/s | p50 ms | p95 ms | p99 ms | 5xx | k6 thresholds | App CPU avg / peak | DB CPU avg / peak |
| ------------- | --------------- | ------ | ------ | ------ | --- | ------------- | ------------------ | ----------------- |
| 60            | 42              | 10.9   | 22.7   | 34.1   | 0%  | pass          | 17% / 80%          | 26% / 44%         |
| 150           | 105             | 9.5    | 12.7   | 16.1   | 0%  | pass          | 27% / 50%          | 53% / 114%        |

The write was not driven to its limit.

### Spike (10x within 60 s, ADR-0161)

Public page at the origin, 30 iterations/s for 2 minutes, then 300
iterations/s reached within 60 s and held for 60 s: p50 2.3 ms, p95 4.7 ms,
p99 7.6 ms, max 96.6 ms, **5xx 0%**, thresholds pass. App CPU 23% avg / 73%
peak, database 16% / 55%. The 10x factor held, but its peak (300 iterations/s)
is exactly the level the sustained run could carry, so this shows the shape
works, not that a bigger spike would.

## Against the ADR-0161 initial values

Local figures with these caveats; none of this closes an NFR.

| ADR-0161 initial value                                  | This run                                                                                                                                        | Verdict                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origin dynamic: 2,000 rps per 2-vCPU node, p95 < 500 ms | 300 page views/s clean (421 requests/s), p95 6.9 ms; limit between 300 and 400 views/s, set by the interactive DB pool, with the edge cache off | **Does not hold uncached**: about 15% of the target on a contended host. It can only hold with the edge cache doing the work, which this setup cannot show. Needs a run with the cache on. |
| Admin read p95 <= 500 ms, write <= 900 ms               | read p95 20 ms at 300 calls/s, write p95 23 ms at 60 calls/s, on a fast tmpfs database                                                          | **Holds here**, but tmpfs and `fsync=off` flatter the write. Needs a disk-backed database and a stated concurrency per tenant.                                                             |
| Spike 10x in 60 s, 5xx <= 1%                            | 0% 5xx with 30 to 300 iterations/s                                                                                                              | **Holds at this scale only.** Needs a spike whose peak is above the sustained ceiling to say what happens beyond it.                                                                       |
| Hit ratio >= 99%                                        | not measurable                                                                                                                                  | **Open**: needs a CDN-fronted environment.                                                                                                                                                 |

Values that need revising: none yet on this evidence. The origin value looks
unreachable **without** the edge cache; whether to keep 2,000 rps as an
edge-on target or restate it is a decision for the owner once a cache-on run
exists. The interactive pool size (8) and queue (32) are the first thing a
production-like run should vary.

## What was NOT measured

- CDN behaviour and hit ratio (scenario 1).
- Anything on a quiet host, a separate generator machine, or disk-backed
  PostgreSQL.
- A 5-minute hold; each run held for 60 seconds.
- The edge cache on (`--edge-cache`), Redis, a connection pooler.
- The p95 metric inside the app (issue #1287 is not done), so latency is from
  k6 only.
- Repeatability: each point was run once.

## Reproduce

```bash
bun run loadtest:env:up -- --run-id lt-local1122 --posts 50
set -a; . "$XDG_RUNTIME_DIR/awcms-loadtest-lt-local1122/loadtest.env"; set +a
docker update --cpus 2 awcms-lt-lt-local1122-app-1   # optional: model a 2-vCPU node
export LOADTEST_TARGET_APPROVED=lt-local1122
bun run loadtest:run -- --run-id lt-local1122 --base-url "$LOADTEST_BASE_URL" \
  --tenant-code "$LOADTEST_TENANT_CODE" --scenario public-page --profile baseline \
  --target-rps 300 --generators 3 --hold 60s --k6-docker
bun run loadtest:merge -- --run-id lt-local1122 --generators 3 --cpu-basis process
bun run loadtest:env:down -- --run-id lt-local1122
```

App and database CPU came from `docker stats` once per second during each run;
database connections from `pg_stat_activity` (peak 41 in every run).
