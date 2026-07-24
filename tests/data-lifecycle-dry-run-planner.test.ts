/**
 * Unit test for `planLifecycleDryRun` (`application/dry-run-planner.ts`) using a
 * fake `tx.unsafe` — proves the "legal hold overrides retention and cannot be
 * bypassed" branch runs FIRST and unconditionally, and that a non-archivable
 * descriptor reports every eligible row as immediately purgeable when NOT held.
 * The archivable/manifest path needs a real DB and is covered by the integration
 * test.
 */
import { describe, expect, test } from "bun:test";

import type { HighVolumeTableDescriptor } from "../src/modules/_shared/module-contract";
import { planLifecycleDryRun } from "../src/modules/data-lifecycle/application/dry-run-planner";
import type { LegalHoldRecord } from "../src/modules/data-lifecycle/domain/legal-hold";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-07-01T00:00:00.000Z");

/**
 * A `Bun.SQL`-shaped stub whose only used method is `.unsafe(sql, params)`,
 * returning a fixed eligible count. Records how many times `.unsafe` is called so
 * we can prove the held branch short-circuits before any archive query.
 */
function fakeSql(eligibleCount: number): {
  sql: Bun.SQL;
  unsafeCalls: () => number;
} {
  let calls = 0;
  const sql = {
    unsafe: (_query: string, _params: unknown[]) => {
      calls += 1;
      return Promise.resolve([{ count: eligibleCount }]);
    }
  } as unknown as Bun.SQL;
  return { sql, unsafeCalls: () => calls };
}

const descriptor: HighVolumeTableDescriptor = {
  key: "logging.audit_events",
  tableName: "awcms_audit_events",
  ownerModuleKey: "logging",
  scope: "tenant",
  cursorColumn: "created_at",
  retentionClass: "audit_security",
  retentionMinDays: 365,
  retentionMaxDays: 1825,
  defaultRetentionDays: 730,
  partition: { eligible: false, rationale: "x" },
  archive: { archivable: false, rationale: "no archive step" },
  deletion: { mode: "hard_delete", rationale: "x" },
  legalHold: { applicable: true, precedence: "overrides_retention" },
  requiredIndexes: [{ columns: ["tenant_id", "created_at"], purpose: "x" }],
  batchLimit: 5000,
  backupRestoreNotes: "x",
  executionMode: "delegated",
  existingAdopter: { purgeFunctionRef: "x", description: "x" }
};

function activeHold(descriptorKey: string | null): LegalHoldRecord {
  return {
    id: crypto.randomUUID(),
    tenantId: TENANT,
    descriptorKey,
    status: "active"
  };
}

describe("planLifecycleDryRun", () => {
  test("not held, non-archivable: every eligible row is immediately purgeable", async () => {
    const { sql, unsafeCalls } = fakeSql(42);
    const plan = await planLifecycleDryRun(sql, descriptor, TENANT, [], NOW);
    expect(plan.eligibleCount).toBe(42);
    expect(plan.heldCount).toBe(0);
    expect(plan.purgeableCount).toBe(42);
    expect(plan.blockedCount).toBe(0);
    expect(plan.matchedHoldIds).toEqual([]);
    expect(unsafeCalls()).toBe(1); // only the eligible-count query
  });

  test("a matching hold reports everything as held, nothing purgeable — and no override can bypass it", async () => {
    const { sql, unsafeCalls } = fakeSql(42);
    const hold = activeHold(descriptor.key);
    // Even with an aggressive retentionDaysOverride, the hold check runs first.
    const plan = await planLifecycleDryRun(
      sql,
      descriptor,
      TENANT,
      [hold],
      NOW,
      1
    );
    expect(plan.heldCount).toBe(42);
    expect(plan.purgeableCount).toBe(0);
    expect(plan.blockedCount).toBe(0);
    expect(plan.matchedHoldIds).toEqual([hold.id]);
    // Only the eligible-count query ran — the held branch short-circuited before
    // any archive/manifest lookup.
    expect(unsafeCalls()).toBe(1);
  });

  test("a tenant-wide (null) hold also blocks this descriptor", async () => {
    const { sql } = fakeSql(10);
    const plan = await planLifecycleDryRun(
      sql,
      descriptor,
      TENANT,
      [activeHold(null)],
      NOW
    );
    expect(plan.heldCount).toBe(10);
    expect(plan.purgeableCount).toBe(0);
  });

  test("throws for a non-tenant-scoped descriptor (global path not implemented)", async () => {
    const { sql } = fakeSql(0);
    const globalDescriptor = { ...descriptor, scope: "global" as const };
    await expect(
      planLifecycleDryRun(sql, globalDescriptor, TENANT, [], NOW)
    ).rejects.toThrow(/scope: "tenant"/);
  });
});
