/**
 * Retention of `awcms_idempotency_keys` (Issue #1034, ADR-0145 amendment 1),
 * run as the real `awcms_worker` role through the generic data_lifecycle purge.
 *
 * What is asserted is the thing a grant list cannot prove: the job the crontab
 * schedules can actually SELECT and DELETE these rows under FORCE RLS, deletes
 * only rows past the 30-day default, leaves recent rows (and the 24 hour
 * `legacy:unscoped` window) alone, and never crosses tenants.
 *
 * No extra grants are made (Issue #1040): the worker cannot SELECT the delegated
 * tables (inventory, procurement, HR, booking) and must not be able to, so their
 * dry-run snapshots fail, are recorded as `failed` runs, and the generic purge
 * still runs.
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

    // The delegated snapshots failed with 42501 on baseline tables: they are
    // EXPECTED, counted as known-unreadable, and do not make the job partial.
    expect(result.descriptorFailures).toEqual([]);
    expect(result.knownUnreadableDelegated).toContain(
      `${TENANT_A}:inventory.movements`
    );
    expect(result.knownUnreadableDelegated.length).toBe(
      KNOWN_UNREADABLE_DELEGATED_TABLES.length * 2
    );
    expect(summarizeArchivePurgeOutcome(result).status).toBe("success");
    // Each is still recorded, as a failed dry-run with errorCount 1.
    const failed = (await getAdminSql()`
      SELECT descriptor_key, run_type, error_count
      FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND status = 'failed'
    `) as { descriptor_key: string; run_type: string; error_count: number }[];
    expect(failed.length).toBe(KNOWN_UNREADABLE_DELEGATED_TABLES.length);
    expect(failed.every((r) => r.run_type === "dry_run")).toBe(true);
    expect(failed.every((r) => r.error_count === 1)).toBe(true);
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
});
