/**
 * Retention of `awcms_idempotency_keys` (Issue #1034, ADR-0145 amendment 1),
 * run as the real `awcms_worker` role through the generic data_lifecycle purge.
 *
 * What is asserted is the thing a grant list cannot prove: the job the crontab
 * schedules can actually SELECT and DELETE these rows under FORCE RLS, deletes
 * only rows past the 30-day default, leaves recent rows (and the 24 hour
 * `legacy:unscoped` window) alone, and never crosses tenants.
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
import { listModules } from "../../src/modules";
import { runDataLifecycleArchivePurge } from "../../src/modules/data-lifecycle/application/archive-purge-job";
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

    // PRE-EXISTING GAP, deliberately worked around here and NOT fixed by #1034:
    // `runDataLifecycleArchivePurge` records a dry-run snapshot for every
    // DELEGATED descriptor first, which needs SELECT as `awcms_worker`, and no
    // migration grants it on the inventory/procurement/hr/booking tables. In
    // production that makes the scheduled job abort per tenant before it
    // reaches any generic descriptor, this one included. The grants are added
    // to this throwaway database only, so the test can prove the part #1034
    // owns (the SELECT + DELETE grant and the purge semantics). Remove this
    // block when a migration closes the gap.
    if (workerRoleActivated) {
      const delegated = new Set<string>();

      for (const module of listModules()) {
        for (const descriptor of module.dataLifecycle ?? []) {
          if (descriptor.executionMode === "delegated") {
            delegated.add(descriptor.tableName);
          }
        }
      }

      for (const table of delegated) {
        await admin.unsafe(`GRANT SELECT ON ${table} TO awcms_worker`);
      }
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
