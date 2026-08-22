---
"awcms": patch
---

fix(ops,database): three operational signals that told an operator something untrue

PROJECT_STATE §4 **D9**, **D10**, **D11**. Three unrelated mechanisms, one shape:
each produced a signal an operator relies on, and each signal was wrong in a way
nothing reported.

**D9 — the log file named at attach time.** `ops/ship-logs.sh` redirected the
tailer with `>> "${DEST}/app-$(date -u +%Y-%m-%d).log"`. A redirect names its
file once, when the shell spawns the process, and the descriptor then lives
until the container changes — weeks on a stable deployment. So today's lines
landed in a file dated by the last DEPLOY, and the 30-day `-mtime` sweep could
never reclaim it: the file it should have been bounding was the only one still
growing. The redirect is now a `while read` loop that re-derives the date and
reopens with `>>` per line (`printf -v day "%(...)T"`, a builtin — no `date`
fork per line). The distinguishing property is testable without waiting for
midnight: delete the file underneath a running writer and see whether the next
line brings it back. The test executes exactly that, against the payload
extracted from the script, and carries a control case driving the old shape
through the same procedure.

**D10 — nothing read the readiness endpoint.** `/api/v1/database/pool/health`
reports `databaseReachable` and `circuitBreakerState`, is unauthenticated, and
was consulted by nothing; Coolify, the container `HEALTHCHECK` and the Varnish
probe all read the dependency-free liveness endpoint, so a release with an
unreachable database is marked successful and cut over.

The obvious fix is wrong and was not taken: those three RESTART or REROUTE, and
restarting an app does not repair a database — pointing them at readiness turns a
database outage into a container restart loop. Liveness is the right question
for them, and that reasoning is now written at each site so it is not "fixed"
later. What readiness needed was a reader on the path that pages a person:
`ops/synthetic-check.sh` now probes it every 10 minutes from outside, asserting
both fields, because the endpoint answers 200 while reporting the database is
gone. Coolify's own Health Check Path is configuration outside this repo — the
runbook states the split and says not to point it at readiness, and does not
pretend that is enforced.

**D11 — jobs ran as `interactive`, and it was seven scripts, not six.** The job
work-class registry names a class for every worker script and feeds the capacity
model, and seven scripts never passed it: their transactions took `withTenant`'s
`"interactive"` default, so nightly purges queued in the bucket sized for live
users. `site-search-reconcile.ts` had the drift running the other way, passing
`maintenance` where the registry says `background_sync` — resolved toward the
registry, whose entry carries an argued rationale where the script's literal
carried none.

The fix that matters is the gate: `db:work-class:generate` now refuses to run
when a script does not open its transactions as its declared class, in both
directions. It COUNTS rather than checking presence — a script with three calls
and one literal reads as declared to any presence check while two of its
transactions still run as `interactive`, and two of these scripts have exactly
that shape. It reads one file, the script, and says so: a job whose transactions
live in a module under `src/` is not covered by it.

Both documents that asserted jobs "do not call `acquireWorkClassSlot`" are
corrected. They were true when written and stayed after they stopped being
true — jobs go through `withTenantOrThrow`, which is that call.
