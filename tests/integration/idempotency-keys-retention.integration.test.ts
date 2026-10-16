/**
 * Retention of `awcms_idempotency_keys` (Issue #1034, ADR-0145 amendment 1),
 * run as the real `awcms_worker` role through the generic data_lifecycle purge.
 *
 * What is asserted is the thing a grant list cannot prove: the job the crontab
 * schedules can actually SELECT and DELETE these rows under FORCE RLS, deletes
 * only rows past the 30-day default, leaves recent rows (and the 24 hour
 * `legacy:unscoped` window) alone, and never crosses tenants.
 *
 * No extra grants are made: the worker cannot SELECT the delegated tables
 * (inventory, procurement, HR, booking) and must not be able to. Since #1042
 * their dry-run snapshots read ONE integer through the count-only SECURITY
 * DEFINER functions of sql/303, so they are recorded as `completed` runs with
 * counts, and the generic purge still runs.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  runDataLifecycleArchivePurge,
  summarizeArchivePurgeOutcome
} from "../../src/modules/data-lifecycle/application/archive-purge-job";
import { KNOWN_UNREADABLE_DELEGATED_TABLES } from "../../src/modules/data-lifecycle/domain/known-unreadable-delegated";
import type { ArchivePort } from "../../src/modules/data-lifecycle/domain/archive-port";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "f1034000-0000-4000-8000-0000000000a1";
const TENANT_B = "f1034000-0000-4000-8000-0000000000a2";

/** The descriptor is not archivable, so the engine must never ask to archive. */
const noArchive = {
  kind: "local_offline",
  write: async () => {
    throw new Error("idempotency rows must never be archived");
  }
} as unknown as ArchivePort;

async function seed(
  tenant: string,
  key: string,
  actor: string,
  ageDays: number
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_idempotency_keys
      (tenant_id, request_scope, actor_key, idempotency_key, request_hash,
       response_status, response_body, created_at)
    VALUES
      (${tenant}, 'retention_test', ${actor}, ${key}, 'h', 201,
       '{"echo":"personal"}'::jsonb,
       now() - make_interval(days => ${ageDays}))
  `;
}

async function keysOf(tenant: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT idempotency_key FROM awcms_idempotency_keys
    WHERE tenant_id = ${tenant} ORDER BY idempotency_key
  `) as { idempotency_key: string }[];

  return rows.map((row) => row.idempotency_key);
}

suite("idempotency keys retention (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    const admin = getAdminSql();

    for (const [id, code] of [
      [TENANT_A, "idem-ret-a"],
      [TENANT_B, "idem-ret-b"]
    ] as const) {
      await admin`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${id}, ${code}, ${code})
      `;
    }
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  test("the worker purge deletes rows past 30 days and nothing else, per tenant", async () => {
    if (!workerRoleActivated) {
      console.warn("awcms_worker not provisioned - skipping");
      return;
    }

    await getAdminSql()`
      INSERT INTO awcms_inventory_settings (tenant_id, created_at)
      VALUES (${TENANT_A}, now() - interval '7300 days')
    `;
    await seed(TENANT_A, "old-user", "user:u-1", 45);
    await seed(TENANT_A, "old-legacy", "legacy:unscoped", 45);
    await seed(TENANT_A, "recent-user", "user:u-1", 5);
    await seed(TENANT_A, "recent-legacy", "legacy:unscoped", 0);
    await seed(TENANT_B, "old-b", "anonymous", 31);
    await seed(TENANT_B, "recent-b", "machine:m-1", 29);

    const result = await runDataLifecycleArchivePurge(
      getWorkerRoleSql(),
      { dryRun: false, correlationId: "idem-retention-test" },
      {
        archivePort: noArchive,
        tenants: [{ id: TENANT_A }, { id: TENANT_B }] as never
      }
    );

    expect(result.totalPurged).toBeGreaterThanOrEqual(3);

    // The delegated snapshots go through the count-only functions (Issue
    // #1042, sql/303): nothing fails, nothing is skipped as known-unreadable,
    // and each delegated descriptor is recorded as a COMPLETED dry run.
    expect(result.descriptorFailures).toEqual([]);
    expect(result.knownUnreadableDelegated).toEqual([]);
    expect(KNOWN_UNREADABLE_DELEGATED_TABLES).toEqual([]);
    expect(summarizeArchivePurgeOutcome(result).status).toBe("success");
    const failed = (await getAdminSql()`
      SELECT 1 FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND status = 'failed'
    `) as unknown[];
    expect(failed.length).toBe(0);
    const snapshots = (await getAdminSql()`
      SELECT descriptor_key, eligible_count, purgeable_count
      FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND status = 'completed'
        AND run_type = 'dry_run'
        AND descriptor_key IN ('inventory.movements', 'inventory.settings',
          'procurement.documents', 'hr_workforce.shift_assignments',
          'booking.reservations')
      ORDER BY descriptor_key
    `) as {
      descriptor_key: string;
      eligible_count: number;
      purgeable_count: number;
    }[];
    expect(snapshots.map((r) => r.descriptor_key)).toEqual([
      "booking.reservations",
      "hr_workforce.shift_assignments",
      "inventory.movements",
      "inventory.settings",
      "procurement.documents"
    ]);
    // The seeded settings row is 20 years old: counted, never read.
    const settings = snapshots.find(
      (r) => r.descriptor_key === "inventory.settings"
    );
    expect(settings?.eligible_count).toBe(1);
    expect(settings?.purgeable_count).toBe(1);
    expect(
      snapshots.find((r) => r.descriptor_key === "inventory.movements")
        ?.eligible_count
    ).toBe(0);

    // The generic idempotency purge ran and is recorded as completed.
    const completed = (await getAdminSql()`
      SELECT 1 FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND status = 'completed'
        AND descriptor_key = 'domain_event_runtime.idempotency_keys'
    `) as unknown[];
    expect(completed.length).toBe(1);
    expect(await keysOf(TENANT_A)).toEqual(["recent-legacy", "recent-user"]);
    expect(await keysOf(TENANT_B)).toEqual(["recent-b"]);
  });

  test("a dry run deletes nothing", async () => {
    if (!workerRoleActivated) return;

    await seed(TENANT_A, "old-dry", "user:u-2", 60);

    await runDataLifecycleArchivePurge(
      getWorkerRoleSql(),
      { dryRun: true, correlationId: "idem-retention-dry" },
      { archivePort: noArchive, tenants: [{ id: TENANT_A }] as never }
    );

    expect(await keysOf(TENANT_A)).toContain("old-dry");
  });

  test("the count functions return one integer and open nothing else", async () => {
    if (!workerRoleActivated) return;

    await getAdminSql()`
      INSERT INTO awcms_inventory_settings (tenant_id, created_at)
      VALUES (${TENANT_A}, now() - interval '7300 days')
      ON CONFLICT (tenant_id) DO NOTHING
    `;

    const worker = getWorkerRoleSql();
    const cutoff = new Date();

    // No row-level SELECT was granted: the table itself stays closed.
    await expect(
      (async () =>
        await worker`SELECT count(*) FROM awcms_inventory_settings`)()
    ).rejects.toThrow(/permission denied/i);

    const count = async (tenant: string, table: string, asTenant = tenant) =>
      worker.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${asTenant}, true)`;
        const rows = (await tx`
          SELECT awcms_inventory_lifecycle_eligible_count(
            ${table}, ${tenant}::uuid, ${cutoff}::timestamptz) AS n
        `) as { n: number }[];
        return rows[0]!.n;
      });

    expect(await count(TENANT_A, "awcms_inventory_settings")).toBe(1);
    // Naming another tenant's id inside this tenant's context sees nothing.
    expect(await count(TENANT_A, "awcms_inventory_settings", TENANT_B)).toBe(0);
    expect(await count(TENANT_B, "awcms_inventory_settings")).toBe(0);

    // A table that is not one of the module's descriptors is refused.
    await expect(count(TENANT_A, "awcms_identities")).rejects.toThrow(
      /not one of this module/i
    );
    await expect(count(TENANT_A, "awcms_hr_payroll_runs")).rejects.toThrow(
      /not one of this module/i
    );
  });
});
