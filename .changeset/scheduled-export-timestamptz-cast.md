---
"awcms": patch
---

fix(reporting): `reporting:exports:dispatch` threw on every tick — an untyped parameter inferred as `interval`

Found by scheduling the job and reading the log fifteen minutes later:

    PostgresError: operator does not exist: timestamp with time zone > interval

`listDueScheduledExports` binds `now` as a parameter and subtracts an interval
from it. The parameter arrives untyped, and the only clue Postgres has for
inferring it is the `- make_interval(...)` beside it — which resolves to
`interval - interval`. The whole expression is then an `interval`, and comparing
a `timestamptz` to one has no operator, so the statement **throws** rather than
returning a wrong answer. Proven both ways directly against the production
planner: `PREPARE` fails without the cast and succeeds with `::timestamptz`.

**Three things had to be true at once for this to survive, and they were:**

1. The job had never been scheduled — the production crontab carried one of 32 —
   so the statement had never executed anywhere.
2. `--dry-run` reported `status: success`, because it never reaches this path.
   *A dry run is not a run.*
3. No test called this function. Every other reporting test uses the projection
   tables, not the scheduled-export ones.

The regression test is an INTEGRATION test, deliberately. A unit test asserting
the query string contains `::timestamptz` would pass on any string containing
those characters and keep passing if the cast moved somewhere useless — it checks
the shape, and the shape was never the problem. Only a real planner can answer
whether the statement is executable, so the test executes it, and also pins the
interval boundary in both directions so a cast that makes it *runnable* but
compares the wrong things still fails.
