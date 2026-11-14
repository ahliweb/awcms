/**
 * Issue #1276: a registered, reasoned exception list for pay-word table names
 * that are not payroll. FAIL-CLOSED: the registered list is empty, an exception
 * is exact (plus `<table>_...` objects), and it cannot launder a look-alike.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  NON_PAYROLL_TABLE_NAME_EXCEPTIONS,
  assertNonPayrollExceptionsValid,
  assertNotPayrollTable,
  isPayrollTable,
  validateNonPayrollExceptions
} from "../src/modules/_shared/payroll-data-boundary";

const REFUND = "awcms_shop_refund_compensations";
const EXC = {
  [REFUND]:
    "store refund: goods or credit given instead of a cash refund, no employee"
};

describe("NON_PAYROLL_TABLE_NAME_EXCEPTIONS (#1276)", () => {
  test("without the entry, the refund-shaped name is refused", () => {
    expect(isPayrollTable(REFUND, {})).toBe(true);
  });

  test("the registered list is empty and valid", () => {
    expect(Object.keys(NON_PAYROLL_TABLE_NAME_EXCEPTIONS)).toEqual([]);
    expect(
      validateNonPayrollExceptions(NON_PAYROLL_TABLE_NAME_EXCEPTIONS)
    ).toEqual([]);
  });

  test("an exact exception is honoured, schema-qualified and quoted too", () => {
    expect(isPayrollTable(REFUND, EXC)).toBe(false);
    expect(isPayrollTable(`"public"."${REFUND.toUpperCase()}"`, EXC)).toBe(
      false
    );
  });

  test("objects named <table>_... inherit it", () => {
    expect(isPayrollTable(`${REFUND}_pkey`, EXC)).toBe(false);
    expect(isPayrollTable(`${REFUND}_tenant_idx`, EXC)).toBe(false);
  });

  test("real pay tables stay refused with the exception registered", () => {
    for (const name of [
      "awcms_hr_payroll_runs",
      "awcms_hr_compensations",
      "awcms_hr_employee_compensation",
      "awcms_hr_payslips",
      "awcms_hr_commission_accruals"
    ]) {
      expect(isPayrollTable(name, EXC)).toBe(true);
    }
  });

  test("the exception cannot launder a similarly named table", () => {
    for (const name of [
      "awcms_hr_payroll_shop_refund_compensations",
      "awcms_hr_shop_refund_compensations",
      "awcms_shop_refund_compensation",
      `${REFUND}_payroll_runs`,
      `${REFUND}_salary_history`
    ]) {
      expect(isPayrollTable(name, EXC)).toBe(true);
    }
  });

  test("validation rejects a missing reason, a required table and a non-hit", () => {
    expect(validateNonPayrollExceptions({ [REFUND]: "short" })).not.toEqual([]);
    expect(
      validateNonPayrollExceptions({
        awcms_hr_commission_accruals: "a reason that is long enough to pass"
      })
    ).not.toEqual([]);
    expect(
      validateNonPayrollExceptions({
        awcms_plain_table: "a reason that is long enough to pass"
      })
    ).not.toEqual([]);
    expect(validateNonPayrollExceptions(EXC)).toEqual([]);
  });

  test("the default (registered) behaviour is unchanged", () => {
    expect(isPayrollTable(REFUND)).toBe(true);
    expect(() => assertNotPayrollTable(REFUND, "t")).toThrow();
  });
});

describe("exception hardening (#1276 audit)", () => {
  const LONG = "a reason that is long enough to pass the validator";

  test("an entry that is a prefix of a known payroll table is refused", () => {
    for (const name of [
      "awcms_hr_payroll",
      "awcms_hr_compensation",
      "awcms_hr_payroll_run_lines"
    ]) {
      const problems = validateNonPayrollExceptions({ [name]: LONG });
      expect(problems.some((p) => /prefix of, a known payroll/.test(p))).toBe(
        true
      );
    }
  });

  test("a bare-prefix entry cannot free the payroll family tables", () => {
    const loose = { awcms_hr_payroll: LONG, awcms_hr_compensation: LONG };

    for (const name of [
      "awcms_hr_payroll_runs",
      "awcms_hr_payroll_runs_pkey",
      "awcms_hr_payroll_run_lines",
      "awcms_hr_payroll_employee_items",
      "awcms_hr_compensation_employee_amounts",
      "awcms_hr_compensation_employee_amounts_tenant_idx"
    ]) {
      expect(isPayrollTable(name, loose)).toBe(true);
    }
  });

  test("only catalog objects inherit", () => {
    expect(isPayrollTable(`${REFUND}_tenant_id_fkey`, EXC)).toBe(false);
    expect(isPayrollTable(`${REFUND}_status_check`, EXC)).toBe(false);
    // A sibling table, a view or a function of that name is not a catalog suffix.
    expect(isPayrollTable(`${REFUND}_summary`, EXC)).toBe(true);
    expect(isPayrollTable(`${REFUND}_lines`, EXC)).toBe(true);
    expect(isPayrollTable(`${REFUND}_lines_pkey`, EXC)).toBe(true);
  });

  test("the singular/plural boundary: an entry never frees a longer word", () => {
    const e = { awcms_x_payroll: LONG };
    expect(isPayrollTable("awcms_x_payroll", e)).toBe(false);
    expect(isPayrollTable("awcms_x_payrolls", e)).toBe(true);
    expect(isPayrollTable("awcms_x_payrolls_tenant_idx", e)).toBe(true);
    expect(isPayrollTable("awcms_x_payroll_tenant_idx", e)).toBe(false);
    expect(isPayrollTable("awcms_x_payrollish_pkey", e)).toBe(
      isPayrollTable("awcms_x_payrollish_pkey", {})
    );
    expect(isPayrollTable("awcms_x_payroll2", e)).toBe(
      isPayrollTable("awcms_x_payroll2", {})
    );
  });

  test("the validator refuses upper case, schema-qualified and quoted names", () => {
    for (const name of [
      "AWCMS_SHOP_REFUND_COMPENSATIONS",
      "public.awcms_shop_refund_compensations",
      '"awcms_shop_refund_compensations"'
    ]) {
      expect(
        validateNonPayrollExceptions({ [name]: LONG }).some((p) =>
          /exact, lower-case, schema-less/.test(p)
        )
      ).toBe(true);
    }
  });

  test("assertNonPayrollExceptionsValid throws on a bad list and is silent on a good one", () => {
    expect(() => assertNonPayrollExceptionsValid({ [REFUND]: "x" })).toThrow(
      /invalid/
    );
    expect(() =>
      assertNonPayrollExceptionsValid({ awcms_hr_payroll: LONG })
    ).toThrow(/invalid/);
    expect(() => assertNonPayrollExceptionsValid(EXC)).not.toThrow();
  });

  test("the module validates the registered list AT LOAD", () => {
    const source = readFileSync(
      new URL(
        "../src/modules/_shared/payroll-data-boundary.ts",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toMatch(
      /^assertNonPayrollExceptionsValid\(NON_PAYROLL_TABLE_NAME_EXCEPTIONS\);$/m
    );
  });
});
