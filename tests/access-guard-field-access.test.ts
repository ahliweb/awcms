/**
 * Unit tests for `evaluateFieldAccessInTransaction` (FIX 5) — the secondary,
 * FIELD-level access gate that routes a de-anonymizing field decision (e.g.
 * `visitor_analytics.raw_detail.read`) through the ABAC evaluator instead of a
 * bare `grantedPermissionKeys.has(fieldKey)` membership check.
 *
 * The regression this closes: a membership check ignores the ABAC layer, so a
 * `deny` DSL policy on the field key would be silently bypassed
 * (deny-overrides-allow not honored for the field). These tests prove the deny
 * is now honored, while RBAC is still required (default deny).
 *
 * No real database: the only query the helper runs is the policy-cache SELECT,
 * driven here by a fake tagged-template `tx`. The policy cache is reset per test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { evaluateFieldAccessInTransaction } from "../src/modules/identity-access/application/access-guard";
import { resetPolicyCache } from "../src/modules/identity-access/application/policy-cache";
import type { TenantContext } from "../src/modules/identity-access/domain/access-control";

const RAW_DETAIL_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "raw_detail",
  action: "read" as const
};

const GRANTED = new Set(["visitor_analytics.raw_detail.read"]);
const NOW = new Date("2026-07-24T00:00:00Z");

function context(tenantId: string): TenantContext {
  return {
    tenantId,
    tenantUserId: "22222222-2222-4222-8222-222222222222",
    identityId: "33333333-3333-4333-8333-333333333333",
    roles: ["analyst"]
  };
}

/**
 * A fake tagged-template `tx` returning `rows` for the single policy-cache
 * SELECT `evaluateFieldAccessInTransaction` runs (via `loadActivePolicies`).
 */
function fakeTx(rows: unknown[]): Bun.SQL {
  return (() => Promise.resolve(rows)) as unknown as Bun.SQL;
}

/** A DSL-managed DENY policy scoped to `raw_detail.read`, always-true condition. */
function denyRawDetailRow() {
  return {
    policy_code: "deny-raw-detail",
    effect: "deny",
    module_key: "visitor_analytics",
    activity_code: "raw_detail",
    action: "read",
    resource_type: null,
    dsl_version: 1,
    priority: 100,
    conditions: { allOf: [] } // vacuously true → always matches
  };
}

describe("evaluateFieldAccessInTransaction — raw_detail routed through ABAC (FIX 5)", () => {
  beforeEach(() => resetPolicyCache());
  afterEach(() => resetPolicyCache());

  test("RBAC grant + NO policy → field allowed", async () => {
    const tenantId = "aaaaaaaa-0000-4000-8000-000000000001";
    const allowed = await evaluateFieldAccessInTransaction(
      fakeTx([]),
      tenantId,
      context(tenantId),
      GRANTED,
      RAW_DETAIL_GUARD,
      NOW
    );
    expect(allowed).toBe(true);
  });

  test("RBAC grant BUT a deny DSL policy on raw_detail.read → field DENIED (deny-overrides-allow)", async () => {
    const tenantId = "aaaaaaaa-0000-4000-8000-000000000002";
    // A bare `GRANTED.has("visitor_analytics.raw_detail.read")` membership check
    // would still be TRUE here — routing through ABAC is what honors the deny.
    const allowed = await evaluateFieldAccessInTransaction(
      fakeTx([denyRawDetailRow()]),
      tenantId,
      context(tenantId),
      GRANTED,
      RAW_DETAIL_GUARD,
      NOW
    );
    expect(allowed).toBe(false);
  });

  test("NO RBAC grant → field denied regardless (default deny)", async () => {
    const tenantId = "aaaaaaaa-0000-4000-8000-000000000003";
    const allowed = await evaluateFieldAccessInTransaction(
      fakeTx([]),
      tenantId,
      context(tenantId),
      new Set<string>(),
      RAW_DETAIL_GUARD,
      NOW
    );
    expect(allowed).toBe(false);
  });
});
