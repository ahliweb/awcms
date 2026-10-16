/**
 * g11 regression: the subscription ladder's compare-and-swap UPDATE must gate
 * the audit event and the counters. A lost race (0 rows) applies nothing, so
 * it must audit nothing and count nothing.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { resetDatabaseCircuitBreakerForTests } from "../src/lib/database/circuit-breaker";
import { resetWorkClassGatesForTests } from "../src/lib/database/work-class";
import { runSubscriptionLifecycle } from "../src/modules/identity-access/application/subscription-lifecycle-job";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SUB_ID = "22222222-2222-2222-2222-222222222222";

function fakeSql(updateRows: unknown[]): {
  sql: Bun.SQL;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    statements.push(text);
    if (text.includes("FROM awcms_tenants")) return [{ id: TENANT_ID }];
    if (text.includes("FROM awcms_tenant_subscriptions")) {
      return [
        {
          id: SUB_ID,
          status: "active",
          current_period_end: new Date("2000-01-01T00:00:00Z"),
          trial_ends_at: null,
          grace_ends_at: null
        }
      ];
    }
    if (text.includes("UPDATE awcms_tenant_subscriptions")) return updateRows;
    return [];
  };
  const tx = Object.assign(tag, { unsafe: async () => [] });
  const sql = Object.assign(tag, {
    begin: async (cb: (t: unknown) => Promise<unknown>) => cb(tx)
  });
  return { sql: sql as unknown as Bun.SQL, statements };
}

const ctx = {
  runId: "r",
  correlationId: "c",
  dryRun: false,
  signal: new AbortController().signal
};

describe("subscription ladder CAS row count", () => {
  beforeEach(() => {
    resetDatabaseCircuitBreakerForTests();
    resetWorkClassGatesForTests();
  });

  test("0 rows updated: no audit, no counters", async () => {
    const { sql, statements } = fakeSql([]);
    const result = await runSubscriptionLifecycle(sql, ctx, {
      now: new Date("2030-01-01T00:00:00Z")
    });
    expect(
      statements.some((s) => s.includes("UPDATE awcms_tenant_subscriptions"))
    ).toBe(true);
    expect(statements.some((s) => s.includes("RETURNING id"))).toBe(true);
    expect(statements.some((s) => /awcms_audit/i.test(s))).toBe(false);
    expect(result.transitionsApplied).toBe(0);
    expect(result.entitlementLosses).toBe(0);
  });

  test("1 row updated: audited and counted", async () => {
    const { sql, statements } = fakeSql([{ id: SUB_ID }]);
    const result = await runSubscriptionLifecycle(sql, ctx, {
      now: new Date("2030-01-01T00:00:00Z")
    });
    expect(statements.some((s) => /awcms_audit/i.test(s))).toBe(true);
    expect(result.transitionsApplied).toBe(1);
  });
});
