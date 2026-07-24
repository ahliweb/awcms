/**
 * SoD rule registry validation tests (Issue #181) — pure, no I/O.
 *
 * Proves the registry gate `scripts/identity-access-sod-registry-check.ts`
 * runs (a) GREEN on the real composed registry, and (b) RED on drift
 * (duplicate ruleKey, mismatched owner, <2 keys, invalid enum, exception-policy
 * violations). Because the BASE ships no SoD rules (issue #181 out-of-scope),
 * the illustrative rules live in the test-support example domain modules — so
 * this test validates the base + example COMPOSED registry, which is what makes
 * fixture drift turn CI red (this file runs in `bun test`, part of
 * `bun run check`).
 */
import { describe, expect, test } from "bun:test";

import type {
  ModuleDescriptor,
  SoDRuleDescriptor
} from "../src/modules/_shared/module-contract";
import { listBaseModules } from "../src/modules";
import {
  collectSoDRuleDescriptors,
  validateSoDRuleRegistry
} from "../src/modules/identity-access/domain/sod-rule-registry";
import { exampleDomainModules } from "./fixtures/example-domain-modules";

const BASE = listBaseModules();
const COMPOSED: ModuleDescriptor[] = [...BASE, ...exampleDomainModules];

function moduleOwning(rules: SoDRuleDescriptor[]): ModuleDescriptor {
  return {
    key: "test_owner",
    name: "Test Owner",
    version: "1.0.0",
    status: "active",
    description: "Fixture module for registry validation.",
    dependencies: [],
    sodRules: rules
  };
}

describe("validateSoDRuleRegistry — the CI gate", () => {
  test("the BASE registry ships ONLY the data_lifecycle System-Foundation governance rule (no domain business rules — issue #181 out-of-scope)", () => {
    // ADR-0037 admits exactly one SoD rule to the base: a System-Foundation
    // GOVERNANCE maker/checker over `data_lifecycle`'s OWN legal-hold
    // create/release permissions — NOT a domain business rule (finance/
    // procurement/payroll/inventory), which remain out-of-scope in the base and
    // live only in the example-domain fixture.
    const baseRules = collectSoDRuleDescriptors(BASE);
    expect(baseRules.map((r) => r.ruleKey)).toEqual([
      "data_lifecycle.legal_hold_maker_checker"
    ]);
    expect(baseRules[0]!.ownerModuleKey).toBe("data_lifecycle");
    expect(validateSoDRuleRegistry(BASE).valid).toBe(true);
  });

  test("the base + example-domain COMPOSED registry is valid and carries the illustrative rules", () => {
    const result = validateSoDRuleRegistry(COMPOSED);
    expect(result.valid).toBe(true);
    // At least the five-plus illustrative example rules the issue requires.
    expect(result.rules.length).toBeGreaterThanOrEqual(5);
    // Every rule is owned either by the example domain module (illustrative
    // business rules) or by the base `data_lifecycle` System-Foundation module
    // (its governance maker/checker, ADR-0037) — never any other base module.
    const ownerKeys = new Set(result.rules.map((r) => r.ownerModuleKey));
    expect([...ownerKeys].sort()).toEqual(["data_lifecycle", "example_crm"]);
    expect(
      result.rules.some(
        (r) => r.ruleKey === "data_lifecycle.legal_hold_maker_checker"
      )
    ).toBe(true);
  });

  test("DRIFT — a duplicate ruleKey across the registry makes the gate RED", () => {
    const dup: SoDRuleDescriptor = {
      ruleKey: "test_owner.dup",
      ownerModuleKey: "test_owner",
      description: "duplicate",
      conflictingPermissionKeys: ["m.a.create", "m.a.approve"],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: { allowed: false }
    };
    const result = validateSoDRuleRegistry([moduleOwning([dup, { ...dup }])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /registered 2 times/.test(i.message))
    ).toBe(true);
  });

  test("DRIFT — an ownerModuleKey that does not match the declaring module makes the gate RED", () => {
    const wrongOwner: SoDRuleDescriptor = {
      ruleKey: "test_owner.mismatch",
      ownerModuleKey: "some_other_module",
      description: "mismatched owner",
      conflictingPermissionKeys: ["m.a.create", "m.a.approve"],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: { allowed: false }
    };
    const result = validateSoDRuleRegistry([moduleOwning([wrongOwner])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /ownerModuleKey/.test(i.message))).toBe(
      true
    );
  });

  test("DRIFT — fewer than 2 conflicting keys makes the gate RED", () => {
    const tooFew: SoDRuleDescriptor = {
      ruleKey: "test_owner.too_few",
      ownerModuleKey: "test_owner",
      description: "only one key",
      conflictingPermissionKeys: ["m.a.create"],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: { allowed: false }
    };
    const result = validateSoDRuleRegistry([moduleOwning([tooFew])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /at least 2 permission keys/.test(i.message))
    ).toBe(true);
  });

  test("DRIFT — an invalid severity/scopeApplicability enum makes the gate RED", () => {
    const badEnum = {
      ruleKey: "test_owner.bad_enum",
      ownerModuleKey: "test_owner",
      description: "bad enums",
      conflictingPermissionKeys: ["m.a.create", "m.a.approve"],
      scopeApplicability: "sometimes" as unknown as "any",
      severity: "catastrophic" as unknown as "high",
      exceptionPolicy: { allowed: false }
    } as SoDRuleDescriptor;
    const result = validateSoDRuleRegistry([moduleOwning([badEnum])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /scopeApplicability/.test(i.message))
    ).toBe(true);
    expect(result.issues.some((i) => /severity/.test(i.message))).toBe(true);
  });

  test("DRIFT — exceptionPolicy.allowed=true without requiresApprovalPermission/maxDurationDays makes the gate RED", () => {
    const badPolicy: SoDRuleDescriptor = {
      ruleKey: "test_owner.bad_policy",
      ownerModuleKey: "test_owner",
      description: "allowed but missing approval fields",
      conflictingPermissionKeys: ["m.a.create", "m.a.approve"],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: { allowed: true }
    };
    const result = validateSoDRuleRegistry([moduleOwning([badPolicy])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /requiresApprovalPermission/.test(i.message))
    ).toBe(true);
    expect(result.issues.some((i) => /maxDurationDays/.test(i.message))).toBe(
      true
    );
  });

  test("DRIFT — exceptionPolicy.allowed=false with stray approval fields makes the gate RED", () => {
    const strayFields: SoDRuleDescriptor = {
      ruleKey: "test_owner.stray",
      ownerModuleKey: "test_owner",
      description: "not allowed but has approval fields",
      conflictingPermissionKeys: ["m.a.create", "m.a.approve"],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: {
        allowed: false,
        requiresApprovalPermission: "m.a.override",
        maxDurationDays: 30
      }
    };
    const result = validateSoDRuleRegistry([moduleOwning([strayFields])]);
    expect(result.valid).toBe(false);
  });
});
