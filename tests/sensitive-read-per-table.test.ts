/**
 * Issue #1015, M-A remainder: the sensitive-reads gate attributes audits PER
 * TABLE, and the exempt ledger's read functions can be imported only by an
 * allow-listed, auditing file. Each case plants the bypass the #978 re-audit
 * described and asserts it is refused; the clean twins keep the gate honest.
 */
import { describe, expect, test } from "bun:test";

import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { evaluateSensitiveReadCoverage } from "../src/modules/_shared/sensitive-read-coverage";
import {
  PAYROLL_TABLE_READ_PERMISSIONS,
  auditCoversPayrollTable,
  findPayrollTableReadMapping
} from "../src/modules/_shared/sensitive-reads";
import { isPayrollTable } from "../src/modules/_shared/payroll-data-boundary";

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

function payrollModule(): ModuleDescriptor {
  return {
    key: "hr_payroll",
    name: "HR payroll",
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    permissions: BASE.map((permission) => ({
      ...permission,
      description: "fixture"
    }))
  };
}

const LEDGER =
  "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts";
const FILE = "src/modules/anything/export.ts";

const audit = (permission: string) =>
  `await recordSensitiveRead(tx, { tenantId, actorTenantUserId: a, permission: "${permission}" });`;
const reads = (...tables: string[]) =>
  `export const q = (tx) => tx\`${tables
    .map((table) => `SELECT * FROM ${table}`)
    .join("; ")}\`;`;

const run = (source: string, extra: object = {}) =>
  evaluateSensitiveReadCoverage([payrollModule()], [source], [FILE], extra);

describe("the mapping", () => {
  test("every payroll-boundary table name pattern maps to a rule, none is silently unmapped", () => {
    for (const table of [
      "awcms_hr_payroll_runs",
      "awcms_hr_payroll_run_lines",
      "awcms_hr_payslips",
      "awcms_hr_compensation",
      "awcms_hr_employee_compensation",
      "awcms_hr_salary_history",
      "awcms_hr_wages",
      "awcms_hr_payout_accounts",
      "awcms_hr_commission_accruals",
      "awcms_hr_commission_transitions"
    ]) {
      expect(isPayrollTable(table)).toBe(true);
      expect(findPayrollTableReadMapping(table)).toBeDefined();
    }
  });

  test("an unmapped name covers nothing", () => {
    expect(
      auditCoversPayrollTable("awcms_unknown", new Set(["a.b.read"]))
    ).toBe(false);
    expect(PAYROLL_TABLE_READ_PERMISSIONS.length).toBeGreaterThan(0);
  });
});

describe("audits are attributed per table, not per file", () => {
  test("auditing compensation.read does not clear a file that also reads payslips", () => {
    const result = run(
      `${reads("awcms_hr_compensation", "awcms_hr_payslips")}\n${audit("hr_payroll.compensation.read")}`
    );

    expect(result.uncoveredTableReaders).toEqual([
      {
        source: FILE,
        tables: ["awcms_hr_payslips"],
        needs: { awcms_hr_payslips: ["hr_payroll.payslips.read"] }
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("auditing each table's own permission clears it", () => {
    const result = run(
      `${reads("awcms_hr_compensation", "awcms_hr_payslips")}\n${audit("hr_payroll.compensation.read")}\n${audit("hr_payroll.payslips.read")}`
    );

    expect(result.uncoveredTableReaders).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("another module's audit does not stand for the table", () => {
    const result = run(
      `${reads("awcms_hr_payslips")}\n${audit("hr_commission.accruals.read")}`
    );

    expect(result.uncoveredTableReaders).toHaveLength(1);
  });

  test("an export audit of the same module covers its tables, one of another module does not", () => {
    expect(
      run(`${reads("awcms_hr_payslips")}\n${audit("hr_payroll.runs.export")}`)
        .uncoveredTableReaders
    ).toEqual([]);
    expect(
      run(
        `${reads("awcms_hr_payslips")}\n${audit("hr_commission.accruals.export")}`
      ).uncoveredTableReaders
    ).toHaveLength(1);
  });

  test("a table no audit call can stand for needs a reasoned source exemption", () => {
    const source = `${reads("awcms_hr_payout_accounts")}\n${audit("hr_payroll.runs.read")}`;

    expect(run(source).uncoveredTableReaders[0]?.needs).toEqual({
      awcms_hr_payout_accounts: []
    });
    expect(
      run(source, {
        tableSourceExemptions: { [FILE]: "reveal audits itself" }
      }).uncoveredTableReaders
    ).toEqual([]);
  });

  test("table names in other cases are attributed too", () => {
    expect(
      run(
        `${reads("AWCMS_HR_PAYSLIPS")}\n${audit("hr_payroll.compensation.read")}`
      ).uncoveredTableReaders
    ).toHaveLength(1);
  });

  test("a table named only in a comment is not a read", () => {
    expect(
      run(
        `// awcms_hr_payslips is read elsewhere\n${audit("hr_payroll.compensation.read")}`
      ).uncoveredTableReaders
    ).toEqual([]);
  });
});

describe("imports of the exempt ledger's read functions", () => {
  const evaluate = (sources: Record<string, string>) =>
    evaluateSensitiveReadCoverage(
      [payrollModule()],
      Object.values(sources),
      Object.keys(sources)
    );
  const importer = (clause: string) =>
    `import ${clause} from "../../../../modules/hr-commission/application/hr-commission-accrual-ledger";\n`;
  const NEW_ROUTE = "src/pages/api/v1/other/route.ts";
  const ALL = [
    "listAccruals",
    "getAccrual",
    "reconcileAccruals",
    "accrueCommission",
    "transitionAccrual"
  ];

  test.each([
    ["a named import", importer("{ listAccruals }"), ["listAccruals"]],
    ["an aliased import", importer("{ getAccrual as g }"), ["getAccrual"]],
    [
      "reconcileAccruals, which returns amounts",
      importer("{ reconcileAccruals }"),
      ["reconcileAccruals"]
    ],
    ["a namespace import", importer("* as ledger"), ALL],
    ["a default import", importer("ledger"), ALL],
    [
      "a re-export",
      `export { listAccruals } from "../hr-commission-accrual-ledger";`,
      ["listAccruals"]
    ],
    [
      "an export-star barrel",
      `export * from "./hr-commission-accrual-ledger";`,
      ALL
    ],
    [
      "a dynamic import",
      `const m = await import("../x/hr-commission-accrual-ledger.ts");`,
      ALL
    ],
    [
      "a multi-line named import",
      `import {\n  accrueCommission,\n  listAccruals\n} from "../../x/hr-commission-accrual-ledger";`,
      ["listAccruals", "accrueCommission"]
    ]
  ])(
    "%s from a file that is not allow-listed is refused",
    (_name, code, functions) => {
      const result = evaluate({ [NEW_ROUTE]: code });

      // A wildcard import (`ALL`) reaches BOTH registered reader sets, the
      // all-accruals readers and the own-only readers (Issue #952, audit M-2);
      // a named import of one reader is exactly one violation.
      expect(result.forbiddenReadImports).toHaveLength(
        functions === ALL ? 2 : 1
      );
      expect(result.forbiddenReadImports[0]!.functions).toEqual(functions);
      expect(result.valid).toBe(false);
    }
  );

  test("a type import is not a read path; a NEW caller of the write-path functions is (Issue #1077, M7)", () => {
    expect(
      evaluate({
        [NEW_ROUTE]:
          importer("type { CommissionAccrual }") +
          importer("{ type AccrualListFilters }")
      }).forbiddenReadImports
    ).toEqual([]);

    const result = evaluate({
      [NEW_ROUTE]: importer("{ accrueCommission, transitionAccrual }")
    });

    expect(result.forbiddenReadImports).toHaveLength(1);
    expect(result.forbiddenReadImports[0]!.functions).toEqual([
      "accrueCommission",
      "transitionAccrual"
    ]);
  });

  test("an allow-listed mutation route needs no read audit, but only while it imports nothing but the write path", () => {
    const route = "src/pages/api/v1/hr-commission/accruals/[id]/approve.ts";

    expect(
      evaluate({ [route]: importer("{ transitionAccrual }") })
        .forbiddenReadImports
    ).toEqual([]);

    const widened = evaluate({
      [route]: importer("{ transitionAccrual, listAccruals }")
    });

    expect(widened.forbiddenReadImports[0]?.problem).toContain(
      "never calls recordSensitiveRead"
    );
  });

  test("an allow-listed importer must itself audit the permission", () => {
    const route = "src/pages/api/v1/hr-commission/accruals/index.ts";
    const bare = evaluate({
      [route]: importer("{ listAccruals, getAccrual }")
    });
    const audited = evaluate({
      [route]: `${importer("{ listAccruals, getAccrual }")}${audit("hr_commission.accruals.read")}`
    });

    expect(bare.forbiddenReadImports[0]?.problem).toContain(
      "never calls recordSensitiveRead"
    );
    expect(audited.forbiddenReadImports).toEqual([]);
  });

  test("an allow-listed file that stopped importing is a stale allowance", () => {
    const result = evaluate({
      "src/pages/api/v1/hr-commission/accruals/index.ts": "export const x = 1;"
    });

    expect(result.staleImportAllowances).toEqual([
      "src/pages/api/v1/hr-commission/accruals/index.ts"
    ]);
  });

  test("the ledger file itself is not its own importer", () => {
    expect(
      evaluate({ [LEDGER]: `export async function listAccruals() {}` })
        .forbiddenReadImports
    ).toEqual([]);
  });
});
