/**
 * The checker permission each SoD rule declares for itself — #545.
 *
 * `SoDRuleDescriptor.exceptionPolicy.requiresApprovalPermission` is described
 * by the module contract as "the permission key a DIFFERENT tenant user must
 * hold to approve an exception to THIS rule". `sod-rule-registry.ts` refuses a
 * rule that omits it or misspells it. `sod-exception-service.ts` said in prose
 * that it was "gated at the route".
 *
 * Nothing read it. The approve route asked the chokepoint for the fixed
 * `identity_access.business_scope_exceptions.approve` and stopped, and the one
 * rule this base ships names exactly that key — so the two coincided and the
 * gap was invisible. Three artefacts asserted a control that did not exist.
 *
 * These tests pin the resolver that closes it, and the two places the wiring
 * could still go wrong: the ORDER of the two gates (a rule key read before the
 * first gate would tell an unauthorized caller which rule an id belongs to),
 * and the fail-closed defaults.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { listModules } from "../src/modules";
import type { SoDRuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  parsePermissionKey,
  permissionKey
} from "../src/modules/identity-access/domain/access-control";
import { resolveSoDApprovalAuthority } from "../src/modules/identity-access/domain/sod-approval-authority";
import { collectSoDRuleDescriptors } from "../src/modules/identity-access/domain/sod-rule-registry";

const BASE_KEY = "identity_access.business_scope_exceptions.approve";
const ROUTE =
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/approve.ts";

function rule(
  ruleKey: string,
  requiresApprovalPermission: string | undefined
): SoDRuleDescriptor {
  return {
    ruleKey,
    ownerModuleKey: ruleKey.split(".")[0]!,
    description: "test rule",
    conflictingPermissionKeys: ["a.b.create", "a.b.release"],
    scopeApplicability: "global_within_tenant",
    severity: "critical",
    exceptionPolicy:
      requiresApprovalPermission === undefined
        ? { allowed: false }
        : {
            allowed: true,
            requiresApprovalPermission,
            maxDurationDays: 14
          }
  };
}

describe("parsePermissionKey is the exact inverse of permissionKey", () => {
  test("round-trips a real key", () => {
    const parsed = parsePermissionKey(
      permissionKey("identity_access", "business_scope_exceptions", "approve")
    );

    expect(parsed).toEqual({
      moduleKey: "identity_access",
      activityCode: "business_scope_exceptions",
      action: "approve"
    });
  });

  test("refuses anything that is not three non-empty segments", () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", ".b.c", "a..c", "a.b."]) {
      expect(parsePermissionKey(bad)).toBeNull();
    }
  });

  test("an unknown ACTION parses rather than throwing", () => {
    // Deliberate: there is no runtime list of the `AccessAction` union, and a
    // parser that threw would turn a typo in a descriptor into a 500. An
    // action nobody declared matches no row in the permission catalogue, so
    // the chokepoint denies it — the failure lands as a refusal.
    expect(parsePermissionKey("a.b.not_a_real_action")).toEqual({
      moduleKey: "a",
      activityCode: "b",
      action: "not_a_real_action" as never
    });
  });
});

describe("resolveSoDApprovalAuthority", () => {
  test("a rule naming the base key asks for nothing extra", () => {
    expect(
      resolveSoDApprovalAuthority("m.r", [rule("m.r", BASE_KEY)], BASE_KEY)
    ).toEqual({ outcome: "base_only" });
  });

  test("a rule naming a DIFFERENT key demands it as a second request", () => {
    // The whole point of the issue: before #545 this key was declared,
    // validated, documented — and never asked about.
    expect(
      resolveSoDApprovalAuthority(
        "m.r",
        [rule("m.r", "finance.controls.approve")],
        BASE_KEY
      )
    ).toEqual({
      outcome: "additional",
      request: {
        moduleKey: "finance",
        activityCode: "controls",
        action: "approve"
      }
    });
  });

  test("an unknown rule REFUSES rather than falling through", () => {
    const resolved = resolveSoDApprovalAuthority("m.gone", [], BASE_KEY);

    expect(resolved.outcome).toBe("refused");
    expect(resolved).toMatchObject({ code: "SOD_RULE_UNKNOWN" });
  });

  test("an unparseable declared key REFUSES rather than falling back to the base gate", () => {
    // "the declared checker permission is malformed" must never be the reason
    // a bypass is approved by someone the rule did not name.
    const resolved = resolveSoDApprovalAuthority(
      "m.r",
      [rule("m.r", "not-a-key")],
      BASE_KEY
    );

    expect(resolved.outcome).toBe("refused");
    expect(resolved).toMatchObject({
      code: "SOD_RULE_APPROVAL_PERMISSION_INVALID"
    });
  });

  test("a rule that forbids exceptions asks for nothing extra", () => {
    // Reachable only in theory — the create path refuses such a rule, so there
    // is no pending row to approve. Treating the absent field as a refusal
    // would break the one case that CAN occur while protecting none.
    expect(
      resolveSoDApprovalAuthority("m.r", [rule("m.r", undefined)], BASE_KEY)
    ).toEqual({ outcome: "base_only" });
  });
});

describe("the route wires it in the only safe order", () => {
  test("the rule key is read AFTER the fixed gate, never before", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    const fixedGate = source.indexOf(
      'activityCode: "business_scope_exceptions"'
    );
    const ruleKeyRead = source.indexOf("findSoDConflictExceptionRuleKey(");
    const secondGate = source.indexOf("resolveSoDApprovalAuthority(");

    // All three present — an absent marker would make the ordering assertions
    // compare -1 and pass by accident.
    expect(fixedGate).toBeGreaterThan(-1);
    expect(ruleKeyRead).toBeGreaterThan(-1);
    expect(secondGate).toBeGreaterThan(-1);

    // Which rule an id belongs to is information about the row. A caller who
    // may not approve anything must not learn it.
    expect(fixedGate).toBeLessThan(ruleKeyRead);
    expect(ruleKeyRead).toBeLessThan(secondGate);
  });

  test("a missing row is left to the service, so not-found has ONE author", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    // The route must not answer 404 itself when the rule-key read comes back
    // null: `approveSoDConflictException` already answers `not_found` for the
    // same condition, and two authors of one response is how they drift.
    expect(source).toContain("if (ruleKey !== null) {");
  });

  test("the second gate goes through the chokepoint, not a grant-set peek", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    expect(source.match(/authorizeInTransaction\(/g)?.length).toBe(2);
  });
});

describe("the installed registry stays consistent with the gate", () => {
  test("every rule that allows exceptions declares a PARSEABLE checker permission", () => {
    const exceptable = collectSoDRuleDescriptors(listModules()).filter(
      (candidate) => candidate.exceptionPolicy.allowed
    );

    // Paired with the loop so an empty registry cannot pass this vacuously.
    expect(exceptable.length).toBeGreaterThan(0);

    for (const candidate of exceptable) {
      const declared = candidate.exceptionPolicy.requiresApprovalPermission;
      expect(declared).toBeTruthy();
      expect(parsePermissionKey(declared!)).not.toBeNull();

      // And the resolver reaches a decision for it — never `refused`, which on
      // an installed rule would mean nobody can approve its exceptions.
      expect(
        resolveSoDApprovalAuthority(
          candidate.ruleKey,
          collectSoDRuleDescriptors(listModules()),
          BASE_KEY
        ).outcome
      ).not.toBe("refused");
    }
  });
});
