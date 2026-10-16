/**
 * The bypasses the #978 security audit (M1, M2) found in the first version of
 * the sensitive-reads gate and the payroll boundary. Each case plants the
 * bypass and asserts it is refused; the clean twins make sure the gate is not
 * simply red about everything.
 */
import { describe, expect, test } from "bun:test";

import { findPayrollSqlLeaks } from "../scripts/payroll-sql-boundary-check";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  collectGuardDefinitions,
  findSwallowedSensitiveReads,
  evaluateSensitiveReadCoverage
} from "../src/modules/_shared/sensitive-read-coverage";

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

const BASE = [
  { activityCode: "compensation", action: "read" },
  { activityCode: "runs", action: "read" },
  { activityCode: "payslips", action: "read" },
  { activityCode: "periods", action: "read" },
  { activityCode: "rules", action: "read" },
  { activityCode: "sod_policy", action: "read" },
  { activityCode: "payout_accounts", action: "read" },
  { activityCode: "payout_accounts", action: "reveal" }
];

const GUARDS_FILE = `
export const PAYROLL_GUARDS = {
  compensation: {
    read: { moduleKey: "hr_payroll", activityCode: "compensation", action: "read" as const }
  },
  runs: {
    read: { moduleKey: "hr_payroll", activityCode: "runs", action: "read" as const }
  }
} as const;
`;

describe("guards written the way ~160 routes write them: authorize: GUARDS.x.y", () => {
  test("definitions are resolved by dotted path", () => {
    expect(collectGuardDefinitions(GUARDS_FILE)).toEqual(
      new Map([
        ["PAYROLL_GUARDS.compensation.read", "hr_payroll.compensation.read"],
        ["PAYROLL_GUARDS.runs.read", "hr_payroll.runs.read"]
      ])
    );
  });

  const route = (extra: string) => `
import { PAYROLL_GUARDS } from "../../../modules/hr-payroll/domain/guards";
export const GET = defineTenantRoute({
  authorize: PAYROLL_GUARDS.compensation.read,
  handler: async ({ tx, tenantId, auth }) => {
    ${extra}
    return ok([]);
  }
});
`;

  test("a route using a guard CONSTANT with no audit call fails (the first gate was blind to this)", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [GUARDS_FILE, route("")],
      ["src/modules/hr-payroll/domain/guards.ts", "src/pages/api/v1/p.ts"]
    );

    expect(result.unauditedRoutes).toEqual([
      {
        permission: "hr_payroll.compensation.read",
        source: "src/pages/api/v1/p.ts"
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("the same route with the audit call passes, and the definitions file is not mistaken for a handler", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [
        GUARDS_FILE,
        route(
          `await recordSensitiveRead(tx, { tenantId, actorTenantUserId: auth.context.tenantUserId, permission: "hr_payroll.compensation.read" });`
        )
      ],
      ["src/modules/hr-payroll/domain/guards.ts", "src/pages/api/v1/p.ts"]
    );

    expect(result.unauditedRoutes).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("M1(1): default-deny over ALL actions of a sensitive module", () => {
  test.each(["view", "print", "show", "fetch", "preview", "download", "dump"])(
    "an unclassified %s permission fails",
    (action) => {
      const result = evaluateSensitiveReadCoverage(
        [payrollModule([...BASE, { activityCode: "runs", action }])],
        []
      );

      // `download` has a module-wide policy; every other verb is read-shaped
      // until someone decides.
      expect(result.unclassified).toEqual(
        action === "download" ? [] : [`hr_payroll.runs.${action}`]
      );
    }
  );

  test("write-shaped actions need no entry", () => {
    const result = evaluateSensitiveReadCoverage(
      [
        payrollModule([
          ...BASE,
          { activityCode: "runs", action: "approve" },
          { activityCode: "runs", action: "finalise" },
          { activityCode: "compensation", action: "create" }
        ])
      ],
      []
    );

    expect(result.unclassified).toEqual([]);
  });

  test("reveal is classified by a reasoned exemption, not by being forgotten", () => {
    const without = BASE.filter((entry) => entry.action !== "reveal");
    const result = evaluateSensitiveReadCoverage(
      [payrollModule([...without, { activityCode: "x", action: "reveal" }])],
      []
    );

    expect(result.unclassified).toEqual(["hr_payroll.x.reveal"]);
  });
});

describe("M1(2): a guard the gate cannot read is a failure in a sensitive file", () => {
  test("an authorize reference that resolves to nothing", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [
        `import x from "../hr-payroll/y";
         export const GET = defineTenantRoute({ authorize: buildGuard(), handler });`
      ],
      ["src/pages/api/v1/p.ts"]
    );

    expect(result.computedGuards.join("\n")).toContain("resolves to no static");
    expect(result.valid).toBe(false);
  });

  test("a computed activityCode", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [
        `// hr_payroll
         const guard = { moduleKey: "hr_payroll", activityCode: activityFor(req), action: "read" };
         await authorizeInTransaction(tx, a, b, c, guard);`
      ],
      ["src/pages/api/v1/p.ts"]
    );

    expect(result.computedGuards.join("\n")).toContain("activityCode is");
  });

  test("a file unrelated to a sensitive module is not held to it", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [
        `export const GET = defineTenantRoute({ authorize: buildGuard(), handler });`
      ],
      ["src/pages/api/v1/blog.ts"]
    );

    expect(result.computedGuards).toEqual([]);
  });
});

describe("M1(3): a file that names a payroll-boundary table must audit or be exempt", () => {
  const reader = `export async function leak(tx) { return tx\`SELECT * FROM awcms_hr_payslips\`; }`;

  test("an unaudited reader fails", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [reader],
      ["src/modules/anything/export.ts"]
    );

    expect(result.unauditedTableReaders).toEqual([
      {
        source: "src/modules/anything/export.ts",
        tables: ["awcms_hr_payslips"]
      }
    ]);
  });

  test("calling recordSensitiveRead clears it", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [
        `${reader}
         await recordSensitiveRead(tx, { permission: "hr_payroll.payslips.read" });`
      ],
      ["src/modules/anything/export.ts"]
    );

    expect(result.unauditedTableReaders).toEqual([]);
  });

  test("a reasoned exemption clears it, and a module.ts is descriptor-only", () => {
    const withExemption = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [reader],
      ["src/modules/anything/export.ts"],
      { tableSourceExemptions: { "src/modules/anything/export.ts": "because" } }
    );
    const moduleFile = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [reader],
      ["src/modules/anything/module.ts"]
    );

    expect(withExemption.unauditedTableReaders).toEqual([]);
    expect(moduleFile.unauditedTableReaders).toEqual([]);
  });

  test("an exemption for a scanned file that no longer needs it is stale", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [`export const x = 1;`],
      ["src/modules/anything/clean.ts"],
      { tableSourceExemptions: { "src/modules/anything/clean.ts": "old" } }
    );

    expect(result.staleSourceExemptions).toEqual([
      "src/modules/anything/clean.ts"
    ]);
  });

  test("a comment that mentions a table is not a reader", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [`// reads awcms_hr_payslips elsewhere\nexport const x = 1;`],
      ["src/modules/anything/clean.ts"]
    );

    expect(result.unauditedTableReaders).toEqual([]);
  });
});

describe("M2: the SQL boundary (views, CREATE TABLE AS, foreign triggers)", () => {
  const file = (sql: string) => [{ name: "999_test.sql", sql }];

  test("a harmless-named view over a payroll table is refused", () => {
    expect(
      findPayrollSqlLeaks(
        file(
          "CREATE VIEW awcms_staff_overview AS SELECT employment_id, base_amount FROM awcms_hr_compensation;"
        )
      ).join("\n")
    ).toContain("view awcms_staff_overview reads awcms_hr_compensation");
  });

  test("so is a materialised view, and OR REPLACE", () => {
    expect(
      findPayrollSqlLeaks(
        file(
          "CREATE MATERIALIZED VIEW IF NOT EXISTS awcms_x AS SELECT * FROM awcms_hr_payslips;"
        )
      )
    ).toHaveLength(1);
    expect(
      findPayrollSqlLeaks(
        file(
          "CREATE OR REPLACE VIEW awcms_y AS SELECT 1 FROM awcms_hr_payroll_runs;"
        )
      )
    ).toHaveLength(1);
  });

  test("CREATE TABLE ... AS SELECT is refused; an ordinary CREATE TABLE is not", () => {
    expect(
      findPayrollSqlLeaks(
        file("CREATE TABLE awcms_copy AS SELECT * FROM awcms_hr_payslips;")
      )
    ).toHaveLength(1);
    expect(
      findPayrollSqlLeaks(
        file(
          "CREATE TABLE awcms_ok (id uuid, total numeric GENERATED ALWAYS AS (1 + 1) STORED, ref uuid REFERENCES awcms_hr_payslips (id));"
        )
      )
    ).toEqual([]);
  });

  test("the way out is naming the relation in the payroll family", () => {
    expect(
      findPayrollSqlLeaks(
        file(
          "CREATE VIEW awcms_hr_payroll_summary AS SELECT * FROM awcms_hr_payroll_run_lines;"
        )
      )
    ).toEqual([]);
  });

  test("a trigger on an ordinary table running a function that reads payroll is refused, across files", () => {
    const failures = findPayrollSqlLeaks([
      {
        name: "1.sql",
        sql: `CREATE FUNCTION awcms_audit_fn() RETURNS trigger AS $$
              BEGIN PERFORM 1 FROM awcms_hr_compensation; RETURN NEW; END; $$ LANGUAGE plpgsql;`
      },
      {
        name: "2.sql",
        sql: `CREATE TRIGGER t AFTER INSERT ON awcms_blog_posts
              FOR EACH ROW EXECUTE FUNCTION awcms_audit_fn();`
      }
    ]);

    expect(failures.join("\n")).toContain("trigger t on awcms_blog_posts");
  });

  test("a trigger on a payroll table running a payroll-family function is the module's own business", () => {
    expect(
      findPayrollSqlLeaks([
        {
          name: "1.sql",
          sql: `CREATE FUNCTION awcms_hr_payslips_guard() RETURNS trigger AS $body$ BEGIN PERFORM 1 FROM awcms_hr_payslips; RETURN NEW; END; $body$ LANGUAGE plpgsql;
                CREATE TRIGGER t BEFORE UPDATE ON awcms_hr_payslips FOR EACH ROW EXECUTE FUNCTION awcms_hr_payslips_guard();`
        }
      ])
    ).toEqual([]);
  });

  test("the repository's own migrations pass", () => {
    const { loadMigrations } = require("../scripts/lib/migrations");

    expect(
      findPayrollSqlLeaks(
        loadMigrations().map((m: { name: string; sql: string }) => ({
          name: m.name,
          sql: m.sql
        }))
      )
    ).toEqual([]);
  });
});

describe("the audit call must fail closed (audit L6)", () => {
  const CALL = `recordSensitiveRead(tx, { tenantId, actorTenantUserId: a, permission: "hr_payroll.runs.read" })`;

  test.each([
    [
      "try/catch that returns data",
      `try { await ${CALL}; } catch (e) { log(e); }\nreturn ok(rows);`
    ],
    ["a .catch(() => {})", `await ${CALL}.catch(() => {});`],
    ["not awaited", `${CALL};\nreturn ok(rows);`],
    ["void-ed", `void ${CALL};`],
    [
      "nested in a swallowing try",
      `try { if (x) { await ${CALL}; } } catch { }`
    ]
  ])("%s is refused", (_name, code) => {
    expect(findSwallowedSensitiveReads(code).length).toBeGreaterThan(0);
  });

  test.each([
    ["awaited", `await ${CALL};\nreturn ok(rows);`],
    ["returned from a helper", `return ${CALL};`],
    ["arrow concise body", `const f = (tx) => ${CALL};`],
    [
      "try that rethrows",
      `try { await ${CALL}; } catch (e) { cleanup(); throw e; }`
    ],
    ["try/finally only", `try { await ${CALL}; } finally { done(); }`]
  ])("%s is accepted", (_name, code) => {
    expect(findSwallowedSensitiveReads(code)).toEqual([]);
  });

  test("the evaluator reports it and the result is not valid", () => {
    const result = evaluateSensitiveReadCoverage(
      [payrollModule(BASE)],
      [`try { await ${CALL}; } catch {}`],
      ["src/pages/api/v1/hr-payroll/runs.ts"]
    );

    expect(result.valid).toBe(false);
    expect(result.swallowedAudits.length).toBe(1);
  });
});
