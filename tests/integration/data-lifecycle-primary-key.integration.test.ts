/**
 * The generic purge deletes by the table's real primary key (no assumed `id`
 * column), supports composite keys, and refuses a table without one. Also pins
 * that EVERY generic + hard_delete descriptor in the real registry points at a
 * table that has a primary key in the migrated schema. Skipped without a DB.
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
  createRuntimePool,
  getAdminSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import type { HighVolumeTableDescriptor } from "../../src/modules/_shared/module-contract";
import {
  clearPrimaryKeyColumnsCache,
  resolvePrimaryKeyColumns,
  runGenericPurgePass
} from "../../src/modules/data-lifecycle/application/archive-purge-job";
import { collectHighVolumeTableDescriptors } from "../../src/modules/data-lifecycle/domain/lifecycle-registry";
import { listModules } from "../../src/modules";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-07-01T10:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - 30 * 86_400_000);
const TABLES = [
  "awcms_t_pk_nonid",
  "awcms_t_pk_composite",
  "awcms_t_pk_none",
  "awcms_t_pk_include",
  "awcms_t_pk_secondary"
];

function descriptor(
  table: string,
  batchLimit = 100
): HighVolumeTableDescriptor {
  return {
    key: `tpk.${table}`,
    tableName: table,
    ownerModuleKey: "logging",
    scope: "tenant",
    cursorColumn: "created_at",
    cursorColumnType: "timestamptz",
    retentionClass: "operational",
    retentionMinDays: 1,
    retentionMaxDays: 3650,
    defaultRetentionDays: 30,
    partition: { eligible: false, rationale: "test" },
    archive: { archivable: false, rationale: "test" },
    deletion: { mode: "hard_delete", rationale: "test" },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [
      { columns: ["tenant_id", "created_at"], purpose: "test" }
    ],
    batchLimit,
    backupRestoreNotes: "test",
    executionMode: "generic"
  } as unknown as HighVolumeTableDescriptor;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("data_lifecycle purge by primary key", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    for (const t of TABLES) {
      await getAdminSql().unsafe(`DROP TABLE IF EXISTS ${t}`);
    }
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    clearPrimaryKeyColumnsCache();
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'tenant-a', 'Tenant A', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
    for (const t of TABLES) {
      await admin.unsafe(`DROP TABLE IF EXISTS ${t}`);
    }
    await admin.unsafe(
      `CREATE TABLE awcms_t_pk_nonid (event_uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_at timestamptz NOT NULL)`
    );
    await admin.unsafe(
      `CREATE TABLE awcms_t_pk_composite (tenant_id uuid NOT NULL, seq int NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (tenant_id, seq))`
    );
    await admin.unsafe(
      `CREATE TABLE awcms_t_pk_none (tenant_id uuid NOT NULL, created_at timestamptz NOT NULL, tag text)`
    );
    await admin.unsafe(
      `CREATE INDEX awcms_t_pk_none_tag ON awcms_t_pk_none (tag)`
    );
    await admin.unsafe(
      `CREATE UNIQUE INDEX awcms_t_pk_none_uq ON awcms_t_pk_none (created_at)`
    );
    await admin.unsafe(
      `CREATE TABLE awcms_t_pk_include (id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_at timestamptz NOT NULL, note text, PRIMARY KEY (id) INCLUDE (note))`
    );
    await admin.unsafe(
      `CREATE TABLE awcms_t_pk_secondary (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_at timestamptz NOT NULL, tag text)`
    );
    await admin.unsafe(
      `CREATE INDEX awcms_t_pk_secondary_tag ON awcms_t_pk_secondary (tag, created_at)`
    );
    await admin.unsafe(
      `CREATE UNIQUE INDEX awcms_t_pk_secondary_uq ON awcms_t_pk_secondary (created_at)`
    );
    if (appRoleActivated) {
      for (const t of TABLES) {
        await admin.unsafe(`GRANT SELECT, DELETE ON ${t} TO awcms_app`);
      }
    }
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_nonid (tenant_id, created_at)
       SELECT '${TENANT}', '2026-01-01'::timestamptz + (g || ' hours')::interval FROM generate_series(1, 5) g`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_nonid (tenant_id, created_at) VALUES ('${TENANT}', '2026-06-30')`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_composite (tenant_id, seq, created_at)
       SELECT '${TENANT}', g, '2026-01-01'::timestamptz + (g || ' hours')::interval FROM generate_series(1, 5) g`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_composite VALUES ('${TENANT}', 99, '2026-06-30')`
    );
    // Old + fresh rows sharing one tag: a delete addressed by anything but a
    // real primary key would take the fresh row with it.
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_none VALUES ('${TENANT}', '2026-01-01', 'x'), ('${TENANT}', '2026-01-02', 'x'), ('${TENANT}', '2026-06-30', 'x')`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_include (tenant_id, created_at, note)
       SELECT '${TENANT}', '2026-01-01'::timestamptz + (g || ' hours')::interval, NULL FROM generate_series(1, 3) g`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_include (tenant_id, created_at, note)
       SELECT '${TENANT}', '2026-02-01'::timestamptz + (g || ' hours')::interval, 'n' FROM generate_series(1, 3) g`
    );
    await admin.unsafe(
      `INSERT INTO awcms_t_pk_include (tenant_id, created_at, note) VALUES ('${TENANT}', '2026-06-30', NULL)`
    );
  });

  async function count(table: string): Promise<number> {
    const [row] = (await getAdminSql().unsafe(
      `SELECT count(*)::int AS n FROM ${table}`
    )) as { n: number }[];

    return row!.n;
  }

  test("purges a table whose key is not named id, across batches", async () => {
    const pool = createRuntimePool(1);
    try {
      let total = 0;
      for (let i = 0; i < 6; i += 1) {
        const r = await runGenericPurgePass(
          pool,
          descriptor("awcms_t_pk_nonid", 2),
          TENANT,
          CUTOFF,
          `c${i}`
        );
        total += r.count;
        if (r.count === 0) break;
      }
      expect(total).toBe(5);
      expect(await count("awcms_t_pk_nonid")).toBe(1);
    } finally {
      await pool.close();
    }
  });

  test("purges a table with a composite primary key", async () => {
    const pool = createRuntimePool(1);
    try {
      const d = descriptor("awcms_t_pk_composite", 3);
      expect(
        (await runGenericPurgePass(pool, d, TENANT, CUTOFF, "c")).count
      ).toBe(3);
      expect(
        (await runGenericPurgePass(pool, d, TENANT, CUTOFF, "c2")).count
      ).toBe(2);
      expect(await count("awcms_t_pk_composite")).toBe(1);
    } finally {
      await pool.close();
    }
  });

  test("refuses a table without a primary key and deletes nothing", async () => {
    const pool = createRuntimePool(1);
    try {
      await expect(
        runGenericPurgePass(
          pool,
          descriptor("awcms_t_pk_none"),
          TENANT,
          CUTOFF,
          "c"
        )
      ).rejects.toThrow(/no primary key/);
      expect(await count("awcms_t_pk_none")).toBe(3);
    } finally {
      await pool.close();
    }
  });

  test("a table without a key is still refused after another table's key was resolved (cache is per table)", async () => {
    const pool = createRuntimePool(1);
    try {
      expect(
        (
          await runGenericPurgePass(
            pool,
            descriptor("awcms_t_pk_nonid", 100),
            TENANT,
            CUTOFF,
            "c"
          )
        ).count
      ).toBe(5);
      await expect(
        runGenericPurgePass(
          pool,
          descriptor("awcms_t_pk_none"),
          TENANT,
          CUTOFF,
          "c2"
        )
      ).rejects.toThrow(/no primary key/);
      expect(await count("awcms_t_pk_none")).toBe(3);
    } finally {
      await pool.close();
    }
  });

  test("resolves only KEY columns: a PK with INCLUDE columns still purges rows whose INCLUDE column is NULL", async () => {
    const pool = createRuntimePool(1);
    try {
      expect(
        await resolvePrimaryKeyColumns(pool, "awcms_t_pk_include")
      ).toEqual(["id"]);
      let total = 0;
      for (let i = 0; i < 6; i += 1) {
        const r = await runGenericPurgePass(
          pool,
          descriptor("awcms_t_pk_include", 2),
          TENANT,
          CUTOFF,
          `c${i}`
        );
        total += r.count;
        if (r.count === 0) break;
      }
      expect(total).toBe(6);
      expect(await count("awcms_t_pk_include")).toBe(1);
    } finally {
      await pool.close();
    }
  });

  test("secondary and non-primary unique indexes never become the key", async () => {
    const pool = createRuntimePool(1);
    try {
      expect(
        await resolvePrimaryKeyColumns(pool, "awcms_t_pk_secondary")
      ).toEqual(["id"]);
    } finally {
      await pool.close();
    }
  });

  test("every generic hard_delete descriptor in the registry has a primary key", async () => {
    const pool = createRuntimePool(1);
    try {
      const generic = collectHighVolumeTableDescriptors(listModules()).filter(
        (d) =>
          d.scope === "tenant" &&
          d.executionMode === "generic" &&
          d.deletion.mode === "hard_delete"
      );
      expect(generic.length).toBeGreaterThan(0);
      for (const d of generic) {
        clearPrimaryKeyColumnsCache();
        const cols = await resolvePrimaryKeyColumns(pool, d.tableName);
        expect(cols.length, d.key).toBeGreaterThan(0);
        const [keyRow] = (await pool.unsafe(
          `SELECT i.indnkeyatts::int AS n FROM pg_index i WHERE i.indrelid = to_regclass($1) AND i.indisprimary`,
          [d.tableName]
        )) as { n: number }[];

        expect(cols.length, `${d.key} resolves key columns only`).toBe(
          keyRow!.n
        );
      }
    } finally {
      await pool.close();
    }
  });
});
