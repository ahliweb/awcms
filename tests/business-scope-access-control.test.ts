import { describe, expect, test } from "bun:test";

import {
  evaluateAccess,
  permissionKey,
  TENANT_WIDE_SCOPE_TYPE,
  type BusinessScopeFact,
  type TenantContext
} from "../src/modules/identity-access/domain/access-control";

// Business-scope coverage in `evaluateAccess` (Issue #180). The subject's
// resolved `businessScopeFacts` are produced ahead of time by a caller
// (`application/business-scope-facts.ts`); here we hand `evaluateAccess`
// synthetic facts to exercise every coverage relation in isolation.

const context: TenantContext = {
  tenantId: "tenant-1",
  tenantUserId: "user-1",
  identityId: "identity-1",
  roles: ["manager"]
};

const OFFICE_A = { scopeType: "office", scopeId: "office-a" };
const OFFICE_CHILD = { scopeType: "office", scopeId: "office-child" };
const OFFICE_PARENT = { scopeType: "region", scopeId: "region-parent" };

function exactFact(
  scopeType: string,
  scopeId: string,
  resolved = true
): BusinessScopeFact {
  return {
    scopeType,
    scopeId,
    resolved,
    ancestorScopes: [],
    descendantScopes: [],
    tenantWide: false
  };
}

// A "read" permission (non-high-risk) and a "delete" permission (high-risk),
// each granted so the ONLY thing under test is the scope-coverage decision.
const READ_KEY = permissionKey("sales", "orders", "read");
const DELETE_KEY = permissionKey("sales", "orders", "delete");
const grantedRead = new Set([READ_KEY]);
const grantedDelete = new Set([DELETE_KEY]);

function readRequest(extra: Record<string, unknown>) {
  return {
    moduleKey: "sales",
    activityCode: "orders",
    action: "read" as const,
    resourceAttributes: extra
  };
}

function deleteRequest(extra: Record<string, unknown>) {
  return {
    moduleKey: "sales",
    activityCode: "orders",
    action: "delete" as const,
    resourceAttributes: extra
  };
}

describe("evaluateAccess — business-scope coverage (Issue #180)", () => {
  test("backward-compatible: a request that declares NO required scope is unaffected by facts", () => {
    const decision = evaluateAccess(context, readRequest({}), grantedRead, [
      exactFact("office", "office-z")
    ]);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("role_permission");
  });

  test("exact: subject holds exactly the required scope -> allowed", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedRead,
      [exactFact(OFFICE_A.scopeType, OFFICE_A.scopeId)]
    );
    expect(decision.allowed).toBe(true);
  });

  test("default-deny: required scope declared but the subject holds no covering fact", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedRead,
      [exactFact("office", "some-other-office")]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("default-deny: required scope declared but the fact set is missing entirely", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedRead
      // no businessScopeFacts argument at all
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("resolved:false -> DENY for a high-risk action even on an exact match", () => {
    const decision = evaluateAccess(
      context,
      deleteRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedDelete,
      [exactFact(OFFICE_A.scopeType, OFFICE_A.scopeId, /* resolved */ false)]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("resolved:false still allows a NON-high-risk exact match (the assignment itself is a DB fact)", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedRead,
      [exactFact(OFFICE_A.scopeType, OFFICE_A.scopeId, /* resolved */ false)]
    );
    expect(decision.allowed).toBe(true);
  });

  test("descendant: holding an ancestor scope covers a required descendant scope when the relation is requested", () => {
    const ancestorFact: BusinessScopeFact = {
      scopeType: OFFICE_PARENT.scopeType,
      scopeId: OFFICE_PARENT.scopeId,
      resolved: true,
      ancestorScopes: [],
      descendantScopes: [OFFICE_CHILD],
      tenantWide: false
    };
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_CHILD.scopeType,
        requiredScopeId: OFFICE_CHILD.scopeId,
        requiredScopeRelations: ["exact", "descendant"]
      }),
      grantedRead,
      [ancestorFact]
    );
    expect(decision.allowed).toBe(true);
  });

  test("descendant coverage is NOT granted by default (relations default to exact only)", () => {
    const ancestorFact: BusinessScopeFact = {
      scopeType: OFFICE_PARENT.scopeType,
      scopeId: OFFICE_PARENT.scopeId,
      resolved: true,
      ancestorScopes: [],
      descendantScopes: [OFFICE_CHILD],
      tenantWide: false
    };
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_CHILD.scopeType,
        requiredScopeId: OFFICE_CHILD.scopeId
        // no requiredScopeRelations -> exact only
      }),
      grantedRead,
      [ancestorFact]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("ancestor: holding a descendant scope covers a required ancestor scope when the relation is requested", () => {
    const descendantFact: BusinessScopeFact = {
      scopeType: OFFICE_CHILD.scopeType,
      scopeId: OFFICE_CHILD.scopeId,
      resolved: true,
      ancestorScopes: [OFFICE_PARENT],
      descendantScopes: [],
      tenantWide: false
    };
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_PARENT.scopeType,
        requiredScopeId: OFFICE_PARENT.scopeId,
        requiredScopeRelations: ["ancestor"]
      }),
      grantedRead,
      [descendantFact]
    );
    expect(decision.allowed).toBe(true);
  });

  test("hierarchy coverage NEVER comes from an unresolved fact (empty ancestor/descendant lists)", () => {
    // A fact whose hierarchy is unresolved carries no ancestor/descendant
    // entries, so descendant/ancestor coverage is impossible even if asked.
    const unresolved: BusinessScopeFact = {
      scopeType: OFFICE_PARENT.scopeType,
      scopeId: OFFICE_PARENT.scopeId,
      resolved: false,
      ancestorScopes: [],
      descendantScopes: [],
      tenantWide: false
    };
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_CHILD.scopeType,
        requiredScopeId: OFFICE_CHILD.scopeId,
        requiredScopeRelations: ["exact", "descendant", "ancestor"]
      }),
      grantedRead,
      [unresolved]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("business_scope_unresolved");
  });

  test("tenant-wide: a tenant-wide grant covers any required scope, including high-risk", () => {
    const tenantWideFact: BusinessScopeFact = {
      scopeType: TENANT_WIDE_SCOPE_TYPE,
      scopeId: context.tenantId,
      resolved: true,
      ancestorScopes: [],
      descendantScopes: [],
      tenantWide: true
    };
    const decision = evaluateAccess(
      context,
      deleteRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedDelete,
      [tenantWideFact]
    );
    expect(decision.allowed).toBe(true);
  });

  test("scope coverage does NOT bypass the permission check: covered scope but no permission -> default_deny", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      new Set(), // no permission granted
      [exactFact(OFFICE_A.scopeType, OFFICE_A.scopeId)]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("default_deny");
  });

  test("tenant isolation still wins over any scope fact (deny-overrides)", () => {
    const decision = evaluateAccess(
      context,
      readRequest({
        tenantId: "tenant-OTHER",
        requiredScopeType: OFFICE_A.scopeType,
        requiredScopeId: OFFICE_A.scopeId
      }),
      grantedRead,
      [exactFact(OFFICE_A.scopeType, OFFICE_A.scopeId)]
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("tenant_isolation");
  });
});
