---
"awcms": minor
---

fix(visitor-analytics,data-lifecycle): two reads with no ceiling

Findings **C2** and **C5** of the 17 August 2026 audit round. `sql/145`. One PR
because they are one habit: a statement whose real cost is O(everything this
tenant has ever accumulated), written where the author was thinking about one
subject or one cutoff.

**C2 — the only unbounded retention purge in the repo.** Four statements with no
batch limit, each using `RETURNING id` purely to take a JS-side `.length`. A
tenant with a year of unpurged analytics deleted every row in one transaction:
one lock set held for the duration, one WAL burst, and a `statement_timeout` that
turns the whole pass into a rollback rather than partial progress. Every sibling
already caps at 5000 and loops.

All four statements are now `WHERE <pk> IN (SELECT … ORDER BY … LIMIT n)` — the
shape `audit-purge.ts` established — and the function returns `hasMore`. The
scheduled job loops with a **fresh transaction per pass** (looping inside one
would hold every lock and dead tuple for the duration, which is the thing the
batching exists to avoid) and reports any tenant that hits the pass cap. The
on-demand endpoint does **one** bounded pass and returns `hasMore`, because the
size of the work is unknown when the caller presses the button.

*What the ORDER BY buys is stated precisely rather than assumed.* Termination
does not depend on it — a DELETE removes what it took. It buys oldest-first,
which matches the index the predicate already uses and means an interrupted purge
has removed the data furthest past retention rather than an arbitrary slice. On a
retention control, "which half got deleted" is not a detail. This correction came
from a mutation: removing the ORDER BY left every test green, and the code comment
claiming it gave monotonic progress was wrong.

**C5 — a subject-access export with 49 unbounded reads, two over unindexed
columns.** `awcms_audit_events.actor_tenant_user_id` and the `awcms_domain_events`
twin have no index and are **not foreign keys**, deliberately (an audit row must
survive the deletion of the actor it names), so `db:fk-index:check` structurally
cannot see them. The near-miss makes it worse:
`awcms_audit_events_actor_tenant_idx` covers `actor_tenant_id` — the delegated
actor's *tenant*, a different column one character apart in reading.

`sql/145` adds three partial indexes. **Measured** on 60,000 rows: the actor read
went from a Seq Scan touching 858 buffers (2.5 ms) to an Index Scan touching 33
(0.039 ms).

The reads are also row-capped, with the cap reported. A cap on a subject-access
export is only acceptable because it is **flagged**: an export that quietly
returned the first N rows would answer a legal obligation with a number dressed
as an answer — strictly worse than the unbounded read it replaced, which was at
least honest. `truncated` is per table, `truncatedTables` rides in the response
beside the existing `unanswered` coverage statement, and the `critical` audit
event says INCOMPLETE in its message. The cap is a safety valve against a
pathological subject (an automation account named as actor on a million rows),
not a page size; there is deliberately no cursor, because a "complete answer"
assembled across pages has a boundary at every request where a partial answer can
be mistaken for the whole one.
