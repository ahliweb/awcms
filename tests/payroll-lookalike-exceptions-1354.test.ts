/**
 * Issue #1354: an exact-name, reasoned exception registry for the catalog
 * layer's `payroll-lookalike` comparison. FAIL-CLOSED: empty by default, exact
 * qualified names only, and an excepted table stays under every other rule.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  NON_PAYROLL_LOOKALIKE_EXCEPTIONS,
  PAYROLL_REQUIRED_FOREIGN_KEYS,
  PAYROLL_REQUIRED_TRIGGERS,
  assertNonPayrollLookalikeExceptionsValid,
  validateNonPayrollLookalikeExceptions
} from "../src/modules/_shared/payroll-data-boundary";
import {
  analysePayrollCatalog,
  type CatalogSnapshot
} from "../scripts/lib/payroll-catalog-boundary";

const ACCRUALS = "public.awcms_hr_commission_accruals";
const TRANSITIONS = "public.awcms_hr_commission_transitions";
const HISTORY = "public.awcms_shop_order_history";
const COPY = "public.awcms_shop_order_history_copy";
const REASON =
  "append-only order-state history; shares generic columns, holds no pay data";
const EXC = { [HISTORY]: REASON };

const columns = Array.from({ length: 12 }, (_, i) => `c${i}:text`);

function snapshot(partial: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    migrationOwner: "owner",
    columns: [],
    foreignKeys: PAYROLL_REQUIRED_FOREIGN_KEYS.map((edge) => ({
      from: `public.${edge.from}`,
      to: `public.${edge.to}`
    })),
    roles: [],
    namedObjects: [],
    rules: [],
    functions: [],
    triggers: Object.entries(PAYROLL_REQUIRED_TRIGGERS).flatMap(
      ([table, names]) =>
        names.map((name) => ({
          relation: `public.${table}`,
          name,
          function: `public.${name}_fn`
        }))
    ),
    grants: [],
    inheritance: [],
    relations: [ACCRUALS, TRANSITIONS].map((name) => ({
      name,
      relkind: "r",
      owner: "owner",
      comment: "payroll-boundary: test"
    })),
    memberships: [],
    publications: [],
    foreignTables: [],
    dependencies: [],
    ...partial
  };
}

const withTables = (...relations: string[]) =>
  snapshot({
    columns: [
      { relation: ACCRUALS, columns },
      ...relations.map((relation) => ({ relation, columns: [...columns] }))
    ]
  });

const codes = (
  s: CatalogSnapshot,
  lookalikeExceptions?: Readonly<Record<string, string>>
) =>
  analysePayrollCatalog(s, lookalikeExceptions ? { lookalikeExceptions } : {})
    .map((finding) => finding.code)
    .sort();

describe("NON_PAYROLL_LOOKALIKE_EXCEPTIONS (#1354)", () => {
  test("the registered list is empty and valid (no behaviour change)", () => {
    expect(Object.keys(NON_PAYROLL_LOOKALIKE_EXCEPTIONS)).toEqual([]);
    expect(
      validateNonPayrollLookalikeExceptions(NON_PAYROLL_LOOKALIKE_EXCEPTIONS)
    ).toEqual([]);
  });

  test("a 70%+ overlapping table is flagged until registered with a reason", () => {
    expect(codes(withTables(HISTORY))).toEqual(["payroll-lookalike"]);
    expect(codes(withTables(HISTORY), EXC)).toEqual([]);
  });

  test("an identical copy under another name is still flagged", () => {
    expect(codes(withTables(HISTORY, COPY), EXC)).toEqual([
      "payroll-lookalike"
    ]);
    // A different schema is a different qualified name.
    expect(codes(withTables("other.awcms_shop_order_history"), EXC)).toEqual([
      "payroll-lookalike"
    ]);
  });

  test("an excepted table stays subject to every other rule", () => {
    const s = withTables(HISTORY);

    s.namedObjects = [
      {
        kind: "index",
        name: "awcms_hr_commission_accruals_pkey",
        relation: HISTORY
      }
    ];

    expect(codes(s, EXC)).toEqual(["payroll-named-object-outside"]);
  });

  test("an empty or short reason fails validation", () => {
    for (const reason of ["", "   ", "short"]) {
      expect(
        validateNonPayrollLookalikeExceptions({ [HISTORY]: reason })
      ).not.toEqual([]);
    }
    expect(validateNonPayrollLookalikeExceptions(EXC)).toEqual([]);
  });

  test("a wildcard, pattern, prefix or unqualified name fails validation", () => {
    for (const name of [
      "public.awcms_shop_*",
      "public.awcms_shop_%",
      "public.awcms_shop_?",
      "public.awcms_shop_[a-z]",
      "public.awcms_shop_.*",
      "public.*",
      "awcms_shop_order_history",
      "PUBLIC.awcms_shop_order_history",
      '"public"."awcms_shop_order_history"',
      "public.awcms_shop_order_history.extra"
    ]) {
      expect(
        validateNonPayrollLookalikeExceptions({ [name]: REASON })
      ).not.toEqual([]);
    }
  });

  test("a payroll-family table cannot be registered", () => {
    expect(
      validateNonPayrollLookalikeExceptions({ [ACCRUALS]: REASON })
    ).not.toEqual([]);
    expect(
      validateNonPayrollLookalikeExceptions({
        "public.awcms_hr_payroll_runs": REASON
      })
    ).not.toEqual([]);
  });

  test("assertNonPayrollLookalikeExceptionsValid throws on a bad list only", () => {
    expect(() =>
      assertNonPayrollLookalikeExceptionsValid({ [HISTORY]: "x" })
    ).toThrow(/NON_PAYROLL_LOOKALIKE_EXCEPTIONS is invalid/);
    expect(() =>
      assertNonPayrollLookalikeExceptionsValid({ "public.awcms_x_*": REASON })
    ).toThrow(/invalid/);
    expect(() => assertNonPayrollLookalikeExceptionsValid(EXC)).not.toThrow();
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
      /^assertNonPayrollLookalikeExceptionsValid\(NON_PAYROLL_LOOKALIKE_EXCEPTIONS\);$/m
    );
  });
});
