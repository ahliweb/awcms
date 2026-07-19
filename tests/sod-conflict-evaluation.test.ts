/**
 * Unit tests for SoD conflict detection (Issue #181) — pure, no I/O, no
 * database. Ported from awcms-mini `tests/unit/sod-conflict-evaluation.test.ts`
 * (Issue #746). The REAL registered fixture rules are validated separately by
 * `tests/sod-rule-registry.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import type { SoDRuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  createSoDConflictEvaluator,
  detectSoDConflicts,
  isSoDConflictExceptionCurrentlyValid,
  validateCreateSoDConflictExceptionInput,
  validateRevokeSoDConflictExceptionInput
} from "../src/modules/identity-access/domain/sod-conflict-evaluation";

const GLOBAL_RULE: SoDRuleDescriptor = {
  ruleKey: "test_module.global_rule",
  ownerModuleKey: "test_module",
  description: "Fixture global rule.",
  conflictingPermissionKeys: [
    "test_module.widgets.create",
    "test_module.widgets.approve"
  ],
  scopeApplicability: "global_within_tenant",
  severity: "high",
  exceptionPolicy: {
    allowed: true,
    requiresApprovalPermission: "test_module.widgets.override",
    maxDurationDays: 30
  }
};

const SCOPED_RULE: SoDRuleDescriptor = {
  ruleKey: "test_module.scoped_rule",
  ownerModuleKey: "test_module",
  description: "Fixture same-scope-only rule.",
  conflictingPermissionKeys: [
    "test_module.gadgets.create",
    "test_module.gadgets.revoke"
  ],
  scopeApplicability: "same_scope_only",
  severity: "medium",
  exceptionPolicy: { allowed: false }
};

describe("detectSoDConflicts (rule matching + scope relation + precedence)", () => {
  test("global_within_tenant: detects a conflict regardless of scope", () => {
    const matches = detectSoDConflicts(
      [GLOBAL_RULE],
      "test_module.widgets.approve",
      { scopeType: "office", scopeId: "scope-a" },
      [
        {
          permissionKey: "test_module.widgets.create",
          scopeType: "office",
          scopeId: "scope-b"
        }
      ]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.rule.ruleKey).toBe("test_module.global_rule");
    expect(matches[0]!.indeterminate).toBe(false);
  });

  test("global_within_tenant: no conflict when the subject does not hold the other permission", () => {
    const matches = detectSoDConflicts(
      [GLOBAL_RULE],
      "test_module.widgets.approve",
      null,
      [
        {
          permissionKey: "unrelated.permission.read",
          scopeType: "office",
          scopeId: "scope-a"
        }
      ]
    );
    expect(matches).toHaveLength(0);
  });

  test("same_scope_only: conflict ONLY when the fact's scope matches the requested scope (scope-predicate mutation target)", () => {
    const matchingScope = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      { scopeType: "office", scopeId: "scope-a" },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "office",
          scopeId: "scope-a"
        }
      ]
    );
    expect(matchingScope).toHaveLength(1);
    expect(matchingScope[0]!.indeterminate).toBe(false);

    const differentScope = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      { scopeType: "office", scopeId: "scope-a" },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "office",
          scopeId: "scope-b"
        }
      ]
    );
    expect(differentScope).toHaveLength(0);
  });

  test("same_scope_only: a null-scope fact (ordinary RBAC grant) conflicts at EVERY requested scope", () => {
    const matches = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      { scopeType: "office", scopeId: "scope-a" },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: null,
          scopeId: null
        }
      ]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.indeterminate).toBe(false);

    const otherScope = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      { scopeType: "office", scopeId: "scope-z" },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: null,
          scopeId: null
        }
      ]
    );
    expect(otherScope).toHaveLength(1);
  });

  test("same_scope_only: a fact at a scope in relatedScopes (ancestor/descendant) is a scope match (hierarchy-aware)", () => {
    const parentAncestorMatch = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      {
        scopeType: "organization_unit",
        scopeId: "child-unit",
        relatedScopes: [
          { scopeType: "organization_unit", scopeId: "parent-unit" }
        ]
      },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "organization_unit",
          scopeId: "parent-unit"
        }
      ]
    );
    expect(parentAncestorMatch).toHaveLength(1);
    expect(parentAncestorMatch[0]!.indeterminate).toBe(false);

    const unrelatedScope = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      {
        scopeType: "organization_unit",
        scopeId: "child-unit",
        relatedScopes: [
          { scopeType: "organization_unit", scopeId: "parent-unit" }
        ]
      },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "organization_unit",
          scopeId: "cousin-unit"
        }
      ]
    );
    expect(unrelatedScope).toHaveLength(0);
  });

  test("same_scope_only: an EMPTY/omitted relatedScopes preserves exact-match-only behavior", () => {
    const noRelatedScopes = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      { scopeType: "office", scopeId: "scope-a", relatedScopes: [] },
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "office",
          scopeId: "scope-b"
        }
      ]
    );
    expect(noRelatedScopes).toHaveLength(0);
  });

  test('same_scope_only: no requestedScope is INDETERMINATE, not silently "no conflict" — default-deny', () => {
    const matches = detectSoDConflicts(
      [SCOPED_RULE],
      "test_module.gadgets.revoke",
      null,
      [
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "office",
          scopeId: "scope-a"
        }
      ]
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.indeterminate).toBe(true);
  });

  test("a permission key not referenced by any rule produces zero matches", () => {
    const matches = detectSoDConflicts(
      [GLOBAL_RULE, SCOPED_RULE],
      "unrelated.module.read",
      null,
      [
        {
          permissionKey: "test_module.widgets.create",
          scopeType: "office",
          scopeId: "scope-a"
        },
        {
          permissionKey: "test_module.gadgets.create",
          scopeType: "office",
          scopeId: "scope-a"
        }
      ]
    );
    expect(matches).toEqual([]);
  });

  test("multiple rules can independently match the same requested permission", () => {
    const doubleRule: SoDRuleDescriptor = {
      ruleKey: "test_module.double_rule",
      ownerModuleKey: "test_module",
      description: "Second fixture rule sharing a conflicting key.",
      conflictingPermissionKeys: [
        "test_module.widgets.approve",
        "test_module.other.read"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "low",
      exceptionPolicy: { allowed: false }
    };

    const matches = detectSoDConflicts(
      [GLOBAL_RULE, doubleRule],
      "test_module.widgets.approve",
      null,
      [
        {
          permissionKey: "test_module.widgets.create",
          scopeType: "office",
          scopeId: "a"
        },
        {
          permissionKey: "test_module.other.read",
          scopeType: "office",
          scopeId: "a"
        }
      ]
    );
    expect(matches).toHaveLength(2);
  });

  test("the hoisted evaluator matches the single-shot function for every key (index equivalence)", () => {
    const rules = [GLOBAL_RULE, SCOPED_RULE];
    const scope = { scopeType: "office", scopeId: "scope-a" };
    const facts = [
      {
        permissionKey: "test_module.widgets.create",
        scopeType: "office",
        scopeId: "scope-a"
      },
      {
        permissionKey: "test_module.gadgets.create",
        scopeType: "office",
        scopeId: "scope-a"
      }
    ];
    const evaluator = createSoDConflictEvaluator(rules, scope, facts);
    for (const key of [
      "test_module.widgets.approve",
      "test_module.gadgets.revoke",
      "unrelated.module.read"
    ]) {
      expect(evaluator.detect(key)).toEqual(
        detectSoDConflicts(rules, key, scope, facts)
      );
    }
  });
});

describe("isSoDConflictExceptionCurrentlyValid (expiry gate)", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  test("a status='approved' row past its effectiveTo is NOT valid — timestamp is the real gate, not status", () => {
    expect(
      isSoDConflictExceptionCurrentlyValid(
        {
          status: "approved",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          effectiveTo: new Date("2026-06-10T00:00:00Z"),
          scopeType: null,
          scopeId: null
        },
        now,
        null
      )
    ).toBe(false);
  });

  test("a currently-in-window approved row is valid", () => {
    expect(
      isSoDConflictExceptionCurrentlyValid(
        {
          status: "approved",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          effectiveTo: new Date("2026-06-30T00:00:00Z"),
          scopeType: null,
          scopeId: null
        },
        now,
        null
      )
    ).toBe(true);
  });

  test("pending/rejected/revoked/expired is never valid regardless of timestamps", () => {
    for (const status of ["pending", "rejected", "revoked", "expired"]) {
      expect(
        isSoDConflictExceptionCurrentlyValid(
          {
            status,
            effectiveFrom: new Date("2026-06-01T00:00:00Z"),
            effectiveTo: new Date("2026-06-30T00:00:00Z"),
            scopeType: null,
            scopeId: null
          },
          now,
          null
        )
      ).toBe(false);
    }
  });

  test("a blanket exception (scopeType/scopeId null) covers every scope, including an indeterminate request", () => {
    expect(
      isSoDConflictExceptionCurrentlyValid(
        {
          status: "approved",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          effectiveTo: new Date("2026-06-30T00:00:00Z"),
          scopeType: null,
          scopeId: null
        },
        now,
        { scopeType: "office", scopeId: "any" }
      )
    ).toBe(true);
  });

  test("a scope-specific exception only covers its OWN scope", () => {
    const base = {
      status: "approved" as const,
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      effectiveTo: new Date("2026-06-30T00:00:00Z"),
      scopeType: "office",
      scopeId: "scope-a"
    };
    expect(
      isSoDConflictExceptionCurrentlyValid(base, now, {
        scopeType: "office",
        scopeId: "scope-a"
      })
    ).toBe(true);
    expect(
      isSoDConflictExceptionCurrentlyValid(base, now, {
        scopeType: "office",
        scopeId: "scope-b"
      })
    ).toBe(false);
    expect(isSoDConflictExceptionCurrentlyValid(base, now, null)).toBe(false);
  });
});

describe("exception input validation", () => {
  const validFrom = new Date("2026-06-01T00:00:00Z");
  const validTo = new Date("2026-06-10T00:00:00Z");

  test("valid create input has no errors", () => {
    expect(
      validateCreateSoDConflictExceptionInput({
        ruleKey: "sales.invoice_maker_checker",
        scopeType: null,
        scopeId: null,
        justification:
          "Auditor-approved temporary override for month-end close.",
        effectiveFrom: validFrom,
        effectiveTo: validTo
      })
    ).toEqual([]);
  });

  test("scopeType/scopeId must be both-set or both-null", () => {
    const errors = validateCreateSoDConflictExceptionInput({
      ruleKey: "sales.invoice_maker_checker",
      scopeType: "office",
      scopeId: null,
      justification: "A sufficiently long justification string.",
      effectiveFrom: validFrom,
      effectiveTo: validTo
    });
    expect(errors.some((e) => e.field === "scopeType")).toBe(true);
  });

  test("effectiveTo must be after effectiveFrom (no indefinite/zero-length override)", () => {
    const errors = validateCreateSoDConflictExceptionInput({
      ruleKey: "sales.invoice_maker_checker",
      scopeType: null,
      scopeId: null,
      justification: "A sufficiently long justification string.",
      effectiveFrom: validTo,
      effectiveTo: validFrom
    });
    expect(errors.some((e) => e.field === "effectiveTo")).toBe(true);
  });

  test("a short justification is rejected", () => {
    const errors = validateCreateSoDConflictExceptionInput({
      ruleKey: "sales.invoice_maker_checker",
      scopeType: null,
      scopeId: null,
      justification: "too short",
      effectiveFrom: validFrom,
      effectiveTo: validTo
    });
    expect(errors.some((e) => e.field === "justification")).toBe(true);
  });

  test("revoke requires a reason", () => {
    expect(
      validateRevokeSoDConflictExceptionInput({ revokeReason: "" }).length
    ).toBeGreaterThan(0);
    expect(
      validateRevokeSoDConflictExceptionInput({
        revokeReason: "no longer needed"
      })
    ).toEqual([]);
  });
});
