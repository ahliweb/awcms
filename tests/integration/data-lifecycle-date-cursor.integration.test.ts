/**
 * Issue #1276: a descriptor whose cursor column is `date` (a reporting
 * projection's `day`) runs through the generic purge engine and the dry-run
 * planner as a PURGE-ONLY table (a date cursor cannot be archived: see
 * `cursorColumnType` in module-contract).
 *
 * What these tests pin (audit follow-up, exact assertions, three session
 * TimeZones):
 * - the cutoff DAY is kept: `day < utcDate(cutoff)`, so a row whose day equals
 *   the cutoff's UTC date is NOT eligible whatever the session TimeZone;
 * - many rows sharing one day drain completely across batches, with no row of a
 *   kept day touched;
 * - dry run and real purge agree on the eligible set.
 *
 * The original motivation (Bun.SQL binding a JS `Date` that PostgreSQL refuses
 * for a `date` column, `22007`) is NOT reproducible on Bun 1.4.4 (it sends the
 * Date as ISO text and the comparison works), so that failure mode is not what
 * turns these tests red; the session-TimeZone semantics are. Skipped without a
 * database.
 */
import {
  afterAll,
  beforeAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  appRoleActivated,
  createRuntimePool,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { HighVolumeTableDescriptor } from "../../src/modules/_shared/module-contract";
import {
  runGenericArchivePass,
  runGenericPurgePass
} from "../../src/modules/data-lifecycle/application/archive-purge-job";
import { planLifecycleDryRun } from "../../src/modules/data-lifecycle/application/dry-run-planner";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TABLE = "awcms_t1276_daily";
// cutoff = NOW - 30d = 2026-06-01T10:00:00Z: day 2026-06-01 must be KEPT.
const NOW = new Date("2026-07-01T10:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - 30 * 86_400_000);

function descriptor(batchLimit = 100): HighVolumeTableDescriptor {
  return {
    key: "t1276.daily",
    tableName: TABLE,
    ownerModuleKey: "logging",
    scope: "tenant",
    cursorColumn: "day",
    cursorColumnType: "date",
    retentionClass: "operational",
    retentionMinDays: 1,
    retentionMaxDays: 3650,
    defaultRetentionDays: 30,
    partition: { eligible: false, rationale: "test" },
    archive: { archivable: false, rationale: "test" },
    deletion: { mode: "hard_delete", rationale: "test" },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [{ columns: ["tenant_id", "day"], purpose: "test" }],
    batchLimit,
    backupRestoreNotes: "test",
    executionMode: "generic"
  } as unknown as HighVolumeTableDescriptor;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("data_lifecycle with a date cursor column (#1276)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await getAdminSql().unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'tenant-a', 'Tenant A', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
    await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.unsafe(
      `CREATE TABLE ${TABLE} (id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, day date NOT NULL)`
    );
    if (appRoleActivated) {
      await admin.unsafe(`GRANT SELECT, DELETE ON ${TABLE} TO awcms_app`);
    }
    // Eligible: 04-01, 04-02, 05-01, 05-31. Kept: 06-01 (the cutoff day), 06-20, 06-25.
    await admin.unsafe(
      `INSERT INTO ${TABLE} (tenant_id, day) VALUES
        ('${TENANT}', '2026-04-01'), ('${TENANT}', '2026-04-02'), ('${TENANT}', '2026-05-01'),
        ('${TENANT}', '2026-05-31'), ('${TENANT}', '2026-06-01'),
        ('${TENANT}', '2026-06-20'), ('${TENANT}', '2026-06-25')`
    );
  });

  async function remainingDays(): Promise<string[]> {
    const rows = (await getAdminSql().unsafe(
      `SELECT to_char(day, 'YYYY-MM-DD') AS d FROM ${TABLE} ORDER BY id`
    )) as { d: string }[];

    return rows.map((r) => r.d);
  }

  const KEPT = ["2026-06-01", "2026-06-20", "2026-06-25"];

  for (const zone of ["UTC", "Asia/Jakarta", "America/New_York"]) {
    describe(`session TimeZone ${zone}`, () => {
      let pool: Bun.SQL;
      let dbName = "";

      beforeEach(async () => {
        const admin = getAdminSql();
        const [row] = (await admin`SELECT current_database() AS n`) as {
          n: string;
        }[];
        dbName = row!.n;
        await admin.unsafe(
          `ALTER DATABASE "${dbName}" SET TimeZone = '${zone}'`
        );
        pool = createRuntimePool(1);
        const [tz] = (await pool`SHOW TimeZone`) as { TimeZone: string }[];
        expect(tz!.TimeZone).toBe(zone);
      });
      afterEach(async () => {
        await pool.close();
        await getAdminSql().unsafe(`ALTER DATABASE "${dbName}" RESET TimeZone`);
      });

      test("dry run counts exactly the 4 eligible days, not the cutoff day", async () => {
        const plan = await withTenantOrThrow(pool, TENANT, (tx) =>
          planLifecycleDryRun(tx, descriptor(), TENANT, [], NOW)
        );
        if (plan instanceof Response) throw new Error("unexpected 503");
        expect(plan.eligibleCount).toBe(4);
      });

      test("purge removes exactly the eligible days and keeps the cutoff day", async () => {
        const r = await runGenericPurgePass(
          pool,
          descriptor(),
          TENANT,
          CUTOFF,
          "c1"
        );
        expect(r.count).toBe(4);
        expect(await remainingDays()).toEqual(KEPT);
      });

      test("many rows sharing one day drain across batches; kept days untouched", async () => {
        await getAdminSql().unsafe(
          `INSERT INTO ${TABLE} (tenant_id, day)
           SELECT '${TENANT}', '2026-03-10' FROM generate_series(1, 5)`
        );
        let total = 0;
        for (let pass = 0; pass < 10; pass += 1) {
          const r = await runGenericPurgePass(
            pool,
            descriptor(2),
            TENANT,
            CUTOFF,
            `c${pass}`
          );
          total += r.count;
          if (r.count === 0) break;
        }
        expect(total).toBe(9);
        expect(await remainingDays()).toEqual(KEPT);
      });
    });
  }

  test("the engine refuses an ARCHIVABLE date-cursor descriptor before touching the table", async () => {
    const d = {
      ...descriptor(),
      archive: {
        archivable: true,
        port: "local_offline",
        format: "jsonl",
        rationale: "test"
      }
    } as unknown as HighVolumeTableDescriptor;
    const sql = getRuntimeSql();
    const port = {} as never;

    await expect(
      runGenericArchivePass(sql, d, TENANT, CUTOFF, port, "x")
    ).rejects.toThrow(/date cursor/);
    await expect(
      runGenericPurgePass(sql, d, TENANT, CUTOFF, "x")
    ).rejects.toThrow(/date cursor/);
    expect(await remainingDays()).toHaveLength(7);
  });
});
