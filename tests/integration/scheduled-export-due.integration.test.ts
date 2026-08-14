/**
 * `listDueScheduledExports` against a real PostgreSQL.
 *
 * ## Why this file exists
 *
 * `reporting:exports:dispatch` failed on EVERY tick with
 *
 *     PostgresError: operator does not exist: timestamp with time zone > interval
 *
 * The statement binds `now` as a parameter and subtracts an interval from it:
 *
 *     er.created_at > ${now} - make_interval(mins => se.schedule_interval_minutes)
 *
 * The parameter arrives untyped, and the only clue Postgres has for inferring it
 * is the `- make_interval(...)` beside it, which resolves to `interval - interval`.
 * The expression is then an `interval`, and `timestamptz > interval` has no
 * operator, so the statement THROWS rather than returning a wrong answer.
 *
 * ## Why nothing caught it
 *
 * Three things had to be true at once, and they were:
 *
 * 1. The job was never scheduled — `crontab -l` carried one of 32 — so the
 *    statement had never executed anywhere.
 * 2. `--dry-run` reported `status: success`, because it never reaches this path.
 *    A dry-run is not a run.
 * 3. No test called this function. Every other test in `reporting` uses the
 *    projection tables, not the scheduled-export ones.
 *
 * It was found by putting the job on a real schedule and reading the log fifteen
 * minutes later.
 *
 * ## Why an INTEGRATION test, and not a unit test asserting the SQL text
 *
 * The defect is Postgres's parameter-type inference. A unit test that asserts
 * the query string contains `::timestamptz` would pass on any string containing
 * those characters and would keep passing if the cast moved somewhere useless —
 * it checks the shape, and the shape was never the problem. Only a real planner
 * can answer whether this statement is executable. So this calls the function.
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
  getOwnerSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { listDueScheduledExports } from "../../src/modules/reporting/application/scheduled-export-store";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("listDueScheduledExports (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    const owner = getOwnerSql();
    await owner`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT_A}, 'tenant-a', 'Tenant A', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  test("the statement is EXECUTABLE — the regression that broke every tick", async () => {
    // The assertion that matters is that this does not throw. Before the
    // `::timestamptz` cast it threw `operator does not exist: timestamp with
    // time zone > interval` for every tenant, every 15 minutes, with an empty
    // table and no configs at all — the failure is in planning, so it does not
    // need data to happen.
    const rows = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listDueScheduledExports(tx, TENANT_A, new Date())
    );

    expect(Array.isArray(rows)).toBe(true);
  });

  test("an enabled config with no prior run is DUE", async () => {
    const owner = getOwnerSql();
    await owner`
      INSERT INTO awcms_reporting_scheduled_exports
        (tenant_id, projection_key, format, schedule_interval_minutes, enabled)
      VALUES (${TENANT_A}, 'reporting.tenant_activity', 'csv', 60, true)
    `;

    const rows = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listDueScheduledExports(tx, TENANT_A, new Date())
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectionKey).toBe("reporting.tenant_activity");
  });

  test("a run INSIDE the interval suppresses it; one outside does not", async () => {
    const owner = getOwnerSql();
    const [config] = (await owner`
      INSERT INTO awcms_reporting_scheduled_exports
        (tenant_id, projection_key, format, schedule_interval_minutes, enabled)
      VALUES (${TENANT_A}, 'reporting.tenant_activity', 'csv', 60, true)
      RETURNING id
    `) as { id: string }[];

    // 10 minutes ago, well inside a 60-minute interval.
    await owner`
      INSERT INTO awcms_reporting_export_runs
        (tenant_id, scheduled_export_id, projection_key, format, status, created_at)
      VALUES (${TENANT_A}, ${config!.id}, 'reporting.tenant_activity', 'csv',
              'completed', now() - make_interval(mins => 10))
    `;

    const suppressed = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      (tx) => listDueScheduledExports(tx, TENANT_A, new Date())
    );
    expect(suppressed).toHaveLength(0);

    // Push the run outside the window. This is the half that proves the cast
    // did not merely make the statement runnable but left it comparing the
    // wrong things: with `now` inferred as anything but a timestamptz, this
    // boundary cannot be evaluated at all.
    await owner`
      UPDATE awcms_reporting_export_runs
      SET created_at = now() - make_interval(mins => 120)
      WHERE tenant_id = ${TENANT_A}
    `;

    const due = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listDueScheduledExports(tx, TENANT_A, new Date())
    );
    expect(due).toHaveLength(1);
  });

  test("a disabled config is never due", async () => {
    const owner = getOwnerSql();
    await owner`
      INSERT INTO awcms_reporting_scheduled_exports
        (tenant_id, projection_key, format, schedule_interval_minutes, enabled)
      VALUES (${TENANT_A}, 'reporting.tenant_activity', 'csv', 60, false)
    `;

    const rows = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listDueScheduledExports(tx, TENANT_A, new Date())
    );

    expect(rows).toHaveLength(0);
  });
});
