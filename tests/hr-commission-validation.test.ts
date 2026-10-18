/**
 * Request validation and the descriptor for `hr_commission` (Issue #950,
 * ADR-0132). Pure: no database. A rule is configuration: a client can never
 * assert its status, version or stamps, never attach a person, and never send
 * money as a JSON number.
 */
import { describe, expect, test } from "bun:test";

import {
  validateCreateRule,
  validateEmptyBody,
  validatePublishBody,
  validateUpdateRule
} from "../src/modules/hr-commission/domain/hr-commission-validation";
import { ruleContentDigest } from "../src/modules/hr-commission/domain/hr-commission-digest";
import { hrCommissionModule } from "../src/modules/hr-commission/module";

const base = {
  ruleKey: "room_upsell",
  name: "Room upsell",
  sourceType: "sale_line",
  calculation: "percent",
  rate: "2.5",
  currencyCode: "XTS",
  roundingMode: "half_up",
  roundingScale: 2,
  effectiveFrom: "2026-01-01"
};

function fields(result: { valid: boolean; errors?: { field: string }[] }) {
  return result.valid ? [] : result.errors!.map((e) => e.field);
}

describe("validateCreateRule", () => {
  test("accepts a minimal percent rule and nulls the optional fields", () => {
    const result = validateCreateRule(base);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.value).toMatchObject({
        ruleKey: "room_upsell",
        calculation: "percent",
        rate: "2.5",
        fixedAmount: null,
        minAmount: null,
        maxAmount: null,
        effectiveTo: null
      });
    }
  });

  test("accepts a fixed rule with clamps and an end date", () => {
    const result = validateCreateRule({
      ...base,
      calculation: "fixed",
      rate: undefined,
      fixedAmount: "10",
      minAmount: "1.5",
      maxAmount: "99.99",
      effectiveTo: "2026-07-01"
    });

    expect(result.valid).toBe(true);
  });

  test("rejects status, version, stamps and any person or employment reference", () => {
    for (const extra of [
      "status",
      "versionNo",
      "publishedAt",
      "createdBy",
      "employmentId",
      "profileId",
      "employeeName",
      "nik",
      "tiers",
      "formula",
      "expression"
    ]) {
      expect(fields(validateCreateRule({ ...base, [extra]: "x" }))).toContain(
        extra
      );
    }
  });

  test("money must be a string: a JSON number is refused", () => {
    expect(fields(validateCreateRule({ ...base, rate: 2.5 }))).toContain(
      "rate"
    );
    expect(
      fields(
        validateCreateRule({
          ...base,
          calculation: "fixed",
          rate: undefined,
          fixedAmount: 10
        })
      )
    ).toContain("fixedAmount");
  });

  test("rate: required for percent, 0 to 100, six places at most", () => {
    expect(fields(validateCreateRule({ ...base, rate: undefined }))).toContain(
      "rate"
    );
    expect(
      fields(validateCreateRule({ ...base, rate: "100.000001" }))
    ).toContain("rate");
    expect(fields(validateCreateRule({ ...base, rate: "-1" }))).toContain(
      "rate"
    );
    expect(
      fields(validateCreateRule({ ...base, rate: "1.1234567" }))
    ).toContain("rate");
    expect(fields(validateCreateRule({ ...base, rate: "1e2" }))).toContain(
      "rate"
    );
    expect(validateCreateRule({ ...base, rate: "100" }).valid).toBe(true);
    expect(validateCreateRule({ ...base, rate: "0" }).valid).toBe(true);
  });

  test("a rule is percent XOR fixed", () => {
    expect(fields(validateCreateRule({ ...base, fixedAmount: "1" }))).toContain(
      "fixedAmount"
    );
    expect(
      fields(
        validateCreateRule({ ...base, calculation: "fixed", fixedAmount: "1" })
      )
    ).toContain("rate");
    expect(
      fields(
        validateCreateRule({ ...base, calculation: "fixed", rate: undefined })
      )
    ).toContain("fixedAmount");
  });

  test("clamps: ordered, and no finer than the rounding scale", () => {
    expect(
      fields(validateCreateRule({ ...base, minAmount: "10", maxAmount: "5" }))
    ).toContain("minAmount");
    expect(
      fields(validateCreateRule({ ...base, minAmount: "0.001" }))
    ).toContain("minAmount");
    expect(
      validateCreateRule({ ...base, roundingScale: 3, minAmount: "0.001" })
        .valid
    ).toBe(true);
  });

  test("window: real dates, exclusive end after the start", () => {
    expect(
      fields(validateCreateRule({ ...base, effectiveFrom: "2026-02-30" }))
    ).toContain("effectiveFrom");
    expect(
      fields(validateCreateRule({ ...base, effectiveFrom: undefined }))
    ).toContain("effectiveFrom");
    expect(
      fields(validateCreateRule({ ...base, effectiveTo: "2026-01-01" }))
    ).toContain("effectiveTo");
    expect(
      fields(validateCreateRule({ ...base, effectiveTo: "2025-12-31" }))
    ).toContain("effectiveTo");
  });

  test("codes, currency, rounding and name", () => {
    expect(
      fields(validateCreateRule({ ...base, ruleKey: "Bad Key" }))
    ).toContain("ruleKey");
    expect(fields(validateCreateRule({ ...base, sourceType: "" }))).toContain(
      "sourceType"
    );
    expect(
      fields(validateCreateRule({ ...base, currencyCode: "xts" }))
    ).toContain("currencyCode");
    expect(
      fields(validateCreateRule({ ...base, roundingMode: "bankers" }))
    ).toContain("roundingMode");
    expect(fields(validateCreateRule({ ...base, roundingScale: 7 }))).toContain(
      "roundingScale"
    );
    expect(
      fields(validateCreateRule({ ...base, roundingScale: 1.5 }))
    ).toContain("roundingScale");
    expect(fields(validateCreateRule({ ...base, name: " " }))).toContain(
      "name"
    );
    expect(
      fields(validateCreateRule({ ...base, name: "x".repeat(121) }))
    ).toContain("name");
    expect(
      fields(validateCreateRule({ ...base, calculation: "tiered" }))
    ).toContain("calculation");
  });

  test("non-objects are refused", () => {
    for (const raw of [null, undefined, "x", 1, []]) {
      expect(validateCreateRule(raw).valid).toBe(false);
    }
  });
});

describe("validateUpdateRule", () => {
  const { ruleKey: _ignored, ...draft } = base;

  const digest = "a".repeat(64);

  test("accepts a full draft body that names the digest it was based on", () => {
    expect(
      validateUpdateRule({ ...draft, expectedContentDigest: digest }).valid
    ).toBe(true);
  });

  test("an edit that does not name a well-formed digest is refused", () => {
    for (const bad of [undefined, "", "abc", "A".repeat(64), 5]) {
      expect(
        fields(validateUpdateRule({ ...draft, expectedContentDigest: bad }))
      ).toContain("expectedContentDigest");
    }
  });

  test("the rule key can never be changed", () => {
    expect(
      fields(validateUpdateRule({ ...base, expectedContentDigest: digest }))
    ).toContain("ruleKey");
  });
});

describe("validatePublishBody", () => {
  test("requires the digest of the reviewed terms and nothing else", () => {
    expect(
      validatePublishBody({ expectedContentDigest: "b".repeat(64) }).valid
    ).toBe(true);
    expect(validatePublishBody({}).valid).toBe(false);
    expect(validatePublishBody(undefined).valid).toBe(false);
    expect(
      fields(
        validatePublishBody({
          expectedContentDigest: "b".repeat(64),
          effectiveFrom: "2026-01-01"
        })
      )
    ).toContain("effectiveFrom");
  });
});

describe("ruleContentDigest", () => {
  const terms = {
    ruleKey: "r",
    versionNo: 1,
    name: "n",
    sourceType: "s",
    calculation: "percent",
    rate: "2.5",
    fixedAmount: null,
    minAmount: null,
    maxAmount: null,
    currencyCode: "XTS",
    roundingMode: "half_up",
    roundingScale: 2,
    effectiveFrom: "2026-01-01",
    effectiveTo: null
  };

  test("is stable, and every term moves it", () => {
    const base = ruleContentDigest(terms);

    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(ruleContentDigest({ ...terms })).toBe(base);

    const variants: Record<string, unknown> = {
      ruleKey: "r2",
      versionNo: 2,
      name: "n2",
      sourceType: "s2",
      calculation: "fixed",
      rate: "2.6",
      fixedAmount: "1",
      minAmount: "0",
      maxAmount: "9",
      currencyCode: "ZZZ",
      roundingMode: "down",
      roundingScale: 3,
      effectiveFrom: "2026-01-02",
      effectiveTo: "2027-01-01"
    };

    for (const [key, value] of Object.entries(variants)) {
      expect(ruleContentDigest({ ...terms, [key]: value })).not.toBe(base);
    }
  });
});

describe("validateEmptyBody", () => {
  test("accepts nothing, or an empty object, and nothing else", () => {
    expect(validateEmptyBody(undefined).valid).toBe(true);
    expect(validateEmptyBody({}).valid).toBe(true);
    expect(validateEmptyBody({ reason: "x" }).valid).toBe(false);
  });
});

describe("the hr_commission descriptor", () => {
  test("is active (it declares its own-commission screen, Issue #952) and depends only on tenant_admin, hr_workforce and the domain-event outbox (Issue #1109)", () => {
    expect(hrCommissionModule.status).toBe("active");
    expect([...hrCommissionModule.dependencies].sort()).toEqual([
      "domain_event_runtime",
      "hr_workforce",
      "tenant_admin"
    ]);
  });

  test("provides the commission_accrual port and publishes exactly the voided event (Issue #1109)", () => {
    expect(hrCommissionModule.capabilities?.provides).toEqual([
      "commission_accrual"
    ]);
    expect(hrCommissionModule.events?.publishes).toEqual([
      "awcms.hr.commission.voided"
    ]);
  });

  test("declares the five rule permissions, the six accrual permissions and the one own-accrual read, and no payroll or compensation power", () => {
    const keys = (hrCommissionModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );

    expect(keys.sort()).toEqual([
      "accruals.accrue",
      "accruals.approve",
      "accruals.cancel",
      "accruals.pay",
      "accruals.read",
      "accruals.release",
      "my_accruals.read",
      "rules.create",
      "rules.publish",
      "rules.read",
      "rules.retire",
      "rules.update"
    ]);
  });

  test("no table asserts a retention period or a purge (BOUNDED_BY_DESIGN answers all three); subject-data answers every table", () => {
    // No table asserts a retention period or a purge mode: nothing purges. All
    // three are answered by BOUNDED_BY_DESIGN entries (retained, no period).
    expect(hrCommissionModule.dataLifecycle ?? []).toEqual([]);

    expect(hrCommissionModule.subjectData?.map((d) => d.tableName)).toEqual([
      "awcms_hr_commission_rules",
      "awcms_hr_commission_accruals",
      "awcms_hr_commission_transitions"
    ]);
  });
});
