import { describe, expect, test } from "bun:test";

import {
  isPayrollBoundaryTable,
  type ExportedTable,
  storedRowIds,
  stripPayrollRows
} from "../src/modules/data-lifecycle/domain/subject-export-payroll";

describe("payroll-boundary classification of an export table (Issue #1018, L1)", () => {
  test("by NAME", () => {
    expect(
      isPayrollBoundaryTable({ tableName: "awcms_hr_commission_accruals" })
    ).toBe(true);
    expect(isPayrollBoundaryTable({ tableName: "awcms_hr_payslips" })).toBe(
      true
    );
  });

  test("by OWNER MODULE, for a table whose name the patterns do not know", () => {
    // A commission RULE names no person's pay, so no name pattern catches it,
    // yet it belongs to a payroll module.
    expect(
      isPayrollBoundaryTable({
        tableName: "awcms_hr_commission_rules",
        ownerModuleKey: "hr_commission"
      })
    ).toBe(true);
    // A table renamed to dodge the name patterns still has its owner.
    expect(
      isPayrollBoundaryTable({
        tableName: "awcms_hr_ledger_lines",
        ownerModuleKey: "hr_payroll"
      })
    ).toBe(true);
  });

  test("an ordinary table is not", () => {
    expect(
      isPayrollBoundaryTable({
        tableName: "awcms_hr_employments",
        ownerModuleKey: "hr_workforce"
      })
    ).toBe(false);
    expect(isPayrollBoundaryTable({})).toBe(false);
  });
});

describe("what the idempotency store may keep of an export (audit M2)", () => {
  const tables = [
    {
      key: "hr_commission.accruals",
      tableName: "awcms_hr_commission_accruals",
      ownerModuleKey: "hr_commission",
      rows: [
        { id: "11111111-1111-4111-8111-111111111111", amount: "19.425" },
        { id: "22222222-2222-4222-8222-222222222222", amount: "2.5" }
      ]
    },
    {
      key: "hr_workforce.employments",
      tableName: "awcms_hr_employments",
      ownerModuleKey: "hr_workforce",
      rows: [{ id: "33333333-3333-4333-8333-333333333333", employee_no: "E-1" }]
    }
  ];

  test("payroll rows become ids and a marker; nothing else changes", () => {
    const stored = stripPayrollRows<ExportedTable>(tables);

    expect(JSON.stringify(stored)).not.toContain("19.425");
    expect(stored[0]!.rows).toEqual([]);
    expect(stored[0]!.payrollRowsStripped).toBe(true);
    expect(storedRowIds(stored[0]!)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ]);
    expect(stored[1]).toEqual(tables[1]!);
  });

  test("the input is not mutated", () => {
    stripPayrollRows(tables);
    expect(tables[0]!.rows).toHaveLength(2);
  });

  test("a table owned by a payroll module is stripped even when its name is unknown", () => {
    const stored = stripPayrollRows([
      {
        key: "hr_commission.rules",
        tableName: "awcms_hr_commission_rules",
        ownerModuleKey: "hr_commission",
        rows: [{ id: "44444444-4444-4444-8444-444444444444", rate: "7.77" }]
      }
    ]);

    expect(JSON.stringify(stored)).not.toContain("7.77");
  });
});
