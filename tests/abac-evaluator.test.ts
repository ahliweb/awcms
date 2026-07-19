import { describe, expect, test } from "bun:test";

import {
  AbacEvaluationError,
  buildAttributeBag,
  evaluateAbacPolicies,
  evaluateCondition,
  isPolicyApplicable,
  type AbacEnvironment,
  type CompiledPolicy
} from "../src/modules/identity-access/domain/abac-evaluator";
import {
  evaluateAccess,
  permissionKey,
  type AccessRequest,
  type TenantContext
} from "../src/modules/identity-access/domain/access-control";

const CONTEXT: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tenantUserId: "22222222-2222-2222-2222-222222222222",
  identityId: "33333333-3333-3333-3333-333333333333",
  roles: ["manager"]
};

const ENV: AbacEnvironment = {
  now: new Date("2026-07-19T10:00:00Z"), // a Sunday
  ipTrusted: false
};

function req(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    moduleKey: "sales",
    activityCode: "invoice",
    action: "update",
    ...overrides
  };
}

function policy(overrides: Partial<CompiledPolicy>): CompiledPolicy {
  return {
    policyCode: "p",
    effect: "allow",
    dslVersion: 1,
    priority: 100,
    applicability: {
      moduleKey: null,
      activityCode: null,
      action: null,
      resourceType: null
    },
    condition: { allOf: [] },
    ...overrides
  };
}

describe("buildAttributeBag", () => {
  test("subject.* comes from context, resource.* from request, env.* from injected env", () => {
    const bag = buildAttributeBag(
      CONTEXT,
      req({
        resourceAttributes: { ownerTenantUserId: "owner-1", amount: 500 }
      }),
      ENV
    );
    expect(bag["subject.tenantUserId"]!.value).toBe(CONTEXT.tenantUserId);
    expect(bag["subject.roles"]!.value).toEqual(["manager"]);
    expect(bag["resource.ownerTenantUserId"]!.value).toBe("owner-1");
    expect(bag["resource.amount"]!.value).toBe(500);
    expect(bag["env.dayOfWeek"]!.value).toBe(0); // Sunday
    expect(bag["env.ipTrusted"]!.value).toBe(false);
    expect(bag.action!.value).toBe("update");
  });

  test("a wrong-typed resource attribute resolves as absent, not an error", () => {
    const bag = buildAttributeBag(
      CONTEXT,
      req({ resourceAttributes: { amount: "not-a-number" } }),
      ENV
    );
    expect(bag["resource.amount"]!.present).toBe(false);
  });
});

describe("evaluateCondition — operators", () => {
  const bag = buildAttributeBag(
    CONTEXT,
    req({
      resourceAttributes: {
        ownerTenantUserId: CONTEXT.tenantUserId,
        status: "pending",
        amount: 1500
      }
    }),
    ENV
  );

  test("eq / ne", () => {
    expect(
      evaluateCondition(
        { attr: "resource.status", op: "eq", value: "pending" },
        bag
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { attr: "resource.status", op: "ne", value: "pending" },
        bag
      )
    ).toBe(false);
  });

  test("in / nin on a scalar attribute", () => {
    expect(
      evaluateCondition(
        { attr: "resource.status", op: "in", value: ["draft", "pending"] },
        bag
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { attr: "resource.status", op: "nin", value: ["draft", "pending"] },
        bag
      )
    ).toBe(false);
  });

  test("in on the array attribute subject.roles = intersection non-empty", () => {
    expect(
      evaluateCondition(
        { attr: "subject.roles", op: "in", value: ["owner", "manager"] },
        bag
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { attr: "subject.roles", op: "in", value: ["owner"] },
        bag
      )
    ).toBe(false);
  });

  test("lt / lte / gt / gte on numeric", () => {
    expect(
      evaluateCondition({ attr: "resource.amount", op: "gt", value: 1000 }, bag)
    ).toBe(true);
    expect(
      evaluateCondition(
        { attr: "resource.amount", op: "lte", value: 1500 },
        bag
      )
    ).toBe(true);
    expect(
      evaluateCondition({ attr: "resource.amount", op: "lt", value: 1500 }, bag)
    ).toBe(false);
  });

  test("exists on present vs absent attribute", () => {
    expect(
      evaluateCondition({ attr: "resource.amount", op: "exists" }, bag)
    ).toBe(true);
    expect(
      evaluateCondition({ attr: "resource.businessScopeId", op: "exists" }, bag)
    ).toBe(false);
  });

  test("an absent attribute makes a comparison false (not an error)", () => {
    expect(
      evaluateCondition(
        { attr: "resource.businessScopeId", op: "eq", value: "x" },
        bag
      )
    ).toBe(false);
  });

  test("attr-to-attr ownership: resource.ownerTenantUserId eq subject.tenantUserId", () => {
    expect(
      evaluateCondition(
        {
          attr: "resource.ownerTenantUserId",
          op: "eq",
          valueAttr: "subject.tenantUserId"
        },
        bag
      )
    ).toBe(true);
  });

  test("allOf / anyOf / not composition", () => {
    expect(
      evaluateCondition(
        {
          allOf: [
            { attr: "resource.status", op: "eq", value: "pending" },
            { anyOf: [{ attr: "resource.amount", op: "gt", value: 1000 }] },
            { not: { attr: "env.ipTrusted", op: "eq", value: true } }
          ]
        },
        bag
      )
    ).toBe(true);
  });

  test("throws AbacEvaluationError on an unknown attribute (fail-closed at eval)", () => {
    expect(() =>
      evaluateCondition(
        { attr: "subject.doesNotExist", op: "eq", value: "x" },
        bag
      )
    ).toThrow(AbacEvaluationError);
  });

  test("throws AbacEvaluationError on an unknown operator", () => {
    expect(() =>
      // deliberately bypass the type to simulate a corrupt stored condition
      evaluateCondition({ attr: "resource.status", op: "regex" } as never, bag)
    ).toThrow(AbacEvaluationError);
  });

  // Eval-time backstop: a corrupt/hand-crafted stored condition carrying a
  // prototype-chain key must fail CLOSED (throw), not resolve an inherited
  // member off the bag/allow-list. `bag[attr]` and `attr in ABAC_ATTRIBUTES`
  // walk the prototype chain — own-property membership closes that.
  for (const key of [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "isPrototypeOf"
  ]) {
    test(`throws AbacEvaluationError on prototype-chain key "${key}" (exists)`, () => {
      expect(() =>
        evaluateCondition({ attr: key, op: "exists" } as never, bag)
      ).toThrow(AbacEvaluationError);
    });
  }

  test("a not(exists) over a prototype-chain key still throws (no always-true allow)", () => {
    expect(() =>
      evaluateCondition(
        { not: { attr: "__proto__", op: "exists" } } as never,
        bag
      )
    ).toThrow(AbacEvaluationError);
  });
});

describe("isPolicyApplicable", () => {
  test("null fields are wildcards", () => {
    expect(
      isPolicyApplicable(
        {
          moduleKey: null,
          activityCode: null,
          action: null,
          resourceType: null
        },
        req()
      )
    ).toBe(true);
  });

  test("a non-null field must equal the request", () => {
    expect(
      isPolicyApplicable(
        {
          moduleKey: "sales",
          activityCode: null,
          action: "update",
          resourceType: null
        },
        req()
      )
    ).toBe(true);
    expect(
      isPolicyApplicable(
        {
          moduleKey: "purchasing",
          activityCode: null,
          action: null,
          resourceType: null
        },
        req()
      )
    ).toBe(false);
  });

  test("a resourceType filter does not match a request with no resourceType", () => {
    expect(
      isPolicyApplicable(
        {
          moduleKey: null,
          activityCode: null,
          action: null,
          resourceType: "invoice"
        },
        req()
      )
    ).toBe(false);
  });
});

describe("evaluateAbacPolicies — precedence pass", () => {
  test("deny match short-circuits", () => {
    const pass = evaluateAbacPolicies(
      [
        policy({ policyCode: "d", effect: "deny", condition: { allOf: [] } }),
        policy({ policyCode: "a", effect: "allow", condition: { allOf: [] } })
      ],
      CONTEXT,
      req(),
      ENV
    );
    expect(pass.denyMatch?.policyCode).toBe("d");
  });

  test("an applicable invalid policy is a hard deny", () => {
    const pass = evaluateAbacPolicies(
      [
        policy({ policyCode: "broken", condition: null, invalidReason: "boom" })
      ],
      CONTEXT,
      req(),
      ENV
    );
    expect(pass.invalidMatch?.policyCode).toBe("broken");
  });

  test("allow policies report applicability + satisfaction", () => {
    const pass = evaluateAbacPolicies(
      [
        policy({
          policyCode: "a1",
          effect: "allow",
          condition: { attr: "resource.status", op: "eq", value: "draft" }
        })
      ],
      CONTEXT,
      req({ resourceAttributes: { status: "posted" } }),
      ENV
    );
    expect(pass.allowApplicable).toBe(true);
    expect(pass.allowSatisfied).toBeNull();
  });
});

describe("evaluateAccess — RBAC/ABAC integration", () => {
  const granted = new Set([permissionKey("sales", "invoice", "update")]);

  test("no policies → ABAC is a no-op, RBAC decides (backward compatible)", () => {
    const decision = evaluateAccess(CONTEXT, req(), granted, undefined, {
      policies: [],
      env: ENV
    });
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("role_permission");
  });

  test("explicit deny overrides an RBAC allow", () => {
    const decision = evaluateAccess(CONTEXT, req(), granted, undefined, {
      policies: [
        policy({
          policyCode: "block-posted",
          effect: "deny",
          condition: { attr: "resource.status", op: "eq", value: "posted" }
        })
      ],
      env: ENV
    });
    const denied = evaluateAccess(
      CONTEXT,
      req({ resourceAttributes: { status: "posted" } }),
      granted,
      undefined,
      {
        policies: [
          policy({
            policyCode: "block-posted",
            effect: "deny",
            condition: { attr: "resource.status", op: "eq", value: "posted" }
          })
        ],
        env: ENV
      }
    );
    expect(decision.allowed).toBe(true); // status != posted → deny not triggered
    expect(denied.allowed).toBe(false);
    expect(denied.matchedPolicy).toBe("block-posted");
  });

  test("an allow-policy does NOT create a permission the subject lacks", () => {
    const decision = evaluateAccess(
      CONTEXT,
      req(),
      new Set<string>(), // no RBAC permission
      undefined,
      {
        policies: [
          policy({
            policyCode: "grant-all",
            effect: "allow",
            condition: { allOf: [] }
          })
        ],
        env: ENV
      }
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("default_deny");
  });

  test("allow-constraint: applicable allow-policy with unsatisfied condition denies a granted permission", () => {
    const decision = evaluateAccess(
      CONTEXT,
      req({ resourceAttributes: { ownerTenantUserId: "someone-else" } }),
      granted,
      undefined,
      {
        policies: [
          policy({
            policyCode: "own-only",
            effect: "allow",
            condition: {
              attr: "resource.ownerTenantUserId",
              op: "eq",
              valueAttr: "subject.tenantUserId"
            }
          })
        ],
        env: ENV
      }
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("abac_allow_unsatisfied");
  });

  test("allow-constraint: satisfied ownership allow-policy permits a granted permission", () => {
    const decision = evaluateAccess(
      CONTEXT,
      req({ resourceAttributes: { ownerTenantUserId: CONTEXT.tenantUserId } }),
      granted,
      undefined,
      {
        policies: [
          policy({
            policyCode: "own-only",
            effect: "allow",
            condition: {
              attr: "resource.ownerTenantUserId",
              op: "eq",
              valueAttr: "subject.tenantUserId"
            }
          })
        ],
        env: ENV
      }
    );
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("own-only");
    expect(decision.matchedPolicyVersion).toBe(1);
  });

  test("an applicable INVALID stored policy denies (fail-closed), before RBAC", () => {
    const decision = evaluateAccess(CONTEXT, req(), granted, undefined, {
      policies: [
        policy({ policyCode: "corrupt", condition: null, invalidReason: "x" })
      ],
      env: ENV
    });
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("corrupt");
  });

  // ── MUTATION-SENSITIVE: the fail-closed default. If someone flips
  // "unknown attribute/operator/eval-error → deny" to "allow", THIS test
  // goes RED. ──────────────────────────────────────────────────────────────
  test("unknown attribute in an active policy → DENY (fail-closed)", () => {
    const decision = evaluateAccess(CONTEXT, req(), granted, undefined, {
      policies: [
        policy({
          policyCode: "bad-runtime-attr",
          effect: "allow",
          condition: { attr: "subject.doesNotExist", op: "eq", value: "x" }
        })
      ],
      env: ENV
    });
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("abac_evaluation_error");
  });

  test("unknown operator in an active deny policy → DENY (fail-closed)", () => {
    const decision = evaluateAccess(CONTEXT, req(), granted, undefined, {
      policies: [
        policy({
          policyCode: "bad-runtime-op",
          effect: "deny",
          condition: { attr: "resource.status", op: "regex" } as never
        })
      ],
      env: ENV
    });
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("abac_evaluation_error");
  });

  test("built-in tenant-isolation deny still wins even with policies present", () => {
    const decision = evaluateAccess(
      CONTEXT,
      req({
        resourceAttributes: { tenantId: "99999999-9999-9999-9999-999999999999" }
      }),
      granted,
      undefined,
      {
        policies: [policy({ effect: "allow", condition: { allOf: [] } })],
        env: ENV
      }
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("tenant_isolation");
  });
});
