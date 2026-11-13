/**
 * Issue #1276: a descriptor whose cursor column is `date` (a reporting
 * projection's `day`) must run through the generic archive/purge engine and the
 * dry-run planner. Bun.SQL binds a JS `Date` parameter as its `toString()`,
 * which PostgreSQL refuses for a `date` column (`22007`) unless the parameter is
 * cast (`$N::timestamptz`). Skipped without a database.
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
  appRoleActivated,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { HighVolumeTableDescriptor } from "../../src/modules/_shared/module-contract";
import type { ArchivePort } from "../../src/modules/data-lifecycle/domain/archive-port";
import {
  runGenericArchivePass,
  runGenericPurgePass
} from "../../src/modules/data-lifecycle/application/archive-purge-job";
import { planLifecycleDryRun } from "../../src/modules/data-lifecycle/application/dry-run-planner";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TABLE = "awcms_t1276_daily";
const NOW = new Date("2026-07-01T00:00:00.000Z");

function descriptor(archivable: boolean): HighVolumeTableDescriptor {
  return {
    key: "t1276.daily",
    tableName: TABLE,
    ownerModuleKey: "logging",
    scope: "tenant",
    cursorColumn: "day",
    retentionClass: "operational",
    retentionMinDays: 1,
    retentionMaxDays: 3650,
    defaultRetentionDays: 30,
    partition: { eligible: false, rationale: "test" },
    archive: archivable
      ? {
          archivable: true,
          port: "local_offline",
          format: "jsonl",
          rationale: "test"
        }
      : { archivable: false, rationale: "test" },
    deletion: { mode: "hard_delete", rationale: "test" },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [{ columns: ["tenant_id", "day"], purpose: "test" }],
    batchLimit: 100,
    backupRestoreNotes: "test",
    executionMode: "generic"
  } as unknown as HighVolumeTableDescriptor;
}

const archivePort = {
  kind: "local_offline",
  write: async (input: { rows: readonly unknown[] }) => ({
    artifactLocation: "memory://t1276",
    checksumHex: "a".repeat(64),
    rowCount: input.rows.length,
    restoreProcedureRef: "test"
  }),
  verify: async () => true,
  read: async () => []
} as unknown as ArchivePort;

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
    // 3 old days, 2 recent days (cutoff = NOW - 30d = 2026-06-01).
    await admin.unsafe(
      `INSERT INTO ${TABLE} (tenant_id, day) VALUES
        ('${TENANT}', '2026-04-01'), ('${TENANT}', '2026-04-02'), ('${TENANT}', '2026-05-01'),
        ('${TENANT}', '2026-06-20'), ('${TENANT}', '2026-06-25')`
    );
  });

  test("dry run counts the eligible rows (non-archivable)", async () => {
    const plan = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      planLifecycleDryRun(tx, descriptor(false), TENANT, [], NOW)
    );
    if (plan instanceof Response) throw new Error("unexpected 503");
    expect(plan.eligibleCount).toBe(3);
  });

  test("archive pass, resumed pass, archivable dry run, then purge pass", async () => {
    const d = descriptor(true);
    const cutoff = new Date(NOW.getTime() - 30 * 86_400_000);
    const sql = getRuntimeSql();

    const first = await runGenericArchivePass(
      sql,
      d,
      TENANT,
      cutoff,
      archivePort,
      "c1"
    );
    expect(first.count).toBe(3);
    // Second pass resumes from the stored cursor (the `>= $3` comparison).
    await runGenericArchivePass(sql, d, TENANT, cutoff, archivePort, "c2");

    const plan = await withTenantOrThrow(sql, TENANT, (tx) =>
      planLifecycleDryRun(tx, d, TENANT, [], NOW)
    );
    if (plan instanceof Response) throw new Error("unexpected 503");
    expect(plan.eligibleCount).toBe(3);
    expect(plan.archivedCount).toBeGreaterThan(0);

    const purged = await runGenericPurgePass(sql, d, TENANT, cutoff, "c3");
    expect(purged.count).toBeGreaterThan(0);
    const left = (await getAdminSql().unsafe(
      `SELECT count(*)::int AS n FROM ${TABLE}`
    )) as { n: number }[];
    expect(left[0]!.n).toBeLessThan(5);
  });
});
