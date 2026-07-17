---
"awcms": patch
---

Fix a TOCTOU between a reporting projection rebuild and the steady-state
incremental worker that could double-count a projection's metrics (Issue
#151).

`projection-incremental-worker.ts`'s rebuild guard (`isRebuildRunning`) ran
in a `withTenant` transaction of its own, committed, and only then opened a
separate transaction per pass. A rebuild triggered in that window reset the
projection's cursors to NULL and its metrics to 0 *after* the guard had
already reported "no rebuild is running", so the incremental pass re-scanned
the source table from the beginning while the rebuild's own passes did the
same — both applying the same delta to the same metric row (they serialize
on that row lock and therefore sum). The file's own header claimed the
opposite invariant ("idempotent rebuild must never double-count").

- New `reporting/application/projection-lock.ts`: a per-(tenant, projection)
  `pg_advisory_xact_lock`, taken as the FIRST statement of every transaction
  that writes a projection's cursor/metric rows — `runCursorStreamPass`,
  `triggerOrResumeRebuild`, `runRebuildStreamPass`, and
  `applyEventActivityProjectionIncrement`. Held by the database for the whole
  transaction and released automatically at COMMIT/ROLLBACK.
- `runCursorStreamPass` now also re-checks `findRunningRebuild` inside that
  same locked transaction, and reports the skip as a pass result
  (`CursorStreamPassResult.skippedRebuildInProgress`) instead of the caller
  pre-checking it in an earlier, separate transaction.

Relocating the check alone would not have been sufficient: these transactions
run at READ COMMITTED, where every statement takes a fresh snapshot, so a
check and an act are not atomic with respect to a concurrently committing
writer even within one transaction. The lock is also the only mechanism that
works across processes — the rebuild trigger runs in a web request while the
incremental worker runs in a separate `reporting:projections:refresh`
process, which no in-process gate can serialize.

No migration, no API change, no event change: `pg_advisory_xact_lock` needs
no schema. `runIncrementalUpdateForTenant`'s observable outcome shape is
unchanged; a skipped run still reports `skippedRebuildInProgress: true` with
`rowsProcessed: 0`.

Also corrects stale references to
`tests/integration/reporting-projections.integration.test.ts`
(`projection-incremental-worker.ts`, `event-activity-projection.ts`, and the
module README) — that file exists in awcms-mini, not here, and this
repository has no `tests/integration/` suite at all.
