import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveBusinessScopeFacts } from "../src/modules/identity-access/application/business-scope-facts";
import type {
  BusinessScopeHierarchyPort,
  BusinessScopeResolution
} from "../src/modules/_shared/ports/business-scope-hierarchy-port";

// Issue #180 review F1 — base-side fail-closed bound + timeout on the untrusted
// DERIVED-app hierarchy adapter, verified in `resolveBusinessScopeFacts`. A
// fake `tx` returns one active (non-tenant) assignment so the port is called;
// the port itself is the thing under test.

const PAST = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-01T00:00:00.000Z");

/** A `Bun.SQL`-shaped tagged-template stub that returns fixed rows for the one SELECT `resolveBusinessScopeFacts` issues. */
function fakeTxReturning(rows: unknown[]): Bun.SQL {
  return (() => Promise.resolve(rows)) as unknown as Bun.SQL;
}

const oneActiveOfficeAssignment = fakeTxReturning([
  {
    id: "assignment-1",
    scope_type: "office",
    scope_id: "office-1",
    effective_from: PAST,
    effective_to: null,
    status: "active"
  }
]);

function portReturning(
  resolution: BusinessScopeResolution
): BusinessScopeHierarchyPort {
  return { resolveScope: async () => resolution };
}

const foreverPort: BusinessScopeHierarchyPort = {
  // Awaits I/O that never settles — the wall-clock timeout must fail this
  // closed rather than hanging the evaluator.
  resolveScope: () => new Promise<BusinessScopeResolution>(() => {})
};

describe("resolveBusinessScopeFacts — F1 fail-closed guard on the hierarchy port", () => {
  beforeEach(() => {
    process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_TIMEOUT_MS = "50";
    process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_MAX_RELATED_SCOPES = "10";
  });

  afterEach(() => {
    delete process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_TIMEOUT_MS;
    delete process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_MAX_RELATED_SCOPES;
  });

  test("control: a fast, small resolution flows through as resolved with its lists", async () => {
    const port = portReturning({
      resolved: true,
      ancestorScopes: [{ scopeType: "region", scopeId: "r-1" }],
      descendantScopes: [{ scopeType: "office", scopeId: "child-1" }]
    });
    const facts = await resolveBusinessScopeFacts(
      oneActiveOfficeAssignment,
      "tenant-1",
      "user-1",
      NOW,
      port
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.resolved).toBe(true);
    expect(facts[0]!.ancestorScopes).toHaveLength(1);
    expect(facts[0]!.descendantScopes).toHaveLength(1);
  });

  test("TIMEOUT: an adapter that awaits forever is treated as resolved:false (deny), not coverage", async () => {
    const facts = await resolveBusinessScopeFacts(
      oneActiveOfficeAssignment,
      "tenant-1",
      "user-1",
      NOW,
      foreverPort
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.resolved).toBe(false);
    expect(facts[0]!.ancestorScopes).toEqual([]);
    expect(facts[0]!.descendantScopes).toEqual([]);
  });

  test("CAP: an adapter returning more than the combined-length cap is treated as resolved:false (deny)", async () => {
    const overCap = portReturning({
      resolved: true,
      ancestorScopes: [],
      // cap is 10 in beforeEach; return 25 descendants.
      descendantScopes: Array.from({ length: 25 }, (_unused, i) => ({
        scopeType: "office",
        scopeId: `d-${i}`
      }))
    });
    const facts = await resolveBusinessScopeFacts(
      oneActiveOfficeAssignment,
      "tenant-1",
      "user-1",
      NOW,
      overCap
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.resolved).toBe(false);
    expect(facts[0]!.descendantScopes).toEqual([]);
  });

  test("just UNDER the cap still resolves (proves the cap is a boundary, not a blanket deny)", async () => {
    const underCap = portReturning({
      resolved: true,
      ancestorScopes: [],
      descendantScopes: Array.from({ length: 10 }, (_unused, i) => ({
        scopeType: "office",
        scopeId: `d-${i}`
      }))
    });
    const facts = await resolveBusinessScopeFacts(
      oneActiveOfficeAssignment,
      "tenant-1",
      "user-1",
      NOW,
      underCap
    );
    expect(facts[0]!.resolved).toBe(true);
    expect(facts[0]!.descendantScopes).toHaveLength(10);
  });
});
