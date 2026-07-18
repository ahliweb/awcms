/**
 * Issue #151 — rebuild vs. incremental mutual exclusion, against a REAL
 * PostgreSQL.
 *
 * Why a real database and not a `Bun.SQL` double: the bug being pinned is a
 * TOCTOU between two transactions, and the fix is a `pg_advisory_xact_lock`
 * (`src/modules/reporting/application/projection-lock.ts`). Both the bug
 * and the fix are properties of Postgres' own concurrency behavior —
 * transaction boundaries, READ COMMITTED per-statement snapshots, lock
 * waits. A mock has none of those, so a mock-based test could only assert
 * "the code calls the function we told it to call", which would pass
 * against an implementation that still double-counts.
 *
 * Gated on `DATABASE_URL`, the same convention this repo's CI already uses:
 * `.github/workflows/ci.yml`'s `quality` job has no Postgres service and no
 * `DATABASE_URL`, so these skip cleanly there; they actually execute in
 * `ci.yml`'s `integration-tests` job and `release.yml`'s `validate` job, each
 * in a dedicated `bun test <legacy files>` step run separately from the
 * harness-based `tests/integration/` suite (see `tests/integration/
 * harness.ts` — the two collide if run together in one `bun test` process).
 *
 * DETERMINISM (no sleep-and-hope on the ASSERTED behavior): every test
 * below forces the interleaving with a real lock held by a dedicated
 * connection the test itself controls, rather than racing two workers and
 * hoping the window is hit. The `sleep`s only ever give the OLD (buggy)
 * code time to finish doing the wrong thing — making the failure it
 * produces reliable, never masking one.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import type {
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../src/modules/_shared/module-contract";
import { withTenant } from "../src/lib/database/tenant-context";
import { runIncrementalUpdateForTenant } from "../src/modules/reporting/application/projection-incremental-worker";
import { lockProjectionForWrite } from "../src/modules/reporting/application/projection-lock";
import { getProjectionMetrics } from "../src/modules/reporting/application/projection-metric-store";
import { triggerOrResumeRebuild } from "../src/modules/reporting/application/projection-rebuild";
import { findRunningRebuild } from "../src/modules/reporting/application/rebuild-run-store";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * A throwaway source table owned by this test, NOT one of the three real
 * registered projections' source tables (`awcms_abac_decision_logs`,
 * `awcms_identities`, `awcms_sync_nodes`). The engine reads whatever a
 * CODE-DECLARED descriptor names (validated against `assertSafeIdentifier`'s
 * `^awcms_[a-z][a-z0-9_]*$`), so a purpose-built table lets these tests
 * seed an exact, controlled row set without depending on — or corrupting —
 * another module's schema.
 */
const SOURCE_TABLE = "awcms_reporting_lock_test_source";
const PROJECTION_KEY = "reporting.lock_probe";
const STREAM_KEY = "probe_rows";
const METRIC_KEY = "probe_row_count";
const SEEDED_ROW_COUNT = 3;

const STREAM: ProjectionCursorStream = {
  streamKey: STREAM_KEY,
  tableName: SOURCE_TABLE,
  cursorColumn: "created_at",
  metrics: [{ metricKey: METRIC_KEY, effect: "increment" }]
};

const DESCRIPTOR: ProjectionDescriptor = {
  key: PROJECTION_KEY,
  version: 1,
  ownerModuleKey: "reporting",
  scope: "tenant",
  description: "Issue #151 test-only probe projection.",
  source: { strategy: "cursor_table", streams: [STREAM] },
  rebuildSource: { streams: [STREAM] },
  metricLabels: { [METRIC_KEY]: "Probe rows" },
  requiredPermission: "reporting.projections.read",
  freshness: {
    targetSeconds: 300,
    staleAfterSeconds: 900,
    errorAfterConsecutiveFailures: 3
  },
  retentionClass: "test-only, never registered in a module descriptor",
  batchLimit: 100
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves to `"pending"` if `promise` has not settled within `ms` — how the "the trigger must NOT be able to proceed" assertion is made without waiting on a promise that is supposed to stay blocked. */
async function settleWithin<T>(
  promise: Promise<T>,
  ms: number
): Promise<"pending" | { settled: T }> {
  return Promise.race([
    promise.then((value) => ({ settled: value }) as const),
    sleep(ms).then(() => "pending" as const)
  ]);
}

const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase(
  "reporting projections — rebuild vs. incremental mutual exclusion (Issue #151)",
  () => {
    let sql: Bun.SQL;
    let blockerSql: Bun.SQL;
    let tenantId: string;

    beforeAll(async () => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 6 });
      // A pool of its own for the connection that deliberately sits inside
      // an open transaction holding a lock — it must never contend with the
      // worker under test for a pooled connection.
      blockerSql = new Bun.SQL(DATABASE_URL!, { max: 2 });

      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${SOURCE_TABLE} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL,
          created_at timestamptz NOT NULL
        )
      `);

      const inserted = (await sql`
        INSERT INTO awcms_tenants (tenant_code, tenant_name, status)
        VALUES ('reporting-lock-test-151', 'Reporting Lock Test 151', 'active')
        ON CONFLICT (tenant_code) DO UPDATE SET tenant_name = EXCLUDED.tenant_name
        RETURNING id
      `) as { id: string }[];

      tenantId = inserted[0]!.id;
    });

    afterAll(async () => {
      if (!tenantId) return;

      await sql.unsafe(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`);
      await sql`DELETE FROM awcms_reporting_rebuild_runs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_cursors WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_metrics WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_state WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
      await sql.end();
      await blockerSql.end();
    });

    beforeEach(async () => {
      await sql`DELETE FROM awcms_reporting_rebuild_runs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_cursors WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_metrics WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_reporting_projection_state WHERE tenant_id = ${tenantId}`;
      await sql.unsafe(`DELETE FROM ${SOURCE_TABLE} WHERE tenant_id = $1`, [
        tenantId
      ]);
      await seedSourceRows();
    });

    /**
     * Each row gets a DISTINCT, explicit `created_at` — never the column's
     * own `DEFAULT now()`, which is STABLE for a whole transaction in
     * Postgres and would give every row the same cursor value, colliding
     * head-on with the documented cursor-tie limitation in
     * `projection-incremental-worker.ts`'s header.
     */
    async function seedSourceRows(): Promise<void> {
      const base = Date.now() - 60_000;

      for (let index = 0; index < SEEDED_ROW_COUNT; index += 1) {
        await sql.unsafe(
          `INSERT INTO ${SOURCE_TABLE} (tenant_id, created_at) VALUES ($1, $2)`,
          [tenantId, new Date(base + index * 1000)]
        );
      }
    }

    async function readMetric(): Promise<number> {
      const metrics = await withTenant(sql, tenantId, (tx) =>
        getProjectionMetrics(tx, tenantId, PROJECTION_KEY)
      );

      return metrics[METRIC_KEY] ?? 0;
    }

    test("an incremental pass applies its deltas normally when no rebuild owns the projection (baseline: the lock does not break the happy path)", async () => {
      const outcome = await runIncrementalUpdateForTenant(
        sql,
        DESCRIPTOR,
        tenantId
      );

      expect(outcome.failed).toBe(false);
      expect(outcome.skippedRebuildInProgress).toBe(false);
      expect(outcome.rowsProcessed).toBe(SEEDED_ROW_COUNT);
      expect(await readMetric()).toBe(SEEDED_ROW_COUNT);
    });

    /**
     * PINS THE BUG (fails before the fix). The worker's rebuild guard used
     * to run in a `withTenant` transaction of its OWN, commit, and only
     * THEN open a separate transaction per pass. This test drops a rebuild
     * trigger squarely into that window.
     *
     * The window is made deterministic rather than raced: the blocker
     * connection takes the (tenant, projection) advisory lock FIRST and
     * holds it across the trigger, so the fixed worker cannot get past its
     * own first statement until the trigger has committed. The OLD worker
     * takes no lock at all, so it sails through the guard and applies a
     * full delta — which is exactly the double-count precondition the
     * issue describes, and exactly what this test catches:
     *
     *   OLD: rowsProcessed = 3, skippedRebuildInProgress = false
     *   NEW: rowsProcessed = 0, skippedRebuildInProgress = true
     */
    test("a rebuild triggered after the worker started still forces a SKIP — the rebuild check is inside the pass transaction, under the lock", async () => {
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      let signalLockHeld!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        signalLockHeld = resolve;
      });

      const blocker = blockerSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
        await lockProjectionForWrite(tx, tenantId, PROJECTION_KEY);
        signalLockHeld();
        await gate;

        // Exactly how the real API route does it: inside the caller's own
        // already-open transaction (`src/pages/api/v1/reports/projections/
        // [key]/rebuild/index.ts`).
        await triggerOrResumeRebuild(tx, tenantId, DESCRIPTOR, {
          requestedBy: null,
          reason: "Issue #151 TOCTOU probe"
        });
      });

      await lockHeld;

      const workerRun = runIncrementalUpdateForTenant(
        sql,
        DESCRIPTOR,
        tenantId
      );

      let outcome;

      try {
        // Generous: the fixed worker is blocked on the lock and cannot
        // progress; the OLD worker needs only a few ms to run to completion
        // here, which is the whole point — it makes the pre-fix failure
        // deterministic rather than timing-dependent.
        await sleep(750);
      } finally {
        // ALWAYS release the blocker's transaction, even if something above
        // threw — an abandoned open transaction holding this lock would
        // otherwise stall every subsequent test's `beforeEach` cleanup
        // rather than letting them report their own results.
        openGate();
        await blocker;
        outcome = await workerRun;
      }

      expect(outcome.skippedRebuildInProgress).toBe(true);
      expect(outcome.rowsProcessed).toBe(0);
      expect(outcome.failed).toBe(false);
      // The rebuild's reset is the last write to land, so the metric must
      // be exactly the reset value — never the reset value plus a delta the
      // worker applied on top of it.
      expect(await readMetric()).toBe(0);
    });

    /**
     * PINS THE OTHER HALF OF THE SAME BUG (fails before the fix), from the
     * rebuild's side: `triggerOrResumeRebuild` is the ONLY code that resets
     * a projection's cursors to NULL and its metrics to 0. Migration 015's
     * partial unique index stops two concurrent TRIGGERS from both
     * resetting, but knows nothing about an incremental pass that is
     * already in flight — so before the fix the reset could land in the
     * middle of one, which is what makes the pass re-scan the source table
     * from the beginning and double-count against the rebuild's own scan.
     *
     * Determinism: the pass is pinned mid-transaction by an ACCESS
     * EXCLUSIVE lock on the SOURCE table (taken by the blocker), which the
     * pass hits at its `SELECT ... FROM <source>` — i.e. AFTER it has taken
     * the projection lock and read the cursor, but BEFORE it commits. The
     * trigger touches no source table at all, so nothing but the projection
     * lock itself can hold it back.
     */
    test("a rebuild trigger cannot reset cursors/metrics while an incremental pass transaction is still in flight", async () => {
      let releaseTableLock!: () => void;
      const tableLockGate = new Promise<void>((resolve) => {
        releaseTableLock = resolve;
      });
      let signalTableLocked!: () => void;
      const tableLocked = new Promise<void>((resolve) => {
        signalTableLocked = resolve;
      });

      const blocker = blockerSql.begin(async (tx) => {
        await tx.unsafe(`LOCK TABLE ${SOURCE_TABLE} IN ACCESS EXCLUSIVE MODE`);
        signalTableLocked();
        await tableLockGate;
      });

      await tableLocked;

      const workerRun = runIncrementalUpdateForTenant(
        sql,
        DESCRIPTOR,
        tenantId
      );
      // Let the pass reach — and stall on — the source-table SELECT, with
      // its transaction (and, after the fix, the projection lock) open.
      await sleep(500);

      const triggerRun = withTenant(sql, tenantId, (tx) =>
        triggerOrResumeRebuild(tx, tenantId, DESCRIPTOR, {
          requestedBy: null,
          reason: "Issue #151 reset-mid-pass probe"
        })
      );

      let triggerOutcome;

      try {
        triggerOutcome = await settleWithin(triggerRun, 750);
      } finally {
        // Same discipline as the test above: never leave the source table
        // locked by an abandoned transaction.
        releaseTableLock();
        await blocker;
        await workerRun;
        await triggerRun;
      }

      // OLD: the trigger takes no lock, never reads the source table, and
      // therefore commits its reset right here — underneath an incremental
      // pass that has already read the pre-reset cursor and is about to
      // apply a delta on top of the reset metric.
      expect(triggerOutcome).toBe("pending");

      // Once everything drains, exactly one rebuild owns the projection and
      // the reset it performed is intact.
      const running = await withTenant(sql, tenantId, (tx) =>
        findRunningRebuild(tx, tenantId, PROJECTION_KEY)
      );
      expect(running).not.toBeNull();
    });
  }
);
