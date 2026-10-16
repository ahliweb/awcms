/**
 * Issue #1083 (follow-up to the #953 review): the HR bulk reads of person-level
 * workforce facts are audited sensitive reads, the gate holds the module to
 * that, and a suppressed aggregate group no longer names its office.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { listModules } from "../src/modules";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { evaluateSensitiveReadCoverage } from "../src/modules/_shared/sensitive-read-coverage";
import {
  NOT_SENSITIVE_READS,
  SENSITIVE_READ_MODULE_KEYS,
  findSensitiveReadPolicy
} from "../src/modules/_shared/sensitive-reads";

const EMPLOYEES = readFileSync(
  "src/pages/api/v1/hr-workforce/workforce-metrics/employees.ts",
  "utf8"
);
const GROUPS = readFileSync(
  "src/pages/api/v1/hr-workforce/workforce-metrics/groups.ts",
  "utf8"
);
const ATTENDANCE = readFileSync(
  "src/pages/api/v1/hr-workforce/attendance-events/index.ts",
  "utf8"
);

describe("policy and gate coverage for hr_workforce", () => {
  test("hr_workforce is a sensitive-read module", () => {
    expect(SENSITIVE_READ_MODULE_KEYS).toContain("hr_workforce");
  });

  test("workforce_metrics.read has the sensitive_read.workforce_metrics policy, coalesced and ids-only", () => {
    const policy = findSensitiveReadPolicy(
      "hr_workforce.workforce_metrics.read"
    );

    expect(policy?.kind).toBe("sensitive_read.workforce_metrics");
    expect(policy?.coalesceWindowSeconds).toBeGreaterThan(0);
  });

  test("every read-shaped hr_workforce permission is classified: policy or reasoned exemption", () => {
    const module = listModules().find((entry) => entry.key === "hr_workforce")!;
    const reads = (module.permissions ?? [])
      .map((p) => `${module.key}.${p.activityCode}.${p.action}`)
      .filter((key) => /\.(read|analyze)$/.test(key));

    expect(reads.length).toBeGreaterThan(0);

    for (const key of reads) {
      const covered =
        findSensitiveReadPolicy(key) !== undefined ||
        (NOT_SENSITIVE_READS[key] ?? "").length > 20;

      expect(`${key}: ${covered}`).toBe(`${key}: true`);
    }
  });

  test("the gate is clean over the real module and the real hr_workforce routes", () => {
    const names = [
      "src/pages/api/v1/hr-workforce/workforce-metrics/employees.ts",
      "src/pages/api/v1/hr-workforce/workforce-metrics/groups.ts",
      "src/pages/api/v1/hr-workforce/attendance-events/index.ts",
      "src/modules/hr-workforce/domain/hr-workforce-permissions.ts"
    ];
    const sources = [
      EMPLOYEES,
      GROUPS,
      ATTENDANCE,
      readFileSync(names[3]!, "utf8")
    ];
    const result = evaluateSensitiveReadCoverage(listModules(), sources, names);

    expect(result.unauditedRoutes).toEqual([]);
    expect(result.computedGuards).toEqual([]);
    expect(result.unclassified).toEqual([]);
    expect(result.coveredGuardCount).toBeGreaterThanOrEqual(3);
  });
});

describe("the gate reads the any-of array form of authorize", () => {
  const module: ModuleDescriptor = {
    key: "hr_workforce",
    name: "x",
    version: "1.0.0",
    status: "active",
    description: "x",
    dependencies: [],
    permissions: []
  };
  const GUARDS = `
export const G = {
  a: { moduleKey: "hr_workforce", activityCode: "workforce_metrics", action: "analyze" as const },
  b: { moduleKey: "hr_workforce", activityCode: "workforce_metrics", action: "read" as const }
} as const;
`;
  const route = (extra: string) => `
import { G } from "./guards";
export const GET = defineTenantRoute({
  authorize: [
    G.a,
    G.b
  ],
  handler: async ({ tx }) => {
    ${extra}
    return ok([]);
  }
});
`;

  test("an array-form route that guards a covered permission and never audits fails", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [GUARDS, route("")],
      ["src/modules/hr-workforce/domain/g.ts", "src/pages/api/v1/x.ts"]
    );

    expect(result.computedGuards).toEqual([]);
    expect(
      result.unauditedRoutes.map((route) => route.permission).sort()
    ).toEqual([
      "hr_workforce.workforce_metrics.analyze",
      "hr_workforce.workforce_metrics.read"
    ]);
  });

  test("L-5: an inline guard object inside the array is parsed once, not fragmented into bogus references", () => {
    const inline = `
export const GET = defineTenantRoute({
  authorize: [
    { moduleKey: "hr_workforce", activityCode: "workforce_metrics", action: "read" },
    { moduleKey: "hr_workforce", activityCode: "workforce_metrics", action: "analyze" }
  ],
  handler: async ({ tx }) => ok([])
});
`;
    const result = evaluateSensitiveReadCoverage(
      [module],
      [inline],
      ["src/pages/api/v1/y.ts"]
    );

    expect(result.computedGuards).toEqual([]);
    expect(
      result.unauditedRoutes.map((route) => route.permission).sort()
    ).toEqual([
      "hr_workforce.workforce_metrics.analyze",
      "hr_workforce.workforce_metrics.read"
    ]);
  });

  test("the same route with the audit call passes", () => {
    const result = evaluateSensitiveReadCoverage(
      [module],
      [
        GUARDS,
        route(
          `await recordSensitiveRead(tx, { permission: "hr_workforce.workforce_metrics.read" });
           await recordSensitiveRead(tx, { permission: "hr_workforce.workforce_metrics.analyze" });`
        )
      ],
      ["src/modules/hr-workforce/domain/g.ts", "src/pages/api/v1/x.ts"]
    );

    expect(result.unauditedRoutes).toEqual([]);
  });
});

describe("route behaviour contracts (source level; the database proof is in the integration test)", () => {
  test("the per-employee list records the all and reports modes (not mine), ids and a count", () => {
    expect(EMPLOYEES).toMatch(
      /basis\.mode !== "mine"[\s\S]*?recordSensitiveRead\(tx, \{[\s\S]*?permission: "hr_workforce\.workforce_metrics\.read",[\s\S]*?itemCount: page\.employees\.length,[\s\S]*?resourceIds: page\.employees\.map/
    );
  });

  test("the attendance list records the all and reports modes (not mine)", () => {
    expect(ATTENDANCE).toMatch(
      /basis\.mode !== "mine"[\s\S]*?permission: "hr_workforce\.attendance\.read"/
    );
  });

  test("a suppressed aggregate group carries no officeId (L2)", () => {
    expect(GROUPS).toMatch(
      /\{ suppressed: true as const, reason: figure\.reason \}/
    );
    expect(GROUPS).not.toMatch(
      /suppressed: true as const,\s*reason[\s\S]{0,40}officeId/
    );
  });
});

describe("Issue #1083 M-1, L-1, L-2, L-4 contracts", () => {
  const CORRECTIONS_LIST = readFileSync(
    "src/pages/api/v1/hr-workforce/attendance-corrections/index.ts",
    "utf8"
  );
  const CORRECTION_ONE = readFileSync(
    "src/pages/api/v1/hr-workforce/attendance-corrections/[id].ts",
    "utf8"
  );

  test("corrections.read is a policy, not an exemption", () => {
    expect(findSensitiveReadPolicy("hr_workforce.corrections.read")?.kind).toBe(
      "sensitive_read.attendance_corrections"
    );
    expect(
      NOT_SENSITIVE_READS["hr_workforce.corrections.read"]
    ).toBeUndefined();
  });

  test("the list records all and reports; the single record only on the role grant", () => {
    expect(CORRECTIONS_LIST).toMatch(
      /basis\.mode !== "mine"[\s\S]*?permission: "hr_workforce\.corrections\.read"/
    );
    expect(CORRECTION_ONE).toMatch(
      /if \(roleGrant\)[\s\S]*?permission: "hr_workforce\.corrections\.read"[\s\S]*?mode: "role_grant"/
    );
    expect(CORRECTION_ONE).toMatch(/const roleGrant =\s*!ownReason/);
  });

  test("the aggregate records the permission that actually granted (L-1)", () => {
    expect(GROUPS).toContain(
      'permission: "hr_workforce.workforce_metrics.analyze"'
    );
    expect(GROUPS).toContain(
      'permission: "hr_workforce.workforce_metrics.read"'
    );
    expect(
      findSensitiveReadPolicy("hr_workforce.workforce_metrics.analyze")?.kind
    ).toBe("sensitive_read.workforce_metrics_aggregate");
  });

  test("the evidence audit row carries the employment ids (L-2)", () => {
    const evidence = readFileSync(
      "src/pages/api/v1/hr-workforce/geolocation/evidence.ts",
      "utf8"
    );

    expect(evidence).toMatch(/employmentIds: page\.evidence\.map/);
  });

  test("the attendance policy's ids are employment ids (L-4)", () => {
    expect(
      findSensitiveReadPolicy("hr_workforce.attendance.read")?.resourceType
    ).toBe("hr_employment");
  });
});
