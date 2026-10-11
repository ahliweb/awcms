/**
 * Commission rule evaluation (Issue #950, ADR-0132). PURE: no database. Table
 * tests over exact decimal arithmetic, the rounding modes, the clamps, the
 * bounds and rule selection by effective date.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateCommission,
  selectEffectiveRule,
  CommissionEvaluationError,
  type CommissionRuleTerms,
  type RuleWindow
} from "../src/modules/hr-commission/domain/hr-commission-evaluation";
import {
  parseDecimal,
  roundToUnits,
  unitsToDecimalString,
  type RoundingMode
} from "../src/modules/hr-commission/domain/hr-commission-decimal";

function percent(
  rate: string,
  over: Partial<CommissionRuleTerms> = {}
): CommissionRuleTerms {
  return {
    calculation: "percent",
    rate,
    fixedAmount: null,
    minAmount: null,
    maxAmount: null,
    currencyCode: "XTS",
    roundingMode: "half_up",
    roundingScale: 2,
    ...over
  };
}

function fixed(
  fixedAmount: string,
  over: Partial<CommissionRuleTerms> = {}
): CommissionRuleTerms {
  return {
    calculation: "fixed",
    rate: null,
    fixedAmount,
    minAmount: null,
    maxAmount: null,
    currencyCode: "XTS",
    roundingMode: "half_up",
    roundingScale: 2,
    ...over
  };
}

describe("evaluateCommission — percent", () => {
  const cases: [
    string,
    string,
    string,
    Partial<CommissionRuleTerms>,
    string
  ][] = [
    ["plain", "2.5", "1000", {}, "25.00"],
    ["zero base", "10", "0", {}, "0.00"],
    ["zero rate", "0", "999.99", {}, "0.00"],
    ["hundred percent", "100", "12.34", {}, "12.34"],
    // 1.005 is the float trap: a double stores 1.00499999999999989...
    ["exact half boundary, half_up", "1", "100.5", { roundingScale: 0 }, "1"],
    ["1.005 half_up", "10", "10.05", {}, "1.01"],
    ["1.005 half_down", "10", "10.05", { roundingMode: "half_down" }, "1.00"],
    [
      "1.005 half_even (even stays)",
      "10",
      "10.05",
      { roundingMode: "half_even" },
      "1.00"
    ],
    [
      "1.015 half_even (odd rounds up)",
      "10",
      "10.15",
      { roundingMode: "half_even" },
      "1.02"
    ],
    ["up", "10", "10.01", { roundingMode: "up" }, "1.01"],
    ["down", "10", "10.09", { roundingMode: "down" }, "1.00"],
    ["ceiling", "10", "10.01", { roundingMode: "ceiling" }, "1.01"],
    ["floor", "10", "10.09", { roundingMode: "floor" }, "1.00"],
    ["scale 0", "7.5", "100", { roundingScale: 0 }, "8"],
    ["scale 6", "0.000001", "1", { roundingScale: 6 }, "0.000000"],
    [
      "scale 6 keeps digits",
      "33.333333",
      "3",
      { roundingScale: 6 },
      "1.000000"
    ],
    ["thirds do not drift", "33.333333", "100", {}, "33.33"],
    ["large amount stays exact", "1", "999999999999.99", {}, "10000000000.00"],
    ["rate with six places", "0.000001", "1000000", {}, "0.01"]
  ];

  for (const [name, rate, base, over, expected] of cases) {
    test(name, () => {
      const result = evaluateCommission(percent(rate, over), {
        baseAmount: base
      });

      expect(result.amount).toBe(expected);
      expect(result.currencyCode).toBe("XTS");
      expect(result.calculation).toBe("percent");
    });
  }

  test("a classic float pair is exact: 0.1 + 0.2 never appears", () => {
    // 10 % of 0.3 is 0.03 exactly.
    expect(
      evaluateCommission(percent("10"), { baseAmount: "0.3" }).amount
    ).toBe("0.03");
  });
});

describe("evaluateCommission — fixed per unit", () => {
  const cases: [
    string,
    string,
    number,
    Partial<CommissionRuleTerms>,
    string
  ][] = [
    ["one unit", "10", 1, {}, "10.00"],
    ["many units", "2.5", 7, {}, "17.50"],
    ["zero units", "2.5", 0, {}, "0.00"],
    ["sub-scale amount rounds once", "0.005", 3, {}, "0.02"],
    [
      "sub-scale amount, half_even",
      "0.005",
      3,
      { roundingMode: "half_even" },
      "0.02"
    ],
    ["sub-scale amount, down", "0.005", 3, { roundingMode: "down" }, "0.01"],
    ["max units", "1", 1_000_000, {}, "1000000.00"]
  ];

  for (const [name, amount, units, over, expected] of cases) {
    test(name, () => {
      expect(evaluateCommission(fixed(amount, over), { units }).amount).toBe(
        expected
      );
    });
  }
});

describe("evaluateCommission — clamps", () => {
  test("a floor lifts a small commission", () => {
    const result = evaluateCommission(percent("1", { minAmount: "5" }), {
      baseAmount: "100"
    });

    expect(result.amount).toBe("5.00");
    expect(result.clampedTo).toBe("min");
  });

  test("a ceiling caps a large commission", () => {
    const result = evaluateCommission(percent("50", { maxAmount: "20.50" }), {
      baseAmount: "100"
    });

    expect(result.amount).toBe("20.50");
    expect(result.clampedTo).toBe("max");
  });

  test("inside the band nothing is clamped", () => {
    const result = evaluateCommission(
      percent("10", { minAmount: "5", maxAmount: "20" }),
      { baseAmount: "100" }
    );

    expect(result.amount).toBe("10.00");
    expect(result.clampedTo).toBeNull();
  });

  test("clamping happens AFTER rounding", () => {
    // 0.004 rounds to 0.00, then the floor of 0.01 applies.
    const result = evaluateCommission(percent("4", { minAmount: "0.01" }), {
      baseAmount: "0.1"
    });

    expect(result.amount).toBe("0.01");
    expect(result.clampedTo).toBe("min");
  });

  test("a bound with more decimals than the scale is refused, not silently rounded", () => {
    expect(() =>
      evaluateCommission(percent("1", { minAmount: "0.001" }), {
        baseAmount: "100"
      })
    ).toThrow(CommissionEvaluationError);
  });
});

describe("evaluateCommission — refusals and bounds", () => {
  const throws = (
    fn: () => unknown,
    code: "INPUT_INVALID" | "RULE_INVALID"
  ) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(CommissionEvaluationError);
      expect((error as CommissionEvaluationError).code).toBe(code);
      return;
    }
    throw new Error("expected a throw");
  };

  test("a percent rule needs a base amount", () => {
    throws(() => evaluateCommission(percent("1"), {}), "INPUT_INVALID");
  });

  test("a fixed rule needs whole, bounded units", () => {
    for (const units of [-1, 1.5, Number.NaN, 1_000_001, undefined]) {
      throws(
        () =>
          evaluateCommission(fixed("1"), {
            units: units as number | undefined
          }),
        "INPUT_INVALID"
      );
    }
  });

  test("malformed money strings are refused", () => {
    for (const base of [
      "",
      "1e3",
      "-1",
      "1,5",
      " 1",
      "1.",
      ".5",
      "0x10",
      "1.1234567",
      "1234567890123"
    ]) {
      throws(
        () => evaluateCommission(percent("1"), { baseAmount: base }),
        "INPUT_INVALID"
      );
    }
  });

  test("the RESULT is bounded below 10^12 even when both inputs are in range", () => {
    // 999,999.999999 x 1,000,000 units = 999,999,999,999.000000: the largest
    // whole-unit product that still fits numeric(18, 6).
    expect(
      evaluateCommission(fixed("999999.999999", { roundingScale: 6 }), {
        units: 1_000_000
      }).amount
    ).toBe("999999999999.000000");

    // One unit more is 10^12 exactly: refused, not truncated.
    throws(
      () =>
        evaluateCommission(fixed("1000000", { roundingScale: 6 }), {
          units: 1_000_000
        }),
      "INPUT_INVALID"
    );
    // The same inputs at the widest in-range amount: 10^18, far out of range.
    throws(
      () =>
        evaluateCommission(fixed("999999999999.999999"), { units: 1_000_000 }),
      "INPUT_INVALID"
    );
    // A percent rule can never exceed its base, so the base bound is enough.
    expect(
      evaluateCommission(percent("100", { roundingScale: 6 }), {
        baseAmount: "999999999999.999999"
      }).amount
    ).toBe("999999999999.999999");
    // Rounding up across the limit is still caught (scale 0: 999999999999.5 -> 10^12).
    throws(
      () =>
        evaluateCommission(percent("100", { roundingScale: 0 }), {
          baseAmount: "999999999999.5"
        }),
      "INPUT_INVALID"
    );
  });

  test("a JSON number smuggled past validation is refused, not coerced", () => {
    throws(
      () =>
        evaluateCommission(percent("1"), {
          baseAmount: 100 as unknown as string
        }),
      "INPUT_INVALID"
    );
  });

  test("an inconsistent rule is refused", () => {
    throws(
      () =>
        evaluateCommission(percent("1", { fixedAmount: "1" }), {
          baseAmount: "1"
        }),
      "RULE_INVALID"
    );
    throws(
      () => evaluateCommission(fixed("1", { rate: "1" }), { units: 1 }),
      "RULE_INVALID"
    );
    throws(
      () => evaluateCommission(percent("100.000001"), { baseAmount: "1" }),
      "RULE_INVALID"
    );
    throws(
      () =>
        evaluateCommission(percent("1", { roundingScale: 7 }), {
          baseAmount: "1"
        }),
      "RULE_INVALID"
    );
  });

  test("is a pure function: same input, same output, no mutation", () => {
    const rule = percent("2.5", { minAmount: "1" });
    const frozen = Object.freeze({ ...rule });
    const input = Object.freeze({ baseAmount: "1234.56" });
    const first = evaluateCommission(frozen, input);

    for (let i = 0; i < 50; i += 1) {
      expect(evaluateCommission(frozen, input)).toEqual(first);
    }
  });
});

describe("decimal helpers", () => {
  test("parseDecimal is exact", () => {
    expect(parseDecimal("12.50")).toEqual({ num: 1250n, den: 100n });
    expect(parseDecimal("-0.5", { allowNegative: true })).toEqual({
      num: -5n,
      den: 10n
    });
  });

  const modes: [RoundingMode, number[]][] = [
    // value in thousandths -> expected at scale 2 for 1.005, 1.015, 1.025, -1.005, -1.015
    ["half_up", [101, 102, 103, -101, -102]],
    ["half_down", [100, 101, 102, -100, -101]],
    ["half_even", [100, 102, 102, -100, -102]],
    ["up", [101, 102, 103, -101, -102]],
    ["down", [100, 101, 102, -100, -101]],
    ["ceiling", [101, 102, 103, -100, -101]],
    ["floor", [100, 101, 102, -101, -102]]
  ];

  for (const [mode, expected] of modes) {
    test(`roundToUnits ${mode} on exact half boundaries`, () => {
      const inputs = ["1.005", "1.015", "1.025", "-1.005", "-1.015"];
      const got = inputs.map((v) =>
        Number(roundToUnits(parseDecimal(v, { allowNegative: true }), 2, mode))
      );

      expect(got).toEqual(expected);
    });
  }

  test("unitsToDecimalString pads and signs", () => {
    expect(unitsToDecimalString(5n, 2)).toBe("0.05");
    expect(unitsToDecimalString(-5n, 2)).toBe("-0.05");
    expect(unitsToDecimalString(12n, 0)).toBe("12");
    expect(unitsToDecimalString(0n, 3)).toBe("0.000");
  });
});

describe("selectEffectiveRule", () => {
  const w = (
    id: string,
    from: string,
    to: string | null,
    status = "published",
    ruleKey = "r"
  ): RuleWindow => ({
    id,
    ruleKey,
    status,
    effectiveFrom: from,
    effectiveTo: to
  });

  const rules = [
    w("v1", "2026-01-01", "2026-07-01"),
    w("v2", "2026-07-01", null),
    w("draft", "2026-01-01", null, "draft"),
    w("old", "2020-01-01", "2021-01-01", "retired"),
    w("other", "2026-01-01", null, "published", "other-rule")
  ];

  const cases: [string, string, string][] = [
    ["first day of v1", "2026-01-01", "v1"],
    ["last day of v1", "2026-06-30", "v1"],
    ["the boundary belongs to the successor", "2026-07-01", "v2"],
    ["open-ended future", "2099-12-31", "v2"]
  ];

  for (const [name, on, id] of cases) {
    test(name, () => {
      const result = selectEffectiveRule(rules, "r", on);

      expect(result.outcome).toBe("ok");
      if (result.outcome === "ok") expect(result.rule.id).toBe(id);
    });
  }

  test("before any window, nothing applies", () => {
    expect(selectEffectiveRule(rules, "r", "2025-12-31").outcome).toBe("none");
  });

  test("a draft and a retired version never apply", () => {
    expect(
      selectEffectiveRule(
        [w("d", "2026-01-01", null, "draft")],
        "r",
        "2026-02-01"
      ).outcome
    ).toBe("none");
    expect(
      selectEffectiveRule(
        [w("x", "2026-01-01", null, "retired")],
        "r",
        "2026-02-01"
      ).outcome
    ).toBe("none");
  });

  test("an unknown rule key applies nothing", () => {
    expect(selectEffectiveRule(rules, "nope", "2026-02-01").outcome).toBe(
      "none"
    );
  });

  test("overlapping published windows are reported, never guessed", () => {
    const result = selectEffectiveRule(
      [w("a", "2026-01-01", null), w("b", "2026-03-01", null)],
      "r",
      "2026-04-01"
    );

    expect(result).toEqual({ outcome: "ambiguous", ids: ["a", "b"] });
  });

  test("a malformed date is refused", () => {
    expect(() => selectEffectiveRule(rules, "r", "2026-1-1")).toThrow(
      CommissionEvaluationError
    );
  });
});
