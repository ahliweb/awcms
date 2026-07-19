import { describe, expect, test } from "bun:test";

import {
  createDummyBusinessScopeHierarchyResolver,
  DUMMY_HIERARCHY_MAX_DEPTH,
  type DummyScopeNode
} from "./fixtures/derived-application-example/modules/example-crm/business-scope-hierarchy-adapter";
import { defaultBusinessScopeHierarchyPortAdapter } from "../src/modules/identity-access/application/business-scope-hierarchy-port-adapter";

// The dummy adapter never touches the DB — pass a stand-in for `tx`.
const NO_TX = null as unknown as Bun.SQL;
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

// A small heterogeneous tree for tenant A:
//   legal_entity:le-1
//     └─ region:r-1
//          ├─ office:o-1
//          └─ office:o-2
// plus an isolated office in tenant B (o-b).
const NODES: DummyScopeNode[] = [
  {
    tenantId: TENANT_A,
    scopeType: "legal_entity",
    scopeId: "le-1",
    parent: null
  },
  {
    tenantId: TENANT_A,
    scopeType: "region",
    scopeId: "r-1",
    parent: { scopeType: "legal_entity", scopeId: "le-1" }
  },
  {
    tenantId: TENANT_A,
    scopeType: "office",
    scopeId: "o-1",
    parent: { scopeType: "region", scopeId: "r-1" }
  },
  {
    tenantId: TENANT_A,
    scopeType: "office",
    scopeId: "o-2",
    parent: { scopeType: "region", scopeId: "r-1" }
  },
  { tenantId: TENANT_B, scopeType: "office", scopeId: "o-b", parent: null }
];

describe("dummy BusinessScopeHierarchyPort resolver", () => {
  const resolver = createDummyBusinessScopeHierarchyResolver(NODES);

  test("resolves an exact leaf with its full (heterogeneous) ancestor chain", async () => {
    const res = await resolver.resolveScope(NO_TX, TENANT_A, "office", "o-1");
    expect(res.resolved).toBe(true);
    // immediate parent first: region -> legal_entity (crosses scope types).
    expect(res.ancestorScopes).toEqual([
      { scopeType: "region", scopeId: "r-1" },
      { scopeType: "legal_entity", scopeId: "le-1" }
    ]);
    expect(res.descendantScopes).toEqual([]);
  });

  test("resolves a mid node with both ancestors and descendants", async () => {
    const res = await resolver.resolveScope(NO_TX, TENANT_A, "region", "r-1");
    expect(res.resolved).toBe(true);
    expect(res.ancestorScopes).toEqual([
      { scopeType: "legal_entity", scopeId: "le-1" }
    ]);
    expect(new Set(res.descendantScopes.map((s) => s.scopeId))).toEqual(
      new Set(["o-1", "o-2"])
    );
  });

  test("resolves the root with all descendants and no ancestors", async () => {
    const res = await resolver.resolveScope(
      NO_TX,
      TENANT_A,
      "legal_entity",
      "le-1"
    );
    expect(res.resolved).toBe(true);
    expect(res.ancestorScopes).toEqual([]);
    expect(new Set(res.descendantScopes.map((s) => s.scopeId))).toEqual(
      new Set(["r-1", "o-1", "o-2"])
    );
  });

  test("unknown scope id -> resolved:false", async () => {
    const res = await resolver.resolveScope(NO_TX, TENANT_A, "office", "nope");
    expect(res.resolved).toBe(false);
    expect(res.ancestorScopes).toEqual([]);
    expect(res.descendantScopes).toEqual([]);
  });

  test("unknown scope TYPE -> resolved:false", async () => {
    const res = await resolver.resolveScope(
      NO_TX,
      TENANT_A,
      "warehouse",
      "o-1"
    );
    expect(res.resolved).toBe(false);
  });

  test("cross-tenant: tenant A cannot resolve tenant B's scope", async () => {
    const res = await resolver.resolveScope(NO_TX, TENANT_A, "office", "o-b");
    expect(res.resolved).toBe(false);
  });

  test("cross-tenant: tenant B sees only its own node, with no leakage of A's tree", async () => {
    const res = await resolver.resolveScope(NO_TX, TENANT_B, "office", "o-b");
    expect(res.resolved).toBe(true);
    expect(res.ancestorScopes).toEqual([]);
    expect(res.descendantScopes).toEqual([]);
  });

  test("cycle in the ancestor chain terminates (bounded, no infinite loop)", async () => {
    // a -> b -> a (two-node cycle)
    const cyclic: DummyScopeNode[] = [
      {
        tenantId: TENANT_A,
        scopeType: "unit",
        scopeId: "a",
        parent: { scopeType: "unit", scopeId: "b" }
      },
      {
        tenantId: TENANT_A,
        scopeType: "unit",
        scopeId: "b",
        parent: { scopeType: "unit", scopeId: "a" }
      }
    ];
    const cyclicResolver = createDummyBusinessScopeHierarchyResolver(cyclic);
    const res = await cyclicResolver.resolveScope(NO_TX, TENANT_A, "unit", "a");
    expect(res.resolved).toBe(true);
    // The walk visits b, then would revisit a -> stops. Bounded, no hang.
    expect(res.ancestorScopes.length).toBeLessThanOrEqual(
      DUMMY_HIERARCHY_MAX_DEPTH
    );
    expect(res.ancestorScopes.map((s) => s.scopeId)).toEqual(["b"]);
  });

  test("a deep chain is bounded by DUMMY_HIERARCHY_MAX_DEPTH", async () => {
    const deep: DummyScopeNode[] = [];
    const total = DUMMY_HIERARCHY_MAX_DEPTH + 20;
    for (let i = 0; i < total; i += 1) {
      deep.push({
        tenantId: TENANT_A,
        scopeType: "unit",
        scopeId: `n-${i}`,
        parent: i === 0 ? null : { scopeType: "unit", scopeId: `n-${i - 1}` }
      });
    }
    const deepResolver = createDummyBusinessScopeHierarchyResolver(deep);
    const res = await deepResolver.resolveScope(
      NO_TX,
      TENANT_A,
      "unit",
      `n-${total - 1}`
    );
    expect(res.resolved).toBe(true);
    expect(res.ancestorScopes.length).toBeLessThanOrEqual(
      DUMMY_HIERARCHY_MAX_DEPTH
    );
  });
});

describe("base default (no-op) BusinessScopeHierarchyPort adapter", () => {
  test("resolves EVERY scope type to resolved:false (base owns no hierarchy)", async () => {
    for (const scopeType of ["office", "legal_entity", "tenant", "anything"]) {
      const res = await defaultBusinessScopeHierarchyPortAdapter.resolveScope(
        NO_TX,
        TENANT_A,
        scopeType,
        "any-id"
      );
      expect(res).toEqual({
        resolved: false,
        ancestorScopes: [],
        descendantScopes: []
      });
    }
  });
});
