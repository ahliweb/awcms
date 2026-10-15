/**
 * The commission accrual POST returns a stored accrual (amount, status) on a
 * replay, which is a READ of someone's earnings (#978 re-audit L-A). Both replay
 * paths audit it, and the gate's blind spots found in the same re-audit (M-A)
 * are closed.
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

describe("POST /api/v1/hr-commission/accruals audits both replay paths", () => {
  test("the replayed-outcome branch calls the read audit for accruals.read", () => {
    expect(POST_ROUTE).toMatch(
      /result\.outcome === "replayed"[\s\S]*?auditAccrualReplayRead\(/
    );
  });

  test("an Idempotency-Key replay (stored body, produce never runs) is hooked too", () => {
    // runIdempotent calls the hook with the stored body BEFORE returning it...
    expect(ROUTE_SUPPORT).toMatch(
      /await onStoredReplay\?\.\(existing\.responseBody\);\s*return jsonResponse\(existing\.responseBody/
    );
    // ...and the POST passes one that records the stored accrual's id.
    expect(POST_ROUTE).toMatch(
      /async \(storedBody\) => \{[\s\S]*?auditAccrualReplayRead\(/
    );
  });

  test("the helper audits under the read policy with the accrual id and a count", () => {
    expect(POST_ROUTE).toMatch(
      /permission: "hr_commission\.accruals\.read",\s*itemCount: 1,\s*resourceIds: \[accrualId\]/
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
