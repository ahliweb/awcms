import { describe, expect, test } from "bun:test";

import {
  ABAC_DSL_VERSION,
  parseAbacCondition,
  validateAbacPolicyInput,
  validateAbacSimulationInput
} from "../src/modules/identity-access/domain/abac-policy";
import examplePolicies from "../fixtures/abac-example-policies.json";

describe("parseAbacCondition — structural validity", () => {
  test("accepts an empty allOf (vacuously true, the default backfill)", () => {
    expect(parseAbacCondition({ allOf: [] }).valid).toBe(true);
  });

  test("accepts nested allOf/anyOf/not composition", () => {
    const result = parseAbacCondition({
      allOf: [
        { anyOf: [{ attr: "resource.status", op: "eq", value: "draft" }] },
        { not: { attr: "env.ipTrusted", op: "eq", value: false } }
      ]
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a composition node with more than one key", () => {
    const result = parseAbacCondition({
      allOf: [],
      anyOf: []
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-object node", () => {
    expect(parseAbacCondition(null).valid).toBe(false);
    expect(parseAbacCondition("nope").valid).toBe(false);
    expect(parseAbacCondition([]).valid).toBe(false);
  });

  test("rejects a leaf with an unexpected extra key", () => {
    const result = parseAbacCondition({
      attr: "resource.status",
      op: "eq",
      value: "draft",
      extra: true
    });
    expect(result.valid).toBe(false);
  });
});

describe("parseAbacCondition — allow-list (fail-closed)", () => {
  test("rejects an unknown attribute", () => {
    const result = parseAbacCondition({
      attr: "subject.notAllowed",
      op: "eq",
      value: "x"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(" ")).toContain("unknown attribute");
    }
  });

  test("rejects an unknown operator", () => {
    const result = parseAbacCondition({
      attr: "resource.status",
      op: "regex",
      value: "x"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(" ")).toContain("unknown operator");
    }
  });

  test("rejects an unknown valueAttr", () => {
    const result = parseAbacCondition({
      attr: "resource.ownerTenantUserId",
      op: "eq",
      valueAttr: "subject.nope"
    });
    expect(result.valid).toBe(false);
  });

  // The allow-list is a plain object, so a naive `ABAC_ATTRIBUTES[attr]` /
  // `attr in ABAC_ATTRIBUTES` membership test would resolve inherited members
  // for prototype-chain keys and let them PASS the unknown-attribute check —
  // a fail-OPEN hole. Membership must be own-property only.
  const PROTOTYPE_KEYS = [
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "isPrototypeOf",
    "propertyIsEnumerable"
  ];

  for (const key of PROTOTYPE_KEYS) {
    test(`rejects prototype-chain key "${key}" as an unknown attribute`, () => {
      const result = parseAbacCondition({ attr: key, op: "exists" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(" ")).toContain("unknown attribute");
      }
    });

    test(`rejects prototype-chain key "${key}" as an unknown valueAttr`, () => {
      const result = parseAbacCondition({
        attr: "resource.ownerTenantUserId",
        op: "eq",
        valueAttr: key
      });
      expect(result.valid).toBe(false);
    });
  }
});

describe("parseAbacCondition — operator/type compatibility", () => {
  test("eq accepts a string literal on a string attribute", () => {
    expect(
      parseAbacCondition({ attr: "resource.status", op: "eq", value: "draft" })
        .valid
    ).toBe(true);
  });

  test("eq rejects a number literal on a string attribute", () => {
    expect(
      parseAbacCondition({ attr: "resource.status", op: "eq", value: 5 }).valid
    ).toBe(false);
  });

  test("lt/lte/gt/gte reject a non-numeric/non-date attribute", () => {
    expect(
      parseAbacCondition({ attr: "resource.status", op: "gt", value: "x" })
        .valid
    ).toBe(false);
  });

  test("gt accepts a numeric literal on resource.amount", () => {
    expect(
      parseAbacCondition({ attr: "resource.amount", op: "gt", value: 1000 })
        .valid
    ).toBe(true);
  });

  test("lte accepts an ISO date literal on env.now", () => {
    expect(
      parseAbacCondition({
        attr: "env.now",
        op: "lte",
        value: "2026-12-31T23:59:59Z"
      }).valid
    ).toBe(true);
  });

  test("lte rejects a non-ISO string on a date attribute", () => {
    expect(
      parseAbacCondition({ attr: "env.now", op: "lte", value: "not-a-date" })
        .valid
    ).toBe(false);
  });

  test("eq/ne rejected on the array attribute subject.roles (use in/nin)", () => {
    expect(
      parseAbacCondition({ attr: "subject.roles", op: "eq", value: "owner" })
        .valid
    ).toBe(false);
  });

  test("in accepts a non-empty string array on subject.roles", () => {
    expect(
      parseAbacCondition({
        attr: "subject.roles",
        op: "in",
        value: ["owner", "manager"]
      }).valid
    ).toBe(true);
  });

  test("in rejects an empty array", () => {
    expect(
      parseAbacCondition({ attr: "resource.status", op: "in", value: [] }).valid
    ).toBe(false);
  });

  test("in rejects valueAttr (membership needs a literal set)", () => {
    expect(
      parseAbacCondition({
        attr: "resource.status",
        op: "in",
        valueAttr: "resource.resourceType"
      }).valid
    ).toBe(false);
  });

  test("exists must not carry a value", () => {
    expect(
      parseAbacCondition({ attr: "resource.amount", op: "exists", value: 1 })
        .valid
    ).toBe(false);
    expect(
      parseAbacCondition({ attr: "resource.amount", op: "exists" }).valid
    ).toBe(true);
  });

  test("a leaf requires exactly one of value/valueAttr (except exists)", () => {
    expect(
      parseAbacCondition({
        attr: "resource.status",
        op: "eq",
        value: "x",
        valueAttr: "resource.resourceType"
      }).valid
    ).toBe(false);
    expect(
      parseAbacCondition({ attr: "resource.status", op: "eq" }).valid
    ).toBe(false);
  });
});

describe("parseAbacCondition — attr-to-attr ownership", () => {
  test("accepts resource.ownerTenantUserId eq subject.tenantUserId", () => {
    expect(
      parseAbacCondition({
        attr: "resource.ownerTenantUserId",
        op: "eq",
        valueAttr: "subject.tenantUserId"
      }).valid
    ).toBe(true);
  });

  test("rejects comparing incompatible categories via valueAttr", () => {
    expect(
      parseAbacCondition({
        attr: "resource.amount",
        op: "eq",
        valueAttr: "resource.status"
      }).valid
    ).toBe(false);
  });
});

describe("parseAbacCondition — bounds", () => {
  test("rejects a condition nested past the max depth", () => {
    let node: unknown = { attr: "resource.amount", op: "exists" };
    for (let i = 0; i < 40; i += 1) {
      node = { not: node };
    }
    expect(parseAbacCondition(node).valid).toBe(false);
  });
});

describe("validateAbacPolicyInput", () => {
  const validConditions = {
    allOf: [{ attr: "resource.status", op: "eq", value: "draft" }]
  };

  test("accepts a well-formed policy", () => {
    const result = validateAbacPolicyInput({
      policyCode: "erp.only-draft-edit",
      effect: "allow",
      moduleKey: "sales",
      activityCode: "invoice",
      action: "update",
      conditions: validConditions
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.dslVersion).toBe(ABAC_DSL_VERSION);
      expect(result.value.priority).toBe(100);
      expect(result.value.effect).toBe("allow");
    }
  });

  test("rejects an invalid effect", () => {
    const result = validateAbacPolicyInput({
      policyCode: "bad-effect",
      effect: "maybe",
      conditions: validConditions
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a policy whose conditions are invalid (unknown attr)", () => {
    const result = validateAbacPolicyInput({
      policyCode: "bad-attr",
      effect: "deny",
      conditions: { attr: "subject.evil", op: "eq", value: "x" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a dslVersion newer than supported", () => {
    const result = validateAbacPolicyInput({
      policyCode: "future-grammar",
      effect: "allow",
      dslVersion: ABAC_DSL_VERSION + 1,
      conditions: validConditions
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a malformed policyCode", () => {
    expect(
      validateAbacPolicyInput({
        policyCode: "a",
        effect: "allow",
        conditions: validConditions
      }).valid
    ).toBe(false);
  });

  test("normalizes empty applicability strings to null (wildcards)", () => {
    const result = validateAbacPolicyInput({
      policyCode: "wildcard-policy",
      effect: "deny",
      moduleKey: "",
      conditions: validConditions
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.moduleKey).toBeNull();
    }
  });
});

describe("fixtures/abac-example-policies.json — the 5 illustrative ERP policies", () => {
  test("there are exactly 5 example policies", () => {
    expect(examplePolicies.policies).toHaveLength(5);
  });

  test("every example policy is valid DSL under the current grammar", () => {
    for (const policy of examplePolicies.policies) {
      const result = validateAbacPolicyInput(policy);
      expect(result.valid).toBe(true);
    }
  });
});

describe("validateAbacSimulationInput", () => {
  test("accepts a minimal simulation request", () => {
    const result = validateAbacSimulationInput({
      request: { moduleKey: "sales", activityCode: "invoice", action: "update" }
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a request missing action", () => {
    const result = validateAbacSimulationInput({
      request: { moduleKey: "sales", activityCode: "invoice" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects non-boolean environment.ipTrusted", () => {
    const result = validateAbacSimulationInput({
      request: { moduleKey: "s", activityCode: "a", action: "read" },
      environment: { ipTrusted: "yes" }
    });
    expect(result.valid).toBe(false);
  });
});
