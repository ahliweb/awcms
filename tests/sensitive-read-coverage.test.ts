/**
 * Sensitive-read coverage (Issue #978, PS-18 (a)): an unaudited read path
 * cannot exist for the named reads.
 *
 * `hr_payroll` does not exist yet (#957 is blocked on a DPIA), so the gate is
 * exercised with a fixture module and fixture route sources shaped like the
 * ones phase 3 will write. Each case plants one defect and asserts the gate
 * names it; the "clean" cases make sure the gate is not red about everything.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  collectAuditedPermissions,
  evaluateSensitiveReadCoverage
} from "../src/modules/_shared/sensitive-read-coverage";
import {
  NOT_SENSITIVE_READS,
  SENSITIVE_READ_POLICIES,
  findSensitiveReadPolicy,
  validateSensitiveReadPolicies,
  type SensitiveReadPolicy
} from "../src/modules/_shared/sensitive-reads";
import { crossedDecade } from "../src/modules/logging/application/sensitive-read-audit";

function payrollModule(
  permissions: { activityCode: string; action: string }[]
): ModuleDescriptor {
  return {
    key: "hr_payroll",
    name: "HR payroll",
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    permissions: permissions.map((permission) => ({
      ...permission,
      description: "fixture"
    }))
  };
}

const ALL_READS = [
  { activityCode: "compensation", action: "read" },
  { activityCode: "runs", action: "read" },
  { activityCode: "payslips", action: "read" },
  { activityCode: "periods", action: "read" },
  { activityCode: "rules", action: "read" },
  { activityCode: "sod_policy", action: "read" },
  { activityCode: "payout_accounts", action: "read" },
  { activityCode: "payout_accounts", action: "reveal" },
  // Not read-shaped: never needs a policy.
  { activityCode: "runs", action: "approve" }
];

/** A route in the repo's real style. */
function route(
  activity: string,
  action: string,
  body: string,
  extra = ""
): string {
  return `
import { authorizeInTransaction } from "../../../../modules/identity-access/application/access-control";
${extra}
export const GET = defineTenantRoute(async ({ tx, ctx }) => {
  const guard = await authorizeInTransaction(tx, ctx.tenantId, ctx.tokenHash, ctx.now, {
    moduleKey: "hr_payroll",
    activityCode: "${activity}",
    action: "${action}"
  });
  ${body}
  return ok(rows);
});
`;
}

const AUDIT_CALL = (permission: string) => `
  await recordSensitiveRead(tx, {
    tenantId: ctx.tenantId,
    actorTenantUserId: ctx.tenantUserId,
    permission: "${permission}",
    itemCount: rows.length
  });`;

describe("the policy registry itself", () => {
  test("the shipped policies are structurally valid", () => {
    expect(validateSensitiveReadPolicies()).toEqual([]);
  });

  test("it covers the reads the finding names: compensation, run lines, payslips, and exports", () => {
    for (const permission of [
      "hr_payroll.compensation.read",
      "hr_payroll.runs.read",
      "hr_payroll.payslips.read",
      "hr_payroll.reports.export",
      "hr_payroll.payslips.export",
      "hr_payroll.runs.download"
    ]) {
      expect(findSensitiveReadPolicy(permission)).toBeDefined();
    }
  });

  test("an export is resolved by the module-wide policy and is never coalesced", () => {
    const policy = findSensitiveReadPolicy("hr_payroll.anything.export")!;

    expect(policy.coalesceWindowSeconds).toBe(0);
    expect(policy.severity).toBe("warning");
  });

  const GOOD: SensitiveReadPolicy = {
    permission: "x.y.read",
    kind: "sensitive_read.y",
    resourceType: "y",
    coalesceWindowSeconds: 60,
    severity: "info",
    rationale: "a long enough rationale for the fixture"
  };

  test("malformed policies are named", () => {
    expect(validateSensitiveReadPolicies([GOOD])).toEqual([]);
    expect(validateSensitiveReadPolicies([GOOD, GOOD]).join("\n")).toContain(
      "more than once"
    );
    expect(
      validateSensitiveReadPolicies([{ ...GOOD, kind: "bad kind" }]).join("\n")
    ).toContain("kind");
    expect(
      validateSensitiveReadPolicies([
        GOOD,
        { ...GOOD, permission: "x.z.read" }
      ]).join("\n")
    ).toContain("used by another policy");
    expect(
      validateSensitiveReadPolicies([
        { ...GOOD, coalesceWindowSeconds: 999999 }
      ]).join("\n")
    ).toContain("coalesceWindowSeconds");
    expect(
      validateSensitiveReadPolicies([
        { ...GOOD, permission: "x.y.export", coalesceWindowSeconds: 60 }
      ]).join("\n")
    ).toContain("must not be coalesced");
    expect(
      validateSensitiveReadPolicies([{ ...GOOD, rationale: "" }]).join("\n")
    ).toContain("rationale");
  });
});

describe("collectAuditedPermissions", () => {
  test("reads the permission of each recordSensitiveRead call, literal or constant", () => {
    const source = `
      const PERM = "hr_payroll.runs.read";
      await recordSensitiveRead(tx, { permission: "hr_payroll.compensation.read", itemCount: 1 });
      await recordSensitiveRead(tx, { tenantId, permission: PERM });
    `;

    expect(
      [
        ...collectAuditedPermissions(
          source,
          new Map([["PERM", "hr_payroll.runs.read"]])
        )
      ].sort()
    ).toEqual(["hr_payroll.compensation.read", "hr_payroll.runs.read"]);
  });

  test("a mention in a comment, or a computed permission, is not an audit", () => {
    const source = `
      // recordSensitiveRead(tx, { permission: "hr_payroll.compensation.read" })
      await recordSensitiveRead(tx, { permission: computePermission() });
    `;

    expect([...collectAuditedPermissions(source)]).toEqual([]);
  });
});

describe("evaluateSensitiveReadCoverage - call sites", () => {
  const module = payrollModule(ALL_READS);

  test("a route that guards compensation.read and calls the audit passes", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [
        route(
          "compensation",
          "read",
          AUDIT_CALL("hr_payroll.compensation.read")
        )
      ],
      ["src/pages/api/v1/payroll/compensation.ts"]
    );

    expect(result.unauditedRoutes).toEqual([]);
    expect(result.coveredGuardCount).toBe(1);
    expect(result.valid).toBe(true);
  });

  test.each([
    ["compensation", "read"],
    ["runs", "read"],
    ["payslips", "read"]
  ])(
    "a route that guards %s.%s and does NOT call the audit fails the gate",
    (activity, action) => {
      const result = evaluateSensitiveReadCoverage(
        [module],
        [route(activity, action, "const rows = [];")],
        ["src/pages/api/v1/payroll/x.ts"]
      );

      expect(result.valid).toBe(false);
      expect(result.unauditedRoutes).toEqual([
        {
          permission: `hr_payroll.${activity}.${action}`,
          source: "src/pages/api/v1/payroll/x.ts"
        }
      ]);
    }
  );

  test("auditing a DIFFERENT permission does not excuse the guarded one", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [route("compensation", "read", AUDIT_CALL("hr_payroll.runs.read"))],
      ["src/pages/api/v1/payroll/x.ts"]
    );

    expect(result.unauditedRoutes).toHaveLength(1);
  });

  test("an audit call that is only in a comment does not count", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [
        route(
          "compensation",
          "read",
          `// ${AUDIT_CALL("hr_payroll.compensation.read").replace(/\n/g, " ")}`
        )
      ],
      ["src/pages/api/v1/payroll/x.ts"]
    );

    expect(result.valid).toBe(false);
  });

  test("a new export route is covered by the module-wide policy: unaudited fails, audited passes", () => {
    const withExport = payrollModule([
      ...ALL_READS,
      { activityCode: "reports", action: "export" }
    ]);

    const bad = evaluateSensitiveReadCoverage(
      [withExport],
      [route("reports", "export", "const rows = [];")],
      ["src/pages/api/v1/payroll/export.ts"]
    );
    const good = evaluateSensitiveReadCoverage(
      [withExport],
      [route("reports", "export", AUDIT_CALL("hr_payroll.reports.export"))],
      ["src/pages/api/v1/payroll/export.ts"]
    );

    expect(bad.unauditedRoutes.map((entry) => entry.permission)).toEqual([
      "hr_payroll.reports.export"
    ]);
    expect(good.valid).toBe(true);
  });

  test("a route guarding a permission with no policy (an ordinary module) is not the gate's business", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [
        `
        import { authorizeInTransaction } from "x";
        const g = await authorizeInTransaction(tx, a, b, c, {
          moduleKey: "blog_content", activityCode: "posts", action: "read"
        });`
      ],
      ["src/pages/api/v1/blog/posts.ts"]
    );

    expect(result.coveredGuardCount).toBe(0);
    expect(result.unauditedRoutes).toEqual([]);
  });
});

describe("evaluateSensitiveReadCoverage - default-deny classification", () => {
  test("a NEW read-shaped payroll permission is unclassified until someone decides", () => {
    const result = evaluateSensitiveReadCoverage(
      [
        payrollModule([
          ...ALL_READS,
          { activityCode: "bonuses", action: "read" },
          { activityCode: "bonuses", action: "list" },
          { activityCode: "bonuses", action: "create" }
        ])
      ],
      []
    );

    expect(result.valid).toBe(false);
    expect(result.unclassified.sort()).toEqual([
      "hr_payroll.bonuses.list",
      "hr_payroll.bonuses.read"
    ]);
  });

  test("a new export or download permission needs no new entry: the module-wide policy classifies it", () => {
    const result = evaluateSensitiveReadCoverage(
      [
        payrollModule([
          ...ALL_READS,
          { activityCode: "bonuses", action: "export" },
          { activityCode: "bonuses", action: "download" }
        ])
      ],
      []
    );

    expect(result.unclassified).toEqual([]);
  });

  test("every shipped exemption names a reason, and none of them is also a policy", () => {
    for (const [key, reason] of Object.entries(NOT_SENSITIVE_READS)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(findSensitiveReadPolicy(key)).toBeUndefined();
    }
  });

  test("a policy or exemption for a permission the existing module does not declare is a dead entry", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule([{ activityCode: "compensation", action: "read" }])],
      []
    );

    expect(result.valid).toBe(false);
    expect(result.deadEntries.join("\n")).toContain(
      "hr_payroll.runs.read (policy"
    );
    expect(result.deadEntries.join("\n")).toContain(
      "hr_payroll.periods.read (exemption"
    );
  });

  test("an exemption that a policy also covers is a conflict", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(ALL_READS)],
      [],
      [],
      {
        notSensitive: {
          ...NOT_SENSITIVE_READS,
          "hr_payroll.compensation.read": "contradicts the policy for it"
        }
      }
    );

    expect(result.conflictingExemptions).toEqual([
      "hr_payroll.compensation.read"
    ]);
  });
});

describe("the live repository", () => {
  test("passes today: hr_payroll does not exist, so there is nothing yet to audit or to classify", () => {
    const result = evaluateSensitiveReadCoverage(listModules(), []);

    expect(listModules().some((module) => module.key === "hr_payroll")).toBe(
      false
    );
    expect(result.valid).toBe(true);
    expect(SENSITIVE_READ_POLICIES.length).toBeGreaterThanOrEqual(5);
  });
});

describe("crossedDecade", () => {
  test("is true exactly when a power of ten (from the floor) is first reached", () => {
    expect(crossedDecade(9, 10, 10)).toBe(true);
    expect(crossedDecade(10, 11, 10)).toBe(false);
    expect(crossedDecade(99, 100, 10)).toBe(true);
    expect(crossedDecade(0, 150, 100)).toBe(true);
    expect(crossedDecade(0, 99, 100)).toBe(false);
    expect(crossedDecade(50, 5000, 100)).toBe(true);
    expect(crossedDecade(100, 100, 100)).toBe(false);
  });
});
