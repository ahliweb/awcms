/**
 * The commission accrual POST used to return a stored accrual (amount, status)
 * on a replay, which was a READ of someone's earnings that had to be audited
 * (#978 re-audit L-A). Since Issue #1095 (owner decision K3) it returns the
 * MASKED receipt instead, on a first accrual and on both replay paths, and
 * stores the receipt for its Idempotency-Key, so a replay reads nobody's
 * earnings and needs no read audit. The gate's blind spots found in the same
 * re-audit (M-A) stay closed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { evaluateSensitiveReadCoverage } from "../src/modules/_shared/sensitive-read-coverage";

const POST_ROUTE = readFileSync(
  "src/pages/api/v1/hr-commission/accruals/index.ts",
  "utf8"
);
const ROUTE_SUPPORT = readFileSync(
  "src/modules/hr-commission/application/hr-commission-route-support.ts",
  "utf8"
);

describe("POST /api/v1/hr-commission/accruals returns the masked receipt on every path (Issue #1095)", () => {
  test("the body is the receipt, never the stored accrual", () => {
    expect(POST_ROUTE).toMatch(
      /accrual: toMutationReceipt\(stored!\.accrual\)/
    );
    expect(POST_ROUTE).not.toMatch(/accrual: stored!\.accrual/);
  });

  test("a body stored before the masking is projected on replay, before it is returned", () => {
    expect(POST_ROUTE).toMatch(/projectStoredAccrueBody\s*\)/);
    expect(ROUTE_SUPPORT).toMatch(
      /projectStoredBody\s*\?\s*projectStoredBody\(existing\.responseBody\)\s*:\s*existing\.responseBody/
    );
  });

  test("no replay read audit is left behind: a masked replay reads no earnings", () => {
    expect(POST_ROUTE).not.toContain("auditAccrualReplayRead");
  });

  test("the GET list still records the sensitive read it always did", () => {
    expect(POST_ROUTE).toMatch(
      /recordSensitiveRead\(tx, \{[\s\S]*?permission: "hr_commission\.accruals\.read"/
    );
  });
});

const payroll: ModuleDescriptor = {
  key: "hr_payroll",
  name: "x",
  version: "1.0.0",
  status: "active",
  description: "x",
  dependencies: [],
  permissions: []
};

const unresolvable = (guard: string, name = "src/pages/api/v1/hr/p.ts") =>
  evaluateSensitiveReadCoverage(
    [payroll],
    [
      `// hr_payroll\nexport const GET = defineTenantRoute({\n  ${guard}\n  handler\n});`
    ],
    [name]
  ).computedGuards;

describe("M-A: a guard shape the gate cannot parse is REPORTED, not skipped", () => {
  test.each([
    ["a ternary", "authorize: flag ? A.read : B.read,"],
    ["a parenthesised expression", "authorize: (A.read),"],
    ["a bracket access", 'authorize: GUARDS["compensation"].read,'],
    ["a call", "authorize: pick(req),"],
    ["a multi-line value", "authorize:"],
    ["the shorthand", "authorize,"]
  ])("%s", (_label, guard) => {
    expect(unresolvable(guard)).not.toEqual([]);
  });

  test("a plain resolvable-shaped path with no definition is reported as unresolved, an inline object is not", () => {
    expect(unresolvable("authorize: NOWHERE.read,")).not.toEqual([]);
    expect(
      unresolvable(
        'authorize: { moduleKey: "blog_content", activityCode: "posts", action: "read" },'
      )
    ).toEqual([]);
  });

  test("a file that is not about a sensitive module is not held to it", () => {
    expect(
      evaluateSensitiveReadCoverage(
        [payroll],
        [
          `export const GET = defineTenantRoute({ authorize: flag ? A : B, handler });`
        ],
        ["src/pages/api/v1/blog.ts"]
      ).computedGuards
    ).toEqual([]);
  });
});

describe("M-A: table names are matched case-insensitively", () => {
  test.each(["AWCMS_HR_PAYSLIPS", "Awcms_Hr_Compensation"])(
    "%s in a source is still a payroll reader",
    (table) => {
      const result = evaluateSensitiveReadCoverage(
        [payroll],
        [`export const q = "SELECT * FROM ${table}";`],
        ["src/modules/anything/export.ts"]
      );

      expect(result.unauditedTableReaders).toHaveLength(1);
    }
  );
});
