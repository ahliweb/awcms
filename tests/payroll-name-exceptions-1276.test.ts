/**
 * Issue #1276: a registered, reasoned exception list for pay-word table names
 * that are not payroll. FAIL-CLOSED: the registered list is empty, an exception
 * is exact (plus `<table>_...` objects), and it cannot launder a look-alike.
 */
import { describe, expect, test } from "bun:test";

import {
  NON_PAYROLL_TABLE_NAME_EXCEPTIONS,
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
