import { describe, expect, test } from "bun:test";

import {
  isEffectiveOn,
  isValidIsoDate,
  selectEffectiveVersion,
  windowsOverlap
} from "../src/modules/tax/domain/tax-version-resolution";
import {
  looksLikeComputedMoneyKey,
  validateQuoteInput,
  validateReversalInput,
  validateRuleVersionInput,
  validateSnapshotInput
} from "../src/modules/tax/domain/tax-validation";
import { isHighRiskAction } from "../src/modules/identity-access/domain/access-control";
import {
  isWithinTaxDateWindow,
  resolveTaxDateWindow
} from "../src/modules/tax/domain/tax-config";
import { TAX_PERMISSIONS } from "../src/modules/tax/domain/tax-permissions";
import { taxModule } from "../src/modules/tax/module";

/**
 * Validation, effective-date resolution and descriptor shape for `tax` (ADR-0127).
 */

const validDefinition = {
  categories: [{ code: "books", name: "Books" }],
  rules: [
    {
      categoryCode: null,
      treatment: "taxable",
      components: [{ code: "vat", name: "VAT", rate: "11", basis: "net" }]
    },
    { categoryCode: "books", treatment: "exempt", components: [] }
  ]
};

const validVersion = {
  profileCode: "retail",
  name: "Retail",
  jurisdictionCode: "XX-1",
  currencyCode: "USD",
  pricingMode: "exclusive",
  roundingMode: "half_up",
  roundingScale: 2,
  roundingLevel: "line",
  effectiveFrom: "2026-01-01",
  definition: validDefinition
};

const validQuote = {
  profileCode: "retail",
  taxDate: "2026-06-15",
  lines: [{ lineRef: "a", quantity: "2", unitPrice: "10.00" }]
};

function errorsOf(result: { valid: boolean; errors?: { field: string }[] }) {
  return result.valid ? [] : result.errors!.map((error) => error.field);
}

describe("effective-date resolution", () => {
  const v1 = {
    id: "v1",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01"
  };
  const v2 = { id: "v2", effectiveFrom: "2027-01-01", effectiveTo: null };

  test("windows are half-open: the boundary day belongs to the successor only", () => {
    expect(selectEffectiveVersion([v1, v2], "2025-12-31")).toBeNull();
    expect(selectEffectiveVersion([v1, v2], "2026-01-01")?.id).toBe("v1");
    expect(selectEffectiveVersion([v1, v2], "2026-12-31")?.id).toBe("v1");
    expect(selectEffectiveVersion([v1, v2], "2027-01-01")?.id).toBe("v2");
    expect(selectEffectiveVersion([v1, v2], "2099-12-31")?.id).toBe("v2");
  });

  test("a gap resolves to nothing, never to the nearest version", () => {
    const gap = { id: "v3", effectiveFrom: "2028-01-01", effectiveTo: null };
    const closed = { ...v2, effectiveTo: "2027-07-01" };

    expect(selectEffectiveVersion([v1, closed, gap], "2027-08-01")).toBeNull();
  });

  test("two versions claiming one day is an error, not a coin flip", () => {
    const clash = { id: "v9", effectiveFrom: "2026-06-01", effectiveTo: null };

    expect(() => selectEffectiveVersion([v1, clash], "2026-07-01")).toThrow(
      /Overlapping/
    );
  });

  test("overlap detection is symmetric and respects the open end", () => {
    expect(windowsOverlap(v1, v2)).toBe(false);
    expect(windowsOverlap(v2, v1)).toBe(false);
    expect(
      windowsOverlap(v1, { effectiveFrom: "2026-12-31", effectiveTo: null })
    ).toBe(true);
    expect(
      windowsOverlap({ effectiveFrom: "2026-12-31", effectiveTo: null }, v1)
    ).toBe(true);
    expect(isEffectiveOn(v2, "2027-01-01")).toBe(true);
    expect(isEffectiveOn(v1, "2027-01-01")).toBe(false);
  });

  test("calendar dates are real dates", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-1")).toBe(false);
    expect(isValidIsoDate("2026-01-01T00:00:00Z")).toBe(false);
  });
});

describe("rule version validation", () => {
  test("accepts a complete version", () => {
    expect(validateRuleVersionInput(validVersion).valid).toBe(true);
  });

  test("refuses a taxable rule with no component, and an exempt rule with one", () => {
    const noComponent = {
      ...validVersion,
      definition: {
        ...validDefinition,
        rules: [{ categoryCode: null, treatment: "taxable", components: [] }]
      }
    };
    const exemptWith = {
      ...validVersion,
      definition: {
        ...validDefinition,
        rules: [
          {
            categoryCode: null,
            treatment: "exempt",
            components: [{ code: "x", name: "X", rate: "1", basis: "net" }]
          }
        ]
      }
    };

    expect(validateRuleVersionInput(noComponent).valid).toBe(false);
    expect(validateRuleVersionInput(exemptWith).valid).toBe(false);
  });

  test("refuses an undeclared category, a duplicate category rule and two fallbacks", () => {
    const rule = (categoryCode: string | null) => ({
      categoryCode,
      treatment: "exempt",
      components: []
    });
    const build = (rules: unknown[]) => ({
      ...validVersion,
      definition: { ...validDefinition, rules }
    });

    expect(validateRuleVersionInput(build([rule("ghost")])).valid).toBe(false);
    expect(
      validateRuleVersionInput(build([rule("books"), rule("books")])).valid
    ).toBe(false);
    expect(
      validateRuleVersionInput(build([rule(null), rule(null)])).valid
    ).toBe(false);
  });

  test("rates must be strings, within bounds, with at most six decimals", () => {
    const withRate = (rate: unknown) => ({
      ...validVersion,
      definition: {
        ...validDefinition,
        rules: [
          {
            categoryCode: null,
            treatment: "taxable",
            components: [{ code: "vat", name: "VAT", rate, basis: "net" }]
          }
        ]
      }
    });

    expect(validateRuleVersionInput(withRate("0")).valid).toBe(true);
    expect(validateRuleVersionInput(withRate("0.375")).valid).toBe(true);
    expect(validateRuleVersionInput(withRate(11)).valid).toBe(false);
    expect(validateRuleVersionInput(withRate("-1")).valid).toBe(false);
    expect(validateRuleVersionInput(withRate("1001")).valid).toBe(false);
    expect(validateRuleVersionInput(withRate("1.1234567")).valid).toBe(false);
  });

  test("scale, mode, level, dates and unknown keys are all checked", () => {
    expect(
      errorsOf(validateRuleVersionInput({ ...validVersion, roundingScale: 7 }))
    ).toContain("roundingScale");
    expect(
      errorsOf(
        validateRuleVersionInput({ ...validVersion, roundingScale: 1.5 })
      )
    ).toContain("roundingScale");
    expect(
      errorsOf(
        validateRuleVersionInput({ ...validVersion, roundingMode: "banker" })
      )
    ).toContain("roundingMode");
    expect(
      errorsOf(
        validateRuleVersionInput({ ...validVersion, roundingLevel: "lines" })
      )
    ).toContain("roundingLevel");
    expect(
      errorsOf(
        validateRuleVersionInput({
          ...validVersion,
          effectiveFrom: "2026-02-30"
        })
      )
    ).toContain("effectiveFrom");
    expect(
      errorsOf(
        validateRuleVersionInput({ ...validVersion, currencyCode: "usd" })
      )
    ).toContain("currencyCode");
    expect(
      errorsOf(validateRuleVersionInput({ ...validVersion, surprise: true }))
    ).toContain("surprise");
    expect(validateRuleVersionInput(null).valid).toBe(false);
  });
});

describe("a client can never submit an authoritative tax amount", () => {
  test("a computed money key at the top level is refused with its own signal", () => {
    for (const key of [
      "taxAmount",
      "taxTotal",
      "vat",
      "total",
      "netTotal",
      "grossAmount"
    ]) {
      const result = validateQuoteInput({ ...validQuote, [key]: "0.00" });

      expect(result.valid).toBe(false);
      expect(result.valid === false && result.clientSuppliedTaxAmount).toBe(
        true
      );
    }
  });

  test("and so is one on a line", () => {
    for (const key of [
      "taxAmount",
      "tax",
      "vatAmount",
      "netAmount",
      "gross",
      "rate",
      "lineTotal"
    ]) {
      const result = validateSnapshotInput({
        ...validQuote,
        documentType: "order",
        documentId: "SO-1",
        lines: [
          { lineRef: "a", quantity: "1", unitPrice: "1.00", [key]: "0.00" }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.valid === false && result.clientSuppliedTaxAmount).toBe(
        true
      );
    }
  });

  test("an unrelated unknown key is refused, but not as a tax-amount attempt", () => {
    const result = validateQuoteInput({ ...validQuote, colour: "red" });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.clientSuppliedTaxAmount).toBe(
      false
    );
  });

  test("a reversal cannot carry an amount either", () => {
    const result = validateReversalInput({
      documentId: "RF-1",
      refundTax: "1.00"
    });

    expect(result.valid === false && result.clientSuppliedTaxAmount).toBe(true);
  });

  test("a clean quote passes", () => {
    expect(validateQuoteInput(validQuote).valid).toBe(true);
  });
});

describe("amounts arrive as strings", () => {
  test("a JSON number for quantity, price or discount is refused, not converted", () => {
    for (const lines of [
      [{ lineRef: "a", quantity: 2, unitPrice: "10.00" }],
      [{ lineRef: "a", quantity: "2", unitPrice: 10 }],
      [{ lineRef: "a", quantity: "2", unitPrice: "10.00", discount: 1 }]
    ]) {
      expect(validateQuoteInput({ ...validQuote, lines }).valid).toBe(false);
    }
  });

  test("precision, sign and shape are enforced", () => {
    for (const unitPrice of ["1e3", "-1.00", "1.1234567", "1,000", ""]) {
      expect(
        validateQuoteInput({
          ...validQuote,
          lines: [{ lineRef: "a", quantity: "1", unitPrice }]
        }).valid
      ).toBe(false);
    }
  });

  test("lines are bounded, unique and required", () => {
    expect(validateQuoteInput({ ...validQuote, lines: [] }).valid).toBe(false);
    expect(
      validateQuoteInput({
        ...validQuote,
        lines: [
          { lineRef: "a", quantity: "1", unitPrice: "1.00" },
          { lineRef: "a", quantity: "1", unitPrice: "1.00" }
        ]
      }).valid
    ).toBe(false);
    expect(
      validateQuoteInput({
        ...validQuote,
        lines: Array.from({ length: 501 }, (_, index) => ({
          lineRef: `l${index}`,
          quantity: "1",
          unitPrice: "1.00"
        }))
      }).valid
    ).toBe(false);
  });

  test("a snapshot needs a document reference, and a reversal a document id", () => {
    expect(validateSnapshotInput(validQuote).valid).toBe(false);
    expect(
      validateSnapshotInput({
        ...validQuote,
        documentType: "order",
        documentId: "SO-1"
      }).valid
    ).toBe(true);
    expect(validateReversalInput({}).valid).toBe(false);
    expect(
      validateReversalInput({
        documentId: "RF-1",
        lines: [{ lineRef: "a", quantity: "1" }],
        taxDate: "2026-07-01"
      }).valid
    ).toBe(true);
    expect(validateReversalInput({ documentId: "RF-1", lines: [] }).valid).toBe(
      false
    );
  });
});

describe("module descriptor", () => {
  test("every permission key a route checks is declared by the descriptor", () => {
    const declared = new Set(
      (taxModule.permissions ?? []).map(
        (permission) => `tax.${permission.activityCode}.${permission.action}`
      )
    );

    expect([...declared].sort()).toEqual(Object.values(TAX_PERMISSIONS).sort());
  });

  test("it declares exactly one navigation entry, gated on a seeded read permission, and the page it points at exists", async () => {
    const entries = taxModule.navigation ?? [];

    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe("/admin/tax");
    expect(entries[0]!.requiredPermission).toBe(TAX_PERMISSIONS.rulesRead);
    expect(await Bun.file("src/pages/admin/tax.astro").exists()).toBe(true);
    expect(taxModule.status).toBe("active");
  });

  test("its retention floor matches the database's immutability floor (sql/172)", () => {
    const descriptor = taxModule.dataLifecycle![0]!;

    expect(descriptor.retentionMinDays).toBe(1826);
  });
});

describe("the pricing mode is not the caller's to choose (H2b)", () => {
  test("a pricingMode key is an unrecognised field on /quote and /snapshots", () => {
    for (const result of [
      validateQuoteInput({ ...validQuote, pricingMode: "inclusive" }),
      validateSnapshotInput({
        ...validQuote,
        documentType: "order",
        documentId: "SO-1",
        pricingMode: "exclusive"
      })
    ]) {
      expect(result.valid).toBe(false);
      expect(errorsOf(result)).toContain("pricingMode");
      // Not a computed-money attempt: a different refusal from taxAmount.
      expect(result.valid === false && result.clientSuppliedTaxAmount).toBe(
        false
      );
    }
  });
});

describe("opaque identifiers (L3)", () => {
  const snapshotWith = (documentId: string) =>
    validateSnapshotInput({
      ...validQuote,
      documentType: "order",
      documentId
    });

  test("letters, digits and . _ : / - are accepted", () => {
    for (const id of [
      "SO-1",
      "INV/2026/0001",
      "pos:3:receipt_9",
      "a.b-c",
      "0"
    ]) {
      expect(snapshotWith(id).valid).toBe(true);
    }
  });

  test("spaces, control characters, markup, non-ASCII and over-length are refused", () => {
    for (const id of [
      "has space",
      " leading",
      "trailing ",
      "x\ny",
      "tab\tx",
      "<b>x</b>",
      'quote"x',
      "semi;colon",
      "pesanan-ü",
      "-starts-with-dash",
      "a".repeat(129)
    ]) {
      expect(snapshotWith(id).valid).toBe(false);
    }
  });

  test("a line reference and a reversal document id follow the same rule", () => {
    expect(
      validateQuoteInput({
        ...validQuote,
        lines: [{ lineRef: "has space", quantity: "1", unitPrice: "1.00" }]
      }).valid
    ).toBe(false);
    expect(validateReversalInput({ documentId: "RF 1" }).valid).toBe(false);
    expect(validateReversalInput({ documentId: "RF-1" }).valid).toBe(true);
  });
});

describe("the tax-date window setting (H2c)", () => {
  test("defaults to 7 days back and 1 forward", () => {
    expect(resolveTaxDateWindow({})).toEqual({ pastDays: 7, forwardDays: 1 });
  });

  test("is configurable, and a bad value falls back rather than widening the window", () => {
    expect(
      resolveTaxDateWindow({
        TAX_TAXDATE_PAST_DAYS: "30",
        TAX_TAXDATE_FORWARD_DAYS: "0"
      })
    ).toEqual({ pastDays: 30, forwardDays: 0 });

    for (const bad of ["-1", "abc", "1e3", "9999", "", " ", "7.5"]) {
      expect(
        resolveTaxDateWindow({
          TAX_TAXDATE_PAST_DAYS: bad,
          TAX_TAXDATE_FORWARD_DAYS: bad
        })
      ).toEqual({ pastDays: 7, forwardDays: 1 });
    }
  });

  test("the window edges are inclusive", () => {
    const window = { pastDays: 7, forwardDays: 1 };

    expect(isWithinTaxDateWindow(0, window)).toBe(true);
    expect(isWithinTaxDateWindow(-7, window)).toBe(true);
    expect(isWithinTaxDateWindow(1, window)).toBe(true);
    expect(isWithinTaxDateWindow(-8, window)).toBe(false);
    expect(isWithinTaxDateWindow(2, window)).toBe(false);
  });

  test("backdating is its own high-risk permission, declared by the module", () => {
    expect(TAX_PERMISSIONS.snapshotsBackdate).toBe("tax.snapshots.backdate");
    expect(isHighRiskAction("backdate")).toBe(true);
    expect(isHighRiskAction("reverse")).toBe(true);
  });
});

describe("which keys count as a computed-money attempt (CodeQL missing-anchor fix)", () => {
  test("keys that must be caught", () => {
    for (const key of [
      "taxAmount",
      "TaxAmount",
      "vat",
      "line_total",
      "line-tax",
      "grossTotal",
      "netTotal",
      "lineTax",
      "vatAmount",
      "total",
      "rate",
      "taxRate",
      "gst",
      "levy"
    ]) {
      expect({ key, caught: looksLikeComputedMoneyKey(key) }).toEqual({
        key,
        caught: true
      });
    }
  });

  test("keys that must not be", () => {
    for (const key of [
      "quantity",
      "unitPrice",
      "notes",
      "colour",
      "lineRef",
      "categoryCode",
      "discount",
      "documentId",
      "reason"
    ]) {
      expect({ key, caught: looksLikeComputedMoneyKey(key) }).toEqual({
        key,
        caught: false
      });
    }
  });

  test("conservative on purpose: a word that merely starts or ends with a money word is caught, which only changes the error code", () => {
    // Decided and documented in tax-validation.ts: refused either way.
    expect(looksLikeComputedMoneyKey("rateLimitHint")).toBe(true);
    expect(looksLikeComputedMoneyKey("generate")).toBe(true);

    const result = validateQuoteInput({ ...validQuote, rateLimitHint: "x" });

    expect(result.valid).toBe(false);
  });
});
