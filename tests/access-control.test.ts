import { describe, expect, test } from "bun:test";

import {
  evaluateAccess,
  isHighRiskAction,
  permissionKey
} from "../src/modules/identity-access/domain/access-control";

const context = {
  tenantId: "tenant-1",
  tenantUserId: "user-1",
  identityId: "identity-1",
  roles: ["owner"]
};

describe("evaluateAccess", () => {
  test("denies by default when no permission is granted", () => {
    const decision = evaluateAccess(
      context,
      {
        moduleKey: "profile_identity",
        activityCode: "profile_management",
        action: "read"
      },
      new Set()
    );

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("default_deny");
  });

  test("allows when the exact permission key is granted", () => {
    const decision = evaluateAccess(
      context,
      {
        moduleKey: "profile_identity",
        activityCode: "profile_management",
        action: "read"
      },
      new Set([permissionKey("profile_identity", "profile_management", "read")])
    );

    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("role_permission");
  });

  test("denies cross-tenant resource access even with the permission granted", () => {
    const decision = evaluateAccess(
      context,
      {
        moduleKey: "profile_identity",
        activityCode: "profile_management",
        action: "read",
        resourceAttributes: { tenantId: "tenant-2" }
      },
      new Set([permissionKey("profile_identity", "profile_management", "read")])
    );

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("tenant_isolation");
  });
});

describe("isHighRiskAction", () => {
  test("classifies delete/assign/configure/restore/purge as high risk", () => {
    expect(isHighRiskAction("delete")).toBe(true);
    expect(isHighRiskAction("assign")).toBe(true);
    expect(isHighRiskAction("configure")).toBe(true);
    expect(isHighRiskAction("restore")).toBe(true);
    expect(isHighRiskAction("purge")).toBe(true);
  });

  test("does not classify read/create/update as high risk", () => {
    expect(isHighRiskAction("read")).toBe(false);
    expect(isHighRiskAction("create")).toBe(false);
    expect(isHighRiskAction("update")).toBe(false);
  });
});
