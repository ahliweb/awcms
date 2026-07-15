import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MAX_PASSES,
  iterateTenantsInBatches,
  runBoundedBatches,
  type TenantRow
} from "../src/lib/jobs/batching";

describe("runBoundedBatches (Issue #697)", () => {
  test("stops as soon as a pass reports count: 0 (backlog drained)", async () => {
    const remaining = [5, 5, 2, 0];
    let calls = 0;

    const outcome = await runBoundedBatches(async () => {
      const count = remaining[calls]!;
      calls += 1;
      return { count };
    });

    expect(calls).toBe(4);
    expect(outcome.totalCount).toBe(12);
    expect(outcome.hitPassLimit).toBe(false);
    expect(outcome.passes).toHaveLength(4);
  });

  test("a single pass returning 0 immediately makes exactly one call", async () => {
    let calls = 0;
    const outcome = await runBoundedBatches(async () => {
      calls += 1;
      return { count: 0 };
    });

    expect(calls).toBe(1);
    expect(outcome.totalCount).toBe(0);
    expect(outcome.hitPassLimit).toBe(false);
  });

  test("never exceeds maxPasses, even if every pass keeps reporting nonzero work (safety bound)", async () => {
    let calls = 0;
    const outcome = await runBoundedBatches(
      async () => {
        calls += 1;
        return { count: 100 };
      },
      { maxPasses: 5 }
    );

    expect(calls).toBe(5);
    expect(outcome.totalCount).toBe(500);
    expect(outcome.hitPassLimit).toBe(true);
  });

  test("defaults to DEFAULT_MAX_PASSES when no bound is given", async () => {
    let calls = 0;
    const outcome = await runBoundedBatches(async () => {
      calls += 1;
      return { count: 1 };
    });

    expect(calls).toBe(DEFAULT_MAX_PASSES);
    expect(outcome.hitPassLimit).toBe(true);
  });

  test("a query/pass never carries more items than the caller's own per-pass limit — this helper only sequences calls, the item cap is the caller's own batchLimit passed into runPass", async () => {
    const PER_PASS_LIMIT = 100;
    let remainingItems = 1045;
    let calls = 0;

    const outcome = await runBoundedBatches(
      async () => {
        calls += 1;
        const count = Math.min(PER_PASS_LIMIT, remainingItems);
        remainingItems -= count;
        return { count };
      },
      { maxPasses: 50 }
    );

    expect(outcome.totalCount).toBe(1045);
    // 10 full batches of 100 + 1 final batch of 45, plus one more pass that
    // reports count: 0 (the signal the loop stops on) — 12 calls total.
    expect(calls).toBe(12);
    for (const pass of outcome.passes) {
      expect(pass.count).toBeLessThanOrEqual(PER_PASS_LIMIT);
    }
    expect(outcome.hitPassLimit).toBe(false);
  });

  test("PR #713 fix (Option A, security-auditor High finding): stops BEFORE starting the next pass once `signal` is aborted, without starting a new pass — cooperative cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;

    const outcome = await runBoundedBatches(
      async () => {
        calls += 1;
        if (calls === 2) {
          // Abort fires WHILE this pass is already in flight — the CURRENT
          // pass still completes (documented, bounded window), but the loop
          // must not start pass 3.
          controller.abort();
        }
        return { count: 10 };
      },
      { signal: controller.signal, maxPasses: 50 }
    );

    expect(calls).toBe(2);
    expect(outcome.aborted).toBe(true);
    expect(outcome.hitPassLimit).toBe(false);
  });

  test("an already-aborted signal makes zero passes run at all", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    const outcome = await runBoundedBatches(
      async () => {
        calls += 1;
        return { count: 10 };
      },
      { signal: controller.signal }
    );

    expect(calls).toBe(0);
    expect(outcome.aborted).toBe(true);
    expect(outcome.totalCount).toBe(0);
  });

  test("a signal that never aborts behaves identically to not passing one at all", async () => {
    const controller = new AbortController();
    const outcome = await runBoundedBatches(async () => ({ count: 0 }), {
      signal: controller.signal
    });

    expect(outcome.aborted).toBe(false);
  });
});

describe("iterateTenantsInBatches (Issue #697)", () => {
  test("runs a bounded batch per tenant independently and sums totals across tenants", async () => {
    const tenants: TenantRow[] = [{ id: "tenant-a" }, { id: "tenant-b" }];
    const backlog: Record<string, number[]> = {
      "tenant-a": [3, 0],
      "tenant-b": [0]
    };
    const cursor: Record<string, number> = { "tenant-a": 0, "tenant-b": 0 };

    const result = await iterateTenantsInBatches(
      {} as unknown as Bun.SQL,
      async (tenantId) => {
        const count = backlog[tenantId]![cursor[tenantId]!]!;
        cursor[tenantId] = cursor[tenantId]! + 1;
        return { count };
      },
      { tenants }
    );

    expect(result.totalCount).toBe(3);
    expect(result.perTenant.get("tenant-a")!.totalCount).toBe(3);
    expect(result.perTenant.get("tenant-b")!.totalCount).toBe(0);
    expect(result.perTenant.get("tenant-a")!.passes).toHaveLength(2);
    expect(result.perTenant.get("tenant-b")!.passes).toHaveLength(1);
  });

  test("an empty tenant list does nothing and reports zero total", async () => {
    const result = await iterateTenantsInBatches(
      {} as unknown as Bun.SQL,
      async () => ({ count: 1 }),
      { tenants: [] }
    );

    expect(result.tenants).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.perTenant.size).toBe(0);
  });

  test("PR #713 fix (Option A): stops iterating further tenants once `signal` is aborted, mid-tenant-loop", async () => {
    const tenants: TenantRow[] = [
      { id: "tenant-a" },
      { id: "tenant-b" },
      { id: "tenant-c" }
    ];
    const controller = new AbortController();
    const processedTenants: string[] = [];

    const result = await iterateTenantsInBatches(
      {} as unknown as Bun.SQL,
      async (tenantId) => {
        processedTenants.push(tenantId);
        if (tenantId === "tenant-a") {
          controller.abort();
        }
        return { count: 0 };
      },
      { tenants, signal: controller.signal }
    );

    // tenant-a's own (already in-flight) pass completes; tenant-b/tenant-c
    // are never started once the abort is observed.
    expect(processedTenants).toEqual(["tenant-a"]);
    expect(result.aborted).toBe(true);
  });
});
