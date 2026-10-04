import { describe, expect, test } from "bun:test";

import {
  ROUNDING_MODES,
  apportion,
  parseDecimal,
  ratFromInt,
  roundToUnits,
  unitsToDecimalString,
  type RoundingMode
} from "../src/modules/tax/domain/decimal";
import { calculateTax } from "../src/modules/tax/domain/tax-calculator";
import {
  computeReversal,
  type ReversedSoFar
} from "../src/modules/tax/domain/tax-reversal";
import {
  TaxCalculationError,
  type PricingMode,
  type ResolvedTaxRuleVersion,
  type RoundingLevel,
  type TaxLineInput,
  type TaxRule
} from "../src/modules/tax/domain/tax-types";

/**
 * The tax calculator (ADR-0127). Pure, so every test here is a function call and
 * an assertion — no database. The hand-computed figures are the specification:
 * each one is written out in `docs/awcms/tax-calculation.md`.
 */

const VAT: TaxRule = {
  categoryCode: null,
  treatment: "taxable",
  components: [{ code: "vat", name: "VAT", rate: "10", basis: "net" }]
};

function makeVersion(
  overrides: Partial<ResolvedTaxRuleVersion> & { rules?: TaxRule[] } = {}
): ResolvedTaxRuleVersion {
  const { rules, ...rest } = overrides;

  return {
    ruleVersionId: null,
    profileCode: "test",
    versionNo: 1,
    jurisdictionCode: "XX",
    currencyCode: "USD",
    pricingMode: "exclusive",
    roundingMode: "half_up",
    roundingScale: 2,
    roundingLevel: "line",
    definition: { categories: [], rules: rules ?? [VAT] },
    ...rest
  };
}

function line(
  lineRef: string,
  quantity: string,
  unitPrice: string,
  extra: Partial<TaxLineInput> = {}
): TaxLineInput {
  return { lineRef, categoryCode: null, quantity, unitPrice, ...extra };
}

describe("decimal arithmetic", () => {
  test("rounds exactly where a float rounds wrong: 1.005 is a half, not 1.00499999", () => {
    const value = parseDecimal("1.005", { maxFractionDigits: 6 });

    expect(roundToUnits(value, 2, "half_up")).toBe(101n);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(
      roundToUnits(
        {
          num: parseDecimal("0.1", { maxFractionDigits: 6 }).num * 3n,
          den: 10n
        },
        1,
        "half_up"
      )
    ).toBe(3n);
  });

  test("every rounding mode on a positive and a negative half", () => {
    const table: Record<RoundingMode, [number, number, number, number]> = {
      // [2.5, 3.5, -2.5, -3.5] rounded to a whole unit
      half_up: [3, 4, -3, -4],
      half_down: [2, 3, -2, -3],
      half_even: [2, 4, -2, -4],
      up: [3, 4, -3, -4],
      down: [2, 3, -2, -3],
      ceiling: [3, 4, -2, -3],
      floor: [2, 3, -3, -4]
    };

    for (const mode of ROUNDING_MODES) {
      const results = ["2.5", "3.5", "-2.5", "-3.5"].map((text) =>
        Number(
          roundToUnits(
            parseDecimal(text, { maxFractionDigits: 6, allowNegative: true }),
            0,
            mode
          )
        )
      );

      expect({ mode, results }).toEqual({ mode, results: table[mode] });
    }
  });

  test("a value that is not on a half rounds the same in every half mode", () => {
    const below = parseDecimal("2.4", { maxFractionDigits: 6 });
    const above = parseDecimal("2.6", { maxFractionDigits: 6 });

    for (const mode of ["half_up", "half_down", "half_even"] as const) {
      expect(roundToUnits(below, 0, mode)).toBe(2n);
      expect(roundToUnits(above, 0, mode)).toBe(3n);
    }
  });

  test("formats fixed-scale decimals, including negatives and sub-unit values", () => {
    expect(unitsToDecimalString(5n, 2)).toBe("0.05");
    expect(unitsToDecimalString(-5n, 2)).toBe("-0.05");
    expect(unitsToDecimalString(12345n, 2)).toBe("123.45");
    expect(unitsToDecimalString(8n, 0)).toBe("8");
  });

  test("refuses anything that is not a plain decimal string", () => {
    for (const bad of [
      "",
      "1e3",
      "+1",
      " 1",
      "1,000",
      "1.",
      ".5",
      "abc",
      "1.2.3"
    ]) {
      expect(() => parseDecimal(bad, { maxFractionDigits: 6 })).toThrow();
    }

    expect(() => parseDecimal("-1", { maxFractionDigits: 6 })).toThrow();
    expect(() => parseDecimal("1.1234567", { maxFractionDigits: 6 })).toThrow();
  });

  test("apportion sums exactly, breaks ties toward the lower index, and is a function of its inputs", () => {
    const third = ratFromInt(1n);

    expect(apportion(2n, [third, third, third])).toEqual([1n, 1n, 0n]);
    expect(apportion(100n, [third, third, third])).toEqual([34n, 33n, 33n]);
    expect(apportion(0n, [third, third])).toEqual([0n, 0n]);
    expect(() => apportion(1n, [ratFromInt(0n)])).toThrow();
    expect(() => apportion(-1n, [third])).toThrow();
  });
});

describe("exclusive pricing", () => {
  test("line 3 x 19.99 at 10%: net 59.97, tax 6.00 (5.997 half-up), gross 65.97", () => {
    const result = calculateTax(makeVersion(), [line("a", "3", "19.99")]);

    expect(result.lines[0]).toMatchObject({
      netAmount: "59.97",
      taxAmount: "6.00",
      grossAmount: "65.97"
    });
    expect(result.netTotal).toBe("59.97");
    expect(result.taxTotal).toBe("6.00");
    expect(result.grossTotal).toBe("65.97");
  });

  test("a discount comes off before tax", () => {
    const result = calculateTax(makeVersion(), [
      line("a", "2", "10.00", { discount: "5.00" })
    ]);

    expect(result.lines[0]).toMatchObject({
      netAmount: "15.00",
      taxAmount: "1.50",
      grossAmount: "16.50",
      discount: "5.00"
    });
  });

  test("a discount larger than the line is refused", () => {
    expect(() =>
      calculateTax(makeVersion(), [
        line("a", "1", "10.00", { discount: "10.01" })
      ])
    ).toThrow(TaxCalculationError);
  });

  test("a zero-decimal currency: 105 at 8% is 8.4 -> 8 and prints without a point", () => {
    const result = calculateTax(
      makeVersion({
        roundingScale: 0,
        definition: {
          categories: [],
          rules: [
            {
              categoryCode: null,
              treatment: "taxable",
              components: [{ code: "ct", name: "CT", rate: "8", basis: "net" }]
            }
          ]
        }
      }),
      [line("a", "1", "105")]
    );

    expect(result.lines[0]).toMatchObject({
      netAmount: "105",
      taxAmount: "8",
      grossAmount: "113"
    });
  });

  test("an amount a float would mis-round: 1.005 net rounds to 1.01 under half-up", () => {
    const result = calculateTax(
      makeVersion({
        rules: [{ categoryCode: null, treatment: "exempt", components: [] }]
      }),
      [line("a", "1", "1.005")]
    );

    expect(result.lines[0]!.netAmount).toBe("1.01");
  });

  test("large amounts stay exact", () => {
    const result = calculateTax(makeVersion(), [
      line("a", "999999.999999", "700000000000.000000")
    ]);

    // (10^6 - 1e-6) x 7e11 = 699999999999300000 exactly; a float cannot hold it.
    expect(result.lines[0]).toMatchObject({
      netAmount: "699999999999300000.00",
      taxAmount: "69999999999930000.00",
      grossAmount: "769999999999230000.00"
    });
  });
});

describe("magnitude cap — every figure must fit numeric(24,6) (M1)", () => {
  const exempt = makeVersion({
    rules: [{ categoryCode: null, treatment: "exempt", components: [] }]
  });

  test("the largest figure that fits is accepted", () => {
    const result = calculateTax(exempt, [
      line("a", "1", "999999999999999999.99")
    ]);

    expect(result.grossTotal).toBe("999999999999999999.99");
  });

  test("a line amount of 10^18 or more is a TAX_INPUT_INVALID", () => {
    for (const lines of [
      [line("a", "999999999", "999999999999.99")],
      [line("a", "1000000", "1000000000000.00")]
    ]) {
      try {
        calculateTax(makeVersion(), lines);
        throw new Error("expected an overflow refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(TaxCalculationError);
        expect((error as TaxCalculationError).code).toBe("TAX_INPUT_INVALID");
      }
    }
  });

  test("tax that pushes a line's gross over the cap is refused, not clipped", () => {
    // 9.5e17 net fits; 10% tax makes the gross 1.045e18, which does not.
    expect(() =>
      calculateTax(makeVersion(), [line("a", "1", "950000000000000000.00")])
    ).toThrow(/too large/);
    expect(
      calculateTax(makeVersion(), [line("a", "1", "900000000000000000.00")])
        .grossTotal
    ).toBe("990000000000000000.00");
  });

  test("lines that each fit but whose document total does not are refused", () => {
    expect(() =>
      calculateTax(exempt, [
        line("a", "1", "600000000000000000.00"),
        line("b", "1", "600000000000000000.00")
      ])
    ).toThrow(/document total is too large/);
  });

  test("inclusive and document-level paths are capped identically", () => {
    for (const roundingLevel of ["line", "document"] as const) {
      expect(() =>
        calculateTax(makeVersion({ pricingMode: "inclusive", roundingLevel }), [
          line("a", "1", "999999999999999999.99"),
          line("b", "1", "999999999999999999.99")
        ])
      ).toThrow(TaxCalculationError);
    }
  });
});

describe("rounding modes on an exact half", () => {
  const expectations: Record<RoundingMode, [string, string]> = {
    // [tax on 0.25 @10% = 0.025, tax on 0.35 @10% = 0.035]
    half_up: ["0.03", "0.04"],
    half_down: ["0.02", "0.03"],
    half_even: ["0.02", "0.04"],
    up: ["0.03", "0.04"],
    down: ["0.02", "0.03"],
    ceiling: ["0.03", "0.04"],
    floor: ["0.02", "0.03"]
  };

  for (const mode of ROUNDING_MODES) {
    test(`${mode}`, () => {
      const version = makeVersion({ roundingMode: mode });
      const low = calculateTax(version, [line("a", "1", "0.25")]);
      const high = calculateTax(version, [line("a", "1", "0.35")]);

      expect([low.taxTotal, high.taxTotal]).toEqual(expectations[mode]);
    });
  }
});

describe("inclusive pricing", () => {
  const inclusive = (extra: Partial<ResolvedTaxRuleVersion> = {}) =>
    makeVersion({
      pricingMode: "inclusive",
      definition: {
        categories: [],
        rules: [
          {
            categoryCode: null,
            treatment: "taxable",
            components: [{ code: "vat", name: "VAT", rate: "11", basis: "net" }]
          }
        ]
      },
      ...extra
    });

  test("111.00 inclusive of 11% backs out to net 100.00 and tax 11.00 exactly", () => {
    const result = calculateTax(inclusive(), [line("a", "1", "111.00")]);

    expect(result.lines[0]).toMatchObject({
      netAmount: "100.00",
      taxAmount: "11.00",
      grossAmount: "111.00"
    });
  });

  test("100.00 inclusive: net 90.09 (90.0900...), tax 9.91, gross preserved", () => {
    const result = calculateTax(inclusive(), [line("a", "1", "100.00")]);

    expect(result.lines[0]).toMatchObject({
      netAmount: "90.09",
      taxAmount: "9.91",
      grossAmount: "100.00"
    });
  });

  test("the pricing mode is the rule version's: the calculator takes no override (H2b)", () => {
    expect(calculateTax.length).toBe(2);

    const result = calculateTax(makeVersion(), [line("a", "1", "110.00")]);

    expect(result.pricingMode).toBe("exclusive");
    expect(result.lines[0]).toMatchObject({
      netAmount: "110.00",
      taxAmount: "11.00"
    });
  });

  test("an inclusive line's gross is always exactly what was priced", () => {
    for (const amount of ["0.01", "0.99", "7.77", "123.45", "99999.99"]) {
      const result = calculateTax(inclusive(), [line("a", "1", amount)]);

      expect(result.lines[0]!.grossAmount).toBe(amount);
      expect(result.grossTotal).toBe(amount);
    }
  });
});

describe("multiple and compound components", () => {
  const stacked = (basis: "net" | "cumulative") =>
    makeVersion({
      rules: [
        {
          categoryCode: null,
          treatment: "taxable",
          components: [
            { code: "vat", name: "VAT", rate: "10", basis: "net" },
            { code: "levy", name: "Levy", rate: "5", basis }
          ]
        }
      ]
    });

  test("two components on net: 10.00 + 5.00 on 100.00", () => {
    const result = calculateTax(stacked("net"), [line("a", "1", "100.00")]);

    expect(result.lines[0]!.components.map((c) => c.taxAmount)).toEqual([
      "10.00",
      "5.00"
    ]);
    expect(result.taxTotal).toBe("15.00");
    expect(result.componentTotals).toEqual([
      { code: "vat", name: "VAT", taxAmount: "10.00" },
      { code: "levy", name: "Levy", taxAmount: "5.00" }
    ]);
  });

  test("a cumulative component is charged on net + earlier tax: 5% of 110.00 = 5.50", () => {
    const result = calculateTax(stacked("cumulative"), [
      line("a", "1", "100.00")
    ]);

    expect(result.lines[0]!.components).toMatchObject([
      { code: "vat", taxableBase: "100.00", taxAmount: "10.00" },
      { code: "levy", taxableBase: "110.00", taxAmount: "5.50" }
    ]);
    expect(result.taxTotal).toBe("15.50");
  });

  test("inclusive compound: 115.50 backs out through K = 1.155 to 100.00 / 10.00 / 5.50", () => {
    const result = calculateTax(
      { ...stacked("cumulative"), pricingMode: "inclusive" },
      [line("a", "1", "115.50")]
    );

    expect(result.lines[0]).toMatchObject({
      netAmount: "100.00",
      taxAmount: "15.50",
      grossAmount: "115.50"
    });
    expect(result.lines[0]!.components.map((c) => c.taxAmount)).toEqual([
      "10.00",
      "5.50"
    ]);
  });

  test("inclusive components always sum to the line's tax, to the last unit", () => {
    const result = calculateTax(
      { ...stacked("cumulative"), pricingMode: "inclusive" },
      [line("a", "1", "33.33"), line("b", "3", "0.07")]
    );

    for (const entry of result.lines) {
      const sum = entry.components.reduce(
        (total, component) =>
          total + BigInt(component.taxAmount.replace(".", "")),
        0n
      );

      expect(sum).toBe(BigInt(entry.taxAmount.replace(".", "")));
    }
  });
});

describe("rounding level: line vs document", () => {
  const threeSmallLines = [
    line("a", "1", "0.05"),
    line("b", "1", "0.05"),
    line("c", "1", "0.05")
  ];

  test("line level rounds each line alone: 3 x 0.005 -> 3 x 0.01 = 0.03", () => {
    const result = calculateTax(
      makeVersion({ roundingLevel: "line" }),
      threeSmallLines
    );

    expect(result.lines.map((l) => l.taxAmount)).toEqual([
      "0.01",
      "0.01",
      "0.01"
    ]);
    expect(result.taxTotal).toBe("0.03");
  });

  test("document level rounds the sum once: 0.015 -> 0.02, apportioned [0.01, 0.01, 0.00]", () => {
    const result = calculateTax(
      makeVersion({ roundingLevel: "document" }),
      threeSmallLines
    );

    expect(result.lines.map((l) => l.taxAmount)).toEqual([
      "0.01",
      "0.01",
      "0.00"
    ]);
    expect(result.taxTotal).toBe("0.02");
  });

  test("document level, inclusive: the lines still sum to the document and gross is preserved", () => {
    const result = calculateTax(
      makeVersion({ roundingLevel: "document", pricingMode: "inclusive" }),
      [line("a", "1", "10.01"), line("b", "1", "20.02"), line("c", "2", "3.33")]
    );

    const sum = (field: "netAmount" | "taxAmount" | "grossAmount") =>
      result.lines.reduce(
        (total, entry) => total + BigInt(entry[field].replace(".", "")),
        0n
      );

    expect(sum("netAmount")).toBe(BigInt(result.netTotal.replace(".", "")));
    expect(sum("taxAmount")).toBe(BigInt(result.taxTotal.replace(".", "")));
    expect(result.grossTotal).toBe("36.69");
  });
});

describe("treatment: taxable, exempt and zero-rated", () => {
  const version = makeVersion({
    rules: [
      VAT,
      { categoryCode: "books", treatment: "exempt", components: [] },
      { categoryCode: "food", treatment: "zero_rated", components: [] }
    ],
    definition: undefined as never
  });
  // `makeVersion` ignores a `definition` override that is undefined — rebuild.
  const withCategories: ResolvedTaxRuleVersion = {
    ...version,
    definition: {
      categories: [
        { code: "books", name: "Books" },
        { code: "food", name: "Basic food" }
      ],
      rules: [
        VAT,
        { categoryCode: "books", treatment: "exempt", components: [] },
        { categoryCode: "food", treatment: "zero_rated", components: [] }
      ]
    }
  };

  test("exempt and zero-rated lines carry no tax but stay distinct", () => {
    const result = calculateTax(withCategories, [
      line("std", "1", "100.00"),
      line("book", "1", "50.00", { categoryCode: "books" }),
      line("rice", "1", "20.00", { categoryCode: "food" })
    ]);

    expect(result.lines.map((l) => [l.treatment, l.taxAmount])).toEqual([
      ["taxable", "10.00"],
      ["exempt", "0.00"],
      ["zero_rated", "0.00"]
    ]);
    expect(result.treatmentTotals).toEqual([
      {
        treatment: "taxable",
        netAmount: "100.00",
        taxAmount: "10.00",
        grossAmount: "110.00"
      },
      {
        treatment: "exempt",
        netAmount: "50.00",
        taxAmount: "0.00",
        grossAmount: "50.00"
      },
      {
        treatment: "zero_rated",
        netAmount: "20.00",
        taxAmount: "0.00",
        grossAmount: "20.00"
      }
    ]);
    expect(result.taxTotal).toBe("10.00");
  });

  test("an inclusive exempt line's gross is its net", () => {
    const result = calculateTax(
      { ...withCategories, pricingMode: "inclusive" },
      [line("book", "1", "50.00", { categoryCode: "books" })]
    );

    expect(result.lines[0]).toMatchObject({
      netAmount: "50.00",
      taxAmount: "0.00",
      grossAmount: "50.00"
    });
  });

  test("a line with no rule and no fallback is refused, never silently untaxed", () => {
    const noFallback = makeVersion({
      rules: [{ categoryCode: "books", treatment: "exempt", components: [] }]
    });

    expect(() =>
      calculateTax(noFallback, [
        line("a", "1", "1.00", { categoryCode: "mystery" })
      ])
    ).toThrow(/no rule for category "mystery"/);
    expect(() => calculateTax(noFallback, [line("a", "1", "1.00")])).toThrow(
      /no fallback rule/
    );
  });

  test("the fallback rule covers an unlisted category", () => {
    const result = calculateTax(withCategories, [
      line("a", "1", "10.00", { categoryCode: "unlisted" })
    ]);

    expect(result.lines[0]!.treatment).toBe("taxable");
  });
});

describe("input handling", () => {
  test("empty, duplicate, zero-quantity and over-long inputs are refused", () => {
    const version = makeVersion();

    expect(() => calculateTax(version, [])).toThrow();
    expect(() =>
      calculateTax(version, [line("a", "1", "1.00"), line("a", "1", "1.00")])
    ).toThrow(/Duplicate lineRef/);
    expect(() => calculateTax(version, [line("a", "0", "1.00")])).toThrow(
      /quantity must be greater than zero/
    );
    expect(() =>
      calculateTax(version, [line("a", "1.0000001", "1.00")])
    ).toThrow();
    expect(() =>
      calculateTax(
        version,
        Array.from({ length: 501 }, (_, index) =>
          line(`l${index}`, "1", "1.00")
        )
      )
    ).toThrow(/At most 500/);
  });
});

describe("determinism and invariants", () => {
  /** mulberry32 — a fixed, tiny PRNG so the "random" cases are the same on every run. */
  function prng(seed: number): () => number {
    let state = seed;

    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);

      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const richRules: TaxRule[] = [
    {
      categoryCode: null,
      treatment: "taxable",
      components: [
        { code: "vat", name: "VAT", rate: "7.5", basis: "net" },
        { code: "levy", name: "Levy", rate: "2.125", basis: "cumulative" },
        { code: "city", name: "City", rate: "0.375", basis: "net" }
      ]
    },
    { categoryCode: "ex", treatment: "exempt", components: [] },
    { categoryCode: "zr", treatment: "zero_rated", components: [] }
  ];

  test("the same input and rule version always give the byte-identical result", () => {
    const version = makeVersion({
      rules: richRules,
      roundingLevel: "document"
    });
    const lines = [line("a", "3", "19.99"), line("b", "1.5", "7.31")];

    expect(JSON.stringify(calculateTax(version, lines))).toBe(
      JSON.stringify(calculateTax(version, lines))
    );
  });

  test("1,008 randomised documents: lines add up to the document in every mode, level and pricing", () => {
    const random = prng(20260801);
    const levels: RoundingLevel[] = ["line", "document"];
    const pricings: PricingMode[] = ["exclusive", "inclusive"];
    let documents = 0;

    for (const mode of ROUNDING_MODES) {
      for (const level of levels) {
        for (const pricing of pricings) {
          for (let round = 0; round < 36; round += 1) {
            const lineCount = 1 + Math.floor(random() * 5);
            const lines = Array.from({ length: lineCount }, (_, index) =>
              line(
                `l${index}`,
                `${1 + Math.floor(random() * 9)}.${Math.floor(random() * 1000)
                  .toString()
                  .padStart(3, "0")}`,
                `${Math.floor(random() * 500)}.${Math.floor(random() * 100)
                  .toString()
                  .padStart(2, "0")}`,
                {
                  categoryCode:
                    ["ex", "zr", null][Math.floor(random() * 3)] ?? null
                }
              )
            );
            const version = makeVersion({
              rules: richRules,
              roundingMode: mode,
              roundingLevel: level,
              pricingMode: pricing
            });

            let result;

            try {
              result = calculateTax(version, lines);
            } catch (error) {
              // Only the documented tiny-amount refusal may escape.
              expect((error as Error).message).toMatch(
                /too small to carry its tax/
              );
              continue;
            }

            documents += 1;

            const units = (text: string) => BigInt(text.replace(".", ""));

            for (const entry of result.lines) {
              expect(units(entry.netAmount) + units(entry.taxAmount)).toBe(
                units(entry.grossAmount)
              );
              expect(
                entry.components.reduce(
                  (sum, c) => sum + units(c.taxAmount),
                  0n
                )
              ).toBe(units(entry.taxAmount));
            }

            expect(
              result.lines.reduce((sum, l) => sum + units(l.netAmount), 0n)
            ).toBe(units(result.netTotal));
            expect(
              result.lines.reduce((sum, l) => sum + units(l.taxAmount), 0n)
            ).toBe(units(result.taxTotal));
            expect(units(result.netTotal) + units(result.taxTotal)).toBe(
              units(result.grossTotal)
            );
            expect(
              result.componentTotals.reduce(
                (sum, c) => sum + units(c.taxAmount),
                0n
              )
            ).toBe(units(result.taxTotal));
            expect(
              result.treatmentTotals.reduce(
                (sum, t) => sum + units(t.grossAmount),
                0n
              )
            ).toBe(units(result.grossTotal));
          }
        }
      }
    }

    // Almost every generated document must actually have been checked.
    expect(documents).toBeGreaterThan(900);
  });
});

describe("reversal from the original snapshot", () => {
  const saleVersion = makeVersion();
  const original = calculateTax(saleVersion, [
    line("a", "3", "3.33"),
    line("b", "1", "20.00")
  ]);

  function reverse(
    requested?: { lineRef: string; quantity: string }[],
    reversedSoFar: Map<string, ReversedSoFar> = new Map()
  ) {
    return computeReversal({
      roundingMode: original.roundingMode,
      roundingScale: original.roundingScale,
      originalLines: original.lines,
      reversedSoFar,
      ...(requested ? { requested } : {})
    });
  }

  function taken(
    result: ReturnType<typeof reverse>
  ): Map<string, ReversedSoFar> {
    const map = new Map<string, ReversedSoFar>();

    for (const entry of result.lines) {
      map.set(entry.originalLineRef, {
        quantity: parseDecimal(entry.quantity, { maxFractionDigits: 6 }),
        netUnits: -BigInt(entry.netAmount.replace(".", "")),
        componentUnits: new Map(
          entry.components.map((c) => [
            c.code,
            -BigInt(c.taxAmount.replace(".", ""))
          ])
        )
      });
    }

    return map;
  }

  test("a full reversal negates the original exactly", () => {
    const result = reverse();

    expect(result.netTotal).toBe(`-${original.netTotal}`);
    expect(result.taxTotal).toBe(`-${original.taxTotal}`);
    expect(result.grossTotal).toBe(`-${original.grossTotal}`);
    expect(result.lines[0]).toMatchObject({
      originalLineRef: "a",
      quantity: "3",
      netAmount: "-9.99",
      taxAmount: "-1.00"
    });
  });

  test("it consults no rule: the same snapshot reverses identically whatever the rate is now", () => {
    // A rate change after the sale. The reversal has no parameter that could
    // receive it — `computeReversal`'s input is the snapshot's own lines.
    const nowTwentyPercent = makeVersion({
      rules: [
        {
          categoryCode: null,
          treatment: "taxable",
          components: [{ code: "vat", name: "VAT", rate: "20", basis: "net" }]
        }
      ]
    });

    expect(
      calculateTax(nowTwentyPercent, [line("a", "3", "3.33")]).taxTotal
    ).toBe("2.00");
    expect(reverse([{ lineRef: "a", quantity: "3" }]).taxTotal).toBe("-1.00");
  });

  test("returning 1 of 3 takes a third; three single returns refund exactly what was charged", () => {
    const first = reverse([{ lineRef: "a", quantity: "1" }]);

    expect(first.lines[0]).toMatchObject({
      netAmount: "-3.33",
      taxAmount: "-0.33"
    });

    const second = reverse([{ lineRef: "a", quantity: "1" }], taken(first));
    const accumulated = new Map(taken(first));
    const secondTaken = taken(second).get("a")!;
    const firstTaken = accumulated.get("a")!;

    accumulated.set("a", {
      quantity: {
        num:
          firstTaken.quantity.num * secondTaken.quantity.den +
          secondTaken.quantity.num * firstTaken.quantity.den,
        den: firstTaken.quantity.den * secondTaken.quantity.den
      },
      netUnits: firstTaken.netUnits + secondTaken.netUnits,
      componentUnits: new Map([
        [
          "vat",
          firstTaken.componentUnits.get("vat")! +
            secondTaken.componentUnits.get("vat")!
        ]
      ])
    });

    const third = reverse([{ lineRef: "a", quantity: "1" }], accumulated);

    // The last return takes the exact REMAINDER (1.00 - 0.33 - 0.33), not a rounded third.
    expect(third.lines[0]).toMatchObject({
      netAmount: "-3.33",
      taxAmount: "-0.34"
    });

    const totalTax =
      BigInt(first.lines[0]!.taxAmount.replace(".", "")) +
      BigInt(second.lines[0]!.taxAmount.replace(".", "")) +
      BigInt(third.lines[0]!.taxAmount.replace(".", ""));

    expect(totalTax).toBe(-100n);
  });

  test("cannot return more than was sold and not yet returned", () => {
    expect(() => reverse([{ lineRef: "a", quantity: "4" }])).toThrow(
      /cannot return more than/
    );

    const afterFull = taken(reverse());

    expect(() => reverse([{ lineRef: "a", quantity: "1" }], afterFull)).toThrow(
      /cannot return more than/
    );
    expect(() => reverse(undefined, afterFull)).toThrow(
      /Nothing is left to reverse/
    );
  });

  test("unknown, duplicated, zero and empty requests are refused", () => {
    expect(() => reverse([{ lineRef: "zzz", quantity: "1" }])).toThrow(
      /not on the original/
    );
    expect(() =>
      reverse([
        { lineRef: "a", quantity: "1" },
        { lineRef: "a", quantity: "1" }
      ])
    ).toThrow(/more than once/);
    expect(() => reverse([{ lineRef: "a", quantity: "0" }])).toThrow(
      /greater than zero/
    );
    expect(() => reverse([])).toThrow(/At least one line/);
  });

  test("a document-level snapshot reverses by its recorded line amounts too", () => {
    const documentLevel = calculateTax(
      makeVersion({ roundingLevel: "document" }),
      [line("a", "1", "0.05"), line("b", "1", "0.05"), line("c", "1", "0.05")]
    );
    const full = computeReversal({
      roundingMode: documentLevel.roundingMode,
      roundingScale: documentLevel.roundingScale,
      originalLines: documentLevel.lines,
      reversedSoFar: new Map()
    });

    expect(full.taxTotal).toBe("-0.02");
    expect(full.lines.map((l) => l.taxAmount)).toEqual(
      ["-0.01", "-0.01", "-0.00"].map((v) => v.replace("-0.00", "0.00"))
    );
  });
});
