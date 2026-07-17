/**
 * Per-(tenant, projection) transaction-scoped mutual exclusion for every
 * write path that touches a projection's cursor/metric rows (Issue #151).
 *
 * WHY A LOCK AND NOT JUST "MOVE THE CHECK INTO THE TRANSACTION"
 * ------------------------------------------------------------
 * Issue #151 offers two candidate fixes for the TOCTOU between the
 * steady-state incremental worker and a rebuild trigger. Moving
 * `findRunningRebuild` into `runCursorStreamPass`'s own transaction is
 * NECESSARY but on its own NOT SUFFICIENT, because these transactions run
 * at READ COMMITTED (Postgres' default, which `withTenant` never
 * overrides): every statement inside one transaction takes a FRESH
 * snapshot, so a `triggerOrResumeRebuild` that commits between the pass's
 * `findRunningRebuild` statement and its `getStreamCursor` statement is
 * still invisible to the first and visible to the second — the exact
 * check-then-act window the issue describes, merely narrowed from
 * "between two transactions" to "between two statements". Worse, moving
 * the check alone does nothing about the OTHER half of the same hazard:
 * two pass transactions (one incremental, one rebuild) that both read a
 * freshly-reset `cursor_value = NULL` concurrently BOTH re-scan the source
 * table from the beginning and BOTH `applyMetricDeltas`, which serialize
 * on the metric row lock and therefore SUM rather than collide — a silent
 * double-count, precisely what this module's headers claim can never
 * happen.
 *
 * `pg_advisory_xact_lock` closes both: it is held by the DATABASE for the
 * whole transaction and released automatically at COMMIT/ROLLBACK (no
 * leak path, no cleanup code), and — unlike `work-class.ts`'s in-process
 * semaphore — it is effective ACROSS PROCESSES, which is mandatory here:
 * the rebuild trigger runs in a web request (`app` client, `interactive`
 * work class) while the incremental worker runs in a separate `bun run
 * reporting:projections:refresh` process (`worker` client, `maintenance`
 * work class). No in-process gate can serialize those two.
 *
 * Every writer of a (tenant, projection)'s cursor/metric rows takes this
 * lock as the FIRST statement of its transaction, before reading anything
 * it then acts on:
 * - `projection-incremental-worker.ts`'s `runCursorStreamPass`
 * - `projection-rebuild.ts`'s `triggerOrResumeRebuild` (the ONLY resetter)
 *   and `runRebuildStreamPass`
 * - `event-activity-projection.ts`'s `applyEventActivityProjectionIncrement`
 *
 * Lock-ordering discipline (deadlock avoidance): this lock is always
 * acquired FIRST, before any row lock on the cursor/metric/rebuild-run
 * tables. Since every participant follows the same order and there is
 * exactly one lock per (tenant, projection), no cycle can form.
 *
 * Blocking (`pg_advisory_xact_lock`), not try-and-skip
 * (`pg_try_advisory_xact_lock`): the contending sections are all bounded,
 * short transactions (one `batchLimit`-sized page, or a single reset), so
 * the wait is bounded — and `client.ts` sets a session `statement_timeout`
 * on every pooled connection, which caps a pathological wait rather than
 * hanging forever. Skipping instead would just re-introduce "this pass
 * silently did nothing" as a new failure mode. This deliberately differs
 * from `src/lib/jobs/advisory-lock.ts`, which is non-blocking because
 * "this scheduled tick is skipped, the next one runs" is a correct outcome
 * for a whole job run; here the caller is already inside a transaction it
 * intends to complete.
 */
import { createHash } from "node:crypto";

/**
 * `int4` namespace for the two-`int4` advisory-lock form, deliberately
 * distinct from `src/lib/jobs/advisory-lock.ts`'s `JOB_LOCK_NAMESPACE`
 * (`890_417_233`) — session-level and transaction-level advisory locks
 * share ONE lock space, so a namespace collision between a job lock and a
 * projection lock would make unrelated things block each other. (The
 * two-`int4` space is separate from the single-`bigint` space
 * `scripts/db-migrate.ts`'s own migration lock uses, so no coordination
 * with that key is needed.)
 */
export const REPORTING_PROJECTION_LOCK_NAMESPACE = 604_918_377;

/**
 * Stable 31-bit key for one (tenant, projection) pair — same derivation
 * `advisory-lock.ts`'s `hashJobNameToInt32` established (sha256, masked to
 * the non-negative `int4` range so the value is trivially valid across
 * every driver/serialization path). The two components are joined with a
 * separator that cannot appear in a `projection_key` (its DB `CHECK`
 * constrains it to `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`) nor in a UUID, so
 * distinct pairs can never produce the same input string.
 *
 * A hash COLLISION between two genuinely different pairs is possible in
 * principle (2^31 key space) and is HARMLESS: the only consequence is that
 * two unrelated (tenant, projection) pairs briefly serialize against each
 * other. It can never cause the reverse — two writers of the SAME pair
 * running concurrently — which is the only outcome correctness depends on.
 */
export function hashProjectionLockKey(
  tenantId: string,
  projectionKey: string
): number {
  const digest = createHash("sha256")
    .update(`${tenantId}|${projectionKey}`)
    .digest();

  return digest.readUInt32BE(0) & 0x7fffffff;
}

/**
 * Acquires the (tenant, projection) lock for the REMAINDER of `tx`'s
 * transaction. Blocks until it is available; released automatically by
 * Postgres at COMMIT/ROLLBACK. Re-entrant within one session (Postgres
 * advisory locks are counted), so a caller already holding it — e.g. a
 * route transaction that locked before calling `triggerOrResumeRebuild`,
 * which locks again itself — is never self-blocked.
 */
export async function lockProjectionForWrite(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      ${REPORTING_PROJECTION_LOCK_NAMESPACE},
      ${hashProjectionLockKey(tenantId, projectionKey)}
    )
  `;
}
