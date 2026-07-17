/**
 * Reporting read-model projections against a real PostgreSQL (Issue #154,
 * a focused port of awcms-mini's `reporting-projections.integration.test.ts`).
 *
 * WHY THIS FILE HAS TO EXIST WITH EXACTLY THIS NAME. Two shipped source
 * comments name `tests/integration/reporting-projections.integration.test.ts`
 * as the test that SHOULD cover behavior this repo could not, until now,
 * cover:
 *   - `src/modules/reporting/application/event-activity-projection.ts:89`
 *     says the watermark comparison it implements "has no counterpart here
 *     (this repo has no `tests/integration/` suite at all)".
 *   - `src/modules/reporting/README.md:136` says the same of the incremental
 *     worker's bounded-pass/resume correctness.
 * Those references are now TRUE — this is that counterpart. The two
 * behaviors those comments single out are the two `describe` blocks below;
 * everything else (`reporting-projection-rebuild-lock.test.ts`) already
 * existed and is deliberately NOT duplicated here.
 *
 * WHAT IS AND IS NOT PORTED. Mini's original is ~1.5k lines and also drives
 * scheduled exports, reconciliation drift, a dedicated `awcms_mini_worker`
 * least-privilege role (migration 069 — this repo has no separate worker
 * role, `getWorkerDatabaseClient` falls back to the app connection), and the
 * event-driven consumer under a live dispatcher tick. Those are either
 * absent here or belong in their own files; porting them wholesale would be
 * a copy, not an adaptation. This file ports precisely the two invariants the
 * in-repo comments promise, run against the least-privilege app role under
 * FORCE RLS.
 *
 * THE PROBE PROJECTION is a code-declared `ProjectionDescriptor` over a
 * throwaway source table this file owns — the same technique
 * `reporting-projection-rebuild-lock.test.ts` uses and for the same reason:
 * it lets these tests seed an exact, controlled row set without depending on
 * (or corrupting) the three real registered projections' source tables
 * (`awcms_abac_decision_logs`/`awcms_identities`/`awcms_sync_nodes`). The
 * source table is created by the OWNER role so migration 019's
 * `ALTER DEFAULT PRIVILEGES` auto-grants the app role SELECT on it.
 *
 * Skipped entirely unless `DATABASE_URL` is set (see harness.ts §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  getOwnerSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import type {
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../src/modules/_shared/module-contract";
import { runIncrementalUpdateForTenant } from "../../src/modules/reporting/application/projection-incremental-worker";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import { upsertStreamCursor } from "../../src/modules/reporting/application/projection-cursor-store";
import { applyEventActivityProjectionIncrement } from "../../src/modules/reporting/application/event-activity-projection";
import {
  EVENT_ACTIVITY_METRIC_KEYS,
  EVENT_ACTIVITY_REBUILD_STREAM_KEY,
  EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
} from "../../src/modules/reporting/domain/projection-keys";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SOURCE_TABLE = "awcms_reporting_projections_it_source";
const PROJECTION_KEY = "reporting.projections_it_probe";
const STREAM_KEY = "probe_rows";
const METRIC_KEY = "probe_row_count";

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
  description: "Issue #154 integration probe projection (never registered).",
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
  // Small on purpose so a 3-row seed needs more than one pass — this is what
  // makes the resume test exercise a real boundary rather than a single-shot.
  batchLimit: 2
};

/**
 * Distinct, explicit `created_at` per row — never the column DEFAULT, which
 * is STABLE for a whole transaction in Postgres and would collide with the
 * documented cursor-tie limitation in the incremental worker's header. Seeded
 * over the RLS-bypassing admin connection.
 */
async function seedSourceRows(tenantId: string, count: number): Promise<void> {
  const base = Date.now() - 120_000;

  for (let index = 0; index < count; index += 1) {
    await getAdminSql().unsafe(
      `INSERT INTO ${SOURCE_TABLE} (tenant_id, created_at) VALUES ($1, $2)`,
      [tenantId, new Date(base + index * 1000)]
    );
  }
}

async function readMetric(
  tenantId: string,
  projectionKey: string,
  metricKey: string
): Promise<number> {
  const metrics = await withTenant(getRuntimeSql(), tenantId, (tx) =>
    getProjectionMetrics(tx, tenantId, projectionKey)
  );

  return metrics[metricKey] ?? 0;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("reporting projections (Issue #154)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();

    // The probe's source table. Created by the OWNER (the migration owner) so
    // that BOTH runtime postures can read it: the owner reads it inherently,
    // and `ALTER DEFAULT PRIVILEGES` from migration 019 auto-grants `awcms_app`
    // SELECT on it. A table created by the admin SUPERUSER instead would NOT be
    // reachable by `awcms_app`, and the worker (running via `getRuntimeSql()`)
    // would fail with permission denied whenever migration 019 is present.
    await getOwnerSql().unsafe(`
      CREATE TABLE IF NOT EXISTS ${SOURCE_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
  });

  afterAll(async () => {
    // Drop the probe table before the database itself is torn down, so a
    // re-run in the same process (ref-counted harness) starts clean.
    await getOwnerSql().unsafe(`DROP TABLE IF EXISTS ${SOURCE_TABLE}`);
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    // `resetDatabase()` truncates the reporting metric/cursor/state tables;
    // the probe source table is NOT an `awcms_*` runtime table it truncates
    // by pattern... actually it IS (`awcms_` prefix), so it is emptied too.
    // Re-seed the two tenants and rows each test needs itself.
    await resetDatabase();

    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'reporting-a', 'Reporting A'),
             (${TENANT_B}, 'reporting-b', 'Reporting B')
    `;
  });

  describe("incremental cursor_table worker — correctness and resumability (pins README.md:136)", () => {
    test("a single full run counts every source row exactly once, through the real worker under the app role", async () => {
      await seedSourceRows(TENANT_A, 3);

      const outcome = await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A
      );

      expect(outcome.failed).toBe(false);
      expect(outcome.skippedRebuildInProgress).toBe(false);
      expect(outcome.rowsProcessed).toBe(3);
      expect(await readMetric(TENANT_A, PROJECTION_KEY, METRIC_KEY)).toBe(3);
    });

    test("running again with no new rows is a no-op — the cursor prevents re-counting already-processed rows", async () => {
      await seedSourceRows(TENANT_A, 3);

      await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A
      );
      const second = await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A
      );

      expect(second.rowsProcessed).toBe(0);
      // The metric must still read 3, NOT 6 — the invariant the cursor
      // exists for. A worker that re-scanned from the top would double it.
      expect(await readMetric(TENANT_A, PROJECTION_KEY, METRIC_KEY)).toBe(3);
    });

    test("a bounded first pass then a resumed run reach the exact same total (batchLimit=2 over 3 rows forces a real boundary)", async () => {
      await seedSourceRows(TENANT_A, 3);

      // ONE pass only. With batchLimit=2 this can process at most 2 of the 3
      // rows, so the run is deliberately left partial — the crash/resume
      // precondition, without an actual crash.
      const partial = await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A,
        1
      );

      expect(partial.rowsProcessed).toBe(2);
      expect(await readMetric(TENANT_A, PROJECTION_KEY, METRIC_KEY)).toBe(2);

      // Resume (unbounded). It must pick up AFTER the persisted cursor, apply
      // exactly the 1 remaining row, and never re-apply the first 2.
      const resumed = await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A
      );

      expect(resumed.rowsProcessed).toBe(1);
      expect(await readMetric(TENANT_A, PROJECTION_KEY, METRIC_KEY)).toBe(3);
    });

    test("cross-tenant isolation: A's run never touches B's metrics, and B's own run counts only B's rows (RLS on the metric table + the worker's own WHERE)", async () => {
      await seedSourceRows(TENANT_A, 3);
      await seedSourceRows(TENANT_B, 5);

      await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_A
      );

      // B has run nothing yet — its metric row must not exist at all, not
      // merely read 0 by leaking A's transaction.
      expect(await readMetric(TENANT_B, PROJECTION_KEY, METRIC_KEY)).toBe(0);

      await runIncrementalUpdateForTenant(
        getRuntimeSql(),
        DESCRIPTOR,
        TENANT_B
      );

      expect(await readMetric(TENANT_A, PROJECTION_KEY, METRIC_KEY)).toBe(3);
      expect(await readMetric(TENANT_B, PROJECTION_KEY, METRIC_KEY)).toBe(5);

      // And prove the isolation is RLS, not just the application filter:
      // reading A's metric key from INSIDE B's tenant context returns
      // nothing, even though the admin connection can see both rows.
      const leaked = await withTenant(getRuntimeSql(), TENANT_B, async (tx) => {
        return (await tx`
          SELECT tenant_id, metric_value
          FROM awcms_reporting_projection_metrics
          WHERE projection_key = ${PROJECTION_KEY}
        `) as { tenant_id: string; metric_value: number }[];
      });

      expect(leaked.map((row) => row.tenant_id)).toEqual([TENANT_B]);

      const bothViaAdmin = (await getAdminSql()`
        SELECT count(*)::int AS count
        FROM awcms_reporting_projection_metrics
        WHERE projection_key = ${PROJECTION_KEY}
      `) as { count: number }[];
      expect(bothViaAdmin[0]!.count).toBe(2);
    });
  });

  describe("event-activity watermark comparison (pins event-activity-projection.ts:89)", () => {
    const METRIC = EVENT_ACTIVITY_METRIC_KEYS.sampleRecordedCount;

    async function readEventMetric(tenantId: string): Promise<number> {
      return readMetric(
        tenantId,
        EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY,
        METRIC
      );
    }

    /** Sets the rebuild watermark for the event-activity projection to `at`. */
    async function setRebuildWatermark(
      tenantId: string,
      at: Date
    ): Promise<void> {
      await withTenant(getRuntimeSql(), tenantId, (tx) =>
        upsertStreamCursor(
          tx,
          tenantId,
          EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY,
          EVENT_ACTIVITY_REBUILD_STREAM_KEY,
          at
        )
      );
    }

    test("with NO rebuild watermark, every event increments the metric (the ordinary steady state)", async () => {
      await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
        applyEventActivityProjectionIncrement(tx, TENANT_A, new Date())
      );

      expect(await readEventMetric(TENANT_A)).toBe(1);
    });

    test("an event at or BEFORE the rebuild watermark is NOT counted — the rebuild's own re-scan already covered it (this is the double-count guard)", async () => {
      const watermark = new Date();
      await setRebuildWatermark(TENANT_A, watermark);

      // Strictly before, and exactly at, the watermark: both are "already
      // covered by the rebuild" and must be dropped.
      await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
        applyEventActivityProjectionIncrement(
          tx,
          TENANT_A,
          new Date(watermark.getTime() - 1000)
        )
      );
      await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
        applyEventActivityProjectionIncrement(tx, TENANT_A, watermark)
      );

      expect(await readEventMetric(TENANT_A)).toBe(0);
    });

    test("an event AFTER the rebuild watermark IS counted — the rebuild's scan never reached it", async () => {
      const watermark = new Date();
      await setRebuildWatermark(TENANT_A, watermark);

      await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
        applyEventActivityProjectionIncrement(
          tx,
          TENANT_A,
          new Date(watermark.getTime() + 1000)
        )
      );

      expect(await readEventMetric(TENANT_A)).toBe(1);
    });

    test("the watermark comparison is per tenant: A's watermark never suppresses B's identical-timestamp event", async () => {
      const watermark = new Date();
      await setRebuildWatermark(TENANT_A, watermark);

      const beforeWatermark = new Date(watermark.getTime() - 1000);

      // Same timestamp, two tenants: dropped for A (covered), counted for B
      // (B has no watermark of its own).
      await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
        applyEventActivityProjectionIncrement(tx, TENANT_A, beforeWatermark)
      );
      await withTenant(getRuntimeSql(), TENANT_B, (tx) =>
        applyEventActivityProjectionIncrement(tx, TENANT_B, beforeWatermark)
      );

      expect(await readEventMetric(TENANT_A)).toBe(0);
      expect(await readEventMetric(TENANT_B)).toBe(1);
    });
  });
});
