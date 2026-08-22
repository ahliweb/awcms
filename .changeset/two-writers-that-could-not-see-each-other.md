---
"awcms": patch
---

fix(sync-storage,reporting): two writers that could not see each other

Findings **C3** and **C4** of the 17 August 2026 audit round. One PR because
they are one mistake at two levels: a decision made from a read, and an action
taken on that decision, with nothing in between that holds them together. Being
inside a transaction is not that thing — READ COMMITTED re-snapshots per
**statement**.

**C3 — a lost update in the conflict foundation itself.** `POST /sync/push`
read `current_version`, checked it against the event's `baseVersion`, and then
wrote `current_version + 1` unconditionally. Two concurrent batches both read 5,
both passed the check, both wrote the literal 6: two conflicting events accepted,
**zero conflict rows**, one increment lost. Harmless downstream today only
because `awcms_sync_inbox` has no consumer — the defect is in the optimistic
concurrency itself.

The write is now a compare-and-set (`… DO UPDATE … WHERE current_version =
${expected}`), extracted to `advanceAggregateVersion` so it has one name and one
test. A CAS that matches nothing means another writer moved it in between, which
is exactly `version_mismatch` — the verdict the pure evaluator would have reached
on a fresh read, so a node sees an outcome it already understands. The inbox row
is now written **after** the version advances, not before; it used to be first,
so a losing batch left an accepted event behind for an increment it never made.

`SELECT … FOR UPDATE` on the prefetch was the alternative and is weaker: it locks
rows that exist, so two batches *creating* the same aggregate would both proceed,
and it would hold every aggregate in the batch for the whole transaction rather
than one row for one statement.

**C4 — a cursor that could step over a row that had not committed yet.** The
incremental projection worker selected `cursorColumn >= cursor` with **no upper
bound**. Postgres `now()` is transaction start, so a row written by a long
transaction carries a timestamp from before it committed and can land behind a
cursor that has already moved past it — never selected again. ADR-0077 rejected
exactly this shape for sync-pull; this engine kept it, and ADR-0072 declares the
incremental value authoritative, so nothing reconciles it.

The scan now stops at `now() - REPORTING_PROJECTION_LAG_SECONDS` (default 60).
The guarantee that buys is stated rather than implied: *a row is counted if the
transaction that wrote it committed within the lag of starting*. A writer holding
a transaction open longer than the lag is still missed — bounded and named, not
eliminated. `0` restores the old behaviour for a deployment that has measured its
own writers.

`pg_stat_activity`'s `min(xact_start)` would be exactly right and is unusable
here: a non-superuser without `pg_read_all_stats` reads NULL for other users, so
the bound would silently become `now()` — no bound at all, wearing the shape of
one. A wrong answer that looks like the right mechanism is worse than a plainly
approximate one.
