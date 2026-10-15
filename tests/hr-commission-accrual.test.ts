/**
 * Pure tests for the accrual ledger's domain (Issue #951, ADR-0132): the state
 * machine, the two date rules, request validation and the canonical digest.
 * No database. The DATABASE twin of every rule here is exercised, against the
 * same tables, in `integration/hr-commission-accrual-database.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import type { CommissionAccrualRequest } from "../src/modules/_shared/ports/commission-accrual-port";
import {
  accrueRefusal,
  transitionRefusal
} from "../src/modules/hr-commission/application/hr-commission-accrual-route-support";
import {
  ACCRUAL_STATUSES,
  MAX_EVENT_AGE_DAYS,
  canTransition,
  employmentEarnsOn,
  isBackdatedWindow,
  isEventTooOld,
  sodViolation,
  occurredOnMatchesInstant,
  transitionTarget,
  type AccrualAction
} from "../src/modules/hr-commission/domain/hr-commission-accrual-state";
import {
  MAX_FUTURE_SKEW_MS,
  accrualRequestDigest,
  validateAccrualRequest,
  validateAccrueBody,
  validatePayBody,
  validateVoidBody
} from "../src/modules/hr-commission/domain/hr-commission-accrual-validation";
import { validatePublishBody } from "../src/modules/hr-commission/domain/hr-commission-validation";

const NOW = new Date("2026-10-12T08:00:00Z");
const EMPLOYMENT = "11111111-1111-4111-8111-111111111111";

function request(
  extra: Partial<CommissionAccrualRequest> = {}
): CommissionAccrualRequest {
  return {
    employmentId: EMPLOYMENT,
    ruleKey: "upsell",
    source: { type: "sale_line", ref: "ORD-1", line: "1" },
    baseAmount: "1000.10",
    currencyCode: "XTS",
    occurredAt: new Date("2026-10-11T10:00:00Z"),
    occurredOn: "2026-10-11",
    ...extra
  };
}

describe("the accrual state machine", () => {
  const legal = new Set([
    "pending>approved",
    "pending>voided",
    "approved>payable",
    "approved>voided",
    "payable>paid"
  ]);

  test("exactly the five edges exist, and no others", () => {
    for (const from of ACCRUAL_STATUSES) {
      for (const to of ACCRUAL_STATUSES) {
        expect(canTransition(from, to)).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  test("a voided accrual can never be paid, and paid and voided are terminal", () => {
    expect(canTransition("voided", "paid")).toBe(false);
    expect(transitionTarget("voided", "pay")).toBeNull();

    for (const to of ACCRUAL_STATUSES) {
      expect(canTransition("voided", to)).toBe(false);
      expect(canTransition("paid", to)).toBe(false);
    }
  });

  test("each action leads only along its own edges", () => {
    const table: [AccrualAction, string, string | null][] = [
      ["approve", "pending", "approved"],
      ["approve", "approved", null],
      ["release", "approved", "payable"],
      ["release", "pending", null],
      ["void", "pending", "voided"],
      ["void", "approved", "voided"],
      ["void", "payable", null],
      ["pay", "payable", "paid"],
      ["pay", "approved", null],
      ["pay", "voided", null]
    ];

    for (const [action, from, to] of table) {
      expect(
        transitionTarget(from as (typeof ACCRUAL_STATUSES)[number], action)
      ).toBe(to as never);
    }
  });
});

describe("segregation of duties", () => {
  const parties = {
    beneficiaryUserId: "ben",
    snapshotBeneficiaryUserId: "ben",
    createdBy: "maker",
    approvedBy: "checker"
  };

  test("the beneficiary can approve, release or pay none of their own accrual, but may void it", () => {
    expect(sodViolation("approve", "ben", parties)).toBe("beneficiary");
    expect(sodViolation("release", "ben", parties)).toBe("beneficiary");
    expect(sodViolation("pay", "ben", parties)).toBe("beneficiary");
    expect(sodViolation("void", "ben", parties)).toBeNull();
  });

  test("the creator cannot approve and the approver cannot pay; others may", () => {
    expect(sodViolation("approve", "maker", parties)).toBe("creator_approves");
    expect(sodViolation("pay", "checker", parties)).toBe("approver_pays");
    expect(sodViolation("approve", "other", parties)).toBeNull();
    expect(sodViolation("release", "maker", parties)).toBeNull();
    expect(sodViolation("release", "checker", parties)).toBeNull();
    expect(sodViolation("pay", "maker", parties)).toBeNull();
    expect(sodViolation("pay", "other", parties)).toBeNull();
  });

  test("unstamped creator and approver constrain nothing when the beneficiary is known", () => {
    const parties = {
      beneficiaryUserId: "ben",
      snapshotBeneficiaryUserId: "ben",
      createdBy: null,
      approvedBy: null
    };

    expect(sodViolation("approve", "x", parties)).toBeNull();
    expect(sodViolation("pay", "x", parties)).toBeNull();
  });

  test("an unidentifiable beneficiary fails CLOSED on approve, release and pay (Issue #1019)", () => {
    for (const snapshotBeneficiaryUserId of [null]) {
      const parties = {
        beneficiaryUserId: null,
        snapshotBeneficiaryUserId,
        createdBy: null,
        approvedBy: null
      };

      expect(sodViolation("approve", "x", parties)).toBe(
        "beneficiary_unresolved"
      );
      expect(sodViolation("release", "x", parties)).toBe(
        "beneficiary_unresolved"
      );
      expect(sodViolation("pay", "x", parties)).toBe("beneficiary_unresolved");
      // Voiding moves no money and stays the safe way out.
      expect(sodViolation("void", "x", parties)).toBeNull();
    }
  });

  test("the birth snapshot binds even when the employment is unlinked now, and the current link binds even without a snapshot", () => {
    const unlinkedNow = {
      beneficiaryUserId: null,
      snapshotBeneficiaryUserId: "ben",
      createdBy: null,
      approvedBy: null
    };

    expect(sodViolation("approve", "ben", unlinkedNow)).toBe("beneficiary");
    expect(sodViolation("release", "ben", unlinkedNow)).toBe("beneficiary");
    expect(sodViolation("pay", "ben", unlinkedNow)).toBe("beneficiary");
    expect(sodViolation("approve", "other", unlinkedNow)).toBeNull();

    const relinkedToOther = {
      beneficiaryUserId: "new",
      snapshotBeneficiaryUserId: "ben",
      createdBy: null,
      approvedBy: null
    };

    expect(sodViolation("approve", "ben", relinkedToOther)).toBe("beneficiary");
    expect(sodViolation("approve", "new", relinkedToOther)).toBe("beneficiary");

    const noSnapshot = {
      beneficiaryUserId: "ben",
      snapshotBeneficiaryUserId: null,
      createdBy: null,
      approvedBy: null
    };

    expect(sodViolation("release", "ben", noSnapshot)).toBe("beneficiary");
  });
});

describe("the date rules", () => {
  test("an event may be at most 730 days old", () => {
    const now = new Date("2026-10-12T08:00:00Z");
    const day = 86_400_000;

    expect(MAX_EVENT_AGE_DAYS).toBe(730);
    expect(isEventTooOld(new Date(now.getTime() - 729 * day), now)).toBe(false);
    expect(isEventTooOld(new Date(now.getTime() - 730 * day), now)).toBe(false);
    expect(isEventTooOld(new Date(now.getTime() - 731 * day), now)).toBe(true);
  });

  test("a window is back-dated exactly when it starts before today (UTC)", () => {
    expect(isBackdatedWindow("2026-10-11", "2026-10-12")).toBe(true);
    expect(isBackdatedWindow("2026-10-12", "2026-10-12")).toBe(false);
    expect(isBackdatedWindow("2026-10-13", "2026-10-12")).toBe(false);
  });

  test("an employment earns on its hire day and its termination day, not before or after", () => {
    const employment = {
      hiredOn: "2026-03-01",
      terminatedOn: "2026-06-30",
      deleted: false
    };

    expect(employmentEarnsOn(employment, "2026-02-28")).toBe(false);
    expect(employmentEarnsOn(employment, "2026-03-01")).toBe(true);
    expect(employmentEarnsOn(employment, "2026-06-30")).toBe(true);
    expect(employmentEarnsOn(employment, "2026-07-01")).toBe(false);
    expect(
      employmentEarnsOn({ ...employment, terminatedOn: null }, "2030-01-01")
    ).toBe(true);
    expect(
      employmentEarnsOn({ ...employment, deleted: true }, "2026-04-01")
    ).toBe(false);
  });

  test("occurredOn may differ from the UTC date by at most one day", () => {
    const at = new Date("2026-10-11T23:30:00Z");

    expect(occurredOnMatchesInstant("2026-10-10", at)).toBe(true);
    expect(occurredOnMatchesInstant("2026-10-11", at)).toBe(true);
    expect(occurredOnMatchesInstant("2026-10-12", at)).toBe(true);
    expect(occurredOnMatchesInstant("2026-10-13", at)).toBe(false);
    expect(occurredOnMatchesInstant("2026-10-09", at)).toBe(false);
  });
});

describe("accrual request validation", () => {
  test("a well-formed percent request is valid", () => {
    expect(validateAccrualRequest(request(), NOW).valid).toBe(true);
  });

  test("exactly one of baseAmount and units", () => {
    expect(
      validateAccrualRequest(request({ baseAmount: undefined }), NOW).valid
    ).toBe(false);
    expect(validateAccrualRequest(request({ units: 2 }), NOW).valid).toBe(
      false
    );
    expect(
      validateAccrualRequest(request({ baseAmount: undefined, units: 2 }), NOW)
        .valid
    ).toBe(true);
  });

  test("money must be a string with at most 6 decimals, never negative, never a number", () => {
    for (const bad of [
      12.5 as unknown as string,
      "-1",
      "1e3",
      "1.0000001",
      "NaN",
      "",
      "1,5"
    ]) {
      expect(
        validateAccrualRequest(request({ baseAmount: bad }), NOW).valid
      ).toBe(false);
    }
  });

  test("units are whole numbers within the cap", () => {
    for (const bad of [1.5, -1, 1_000_001, Number.NaN]) {
      expect(
        validateAccrualRequest(
          request({ baseAmount: undefined, units: bad }),
          NOW
        ).valid
      ).toBe(false);
    }
  });

  test("source identity is bounded and restricted", () => {
    const bad = [
      { type: "Sale", ref: "x" },
      { type: "sale_line", ref: "" },
      { type: "sale_line", ref: "a b" },
      { type: "sale_line", ref: "x".repeat(201) },
      { type: "sale_line", ref: "x", line: "y".repeat(65) }
    ];

    for (const source of bad) {
      expect(validateAccrualRequest(request({ source }), NOW).valid).toBe(
        false
      );
    }
  });

  test("an event more than a day ahead of the clock is refused", () => {
    const future = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS + 1000);

    expect(
      validateAccrualRequest(
        request({ occurredAt: future, occurredOn: "2026-10-13" }),
        NOW
      ).valid
    ).toBe(false);
  });

  test("an event older than 730 days is refused", () => {
    const old = new Date(NOW.getTime() - 800 * 86_400_000);

    expect(
      validateAccrualRequest(
        request({
          occurredAt: old,
          occurredOn: old.toISOString().slice(0, 10)
        }),
        NOW
      ).valid
    ).toBe(false);
  });

  test("a non-string where a string is required is a validation error, never a coerced pass or a throw", () => {
    const bad = [
      ["employmentId", [EMPLOYMENT]],
      ["employmentId", { toString: () => EMPLOYMENT }],
      ["ruleKey", ["upsell"]],
      ["ruleKey", { a: 1 }],
      ["currencyCode", ["XTS"]],
      ["currencyCode", 5],
      ["occurredOn", ["2026-10-11"]],
      ["source", ["sale_line"]],
      ["source", "sale_line"],
      ["source", { type: ["sale_line"], ref: "x" }],
      ["source", { type: "sale_line", ref: ["ORD-1"] }],
      ["source", { type: "sale_line", ref: { a: 1 } }],
      ["source", { type: "sale_line", ref: "x", line: ["1"] }],
      ["correlationId", ["c"]]
    ] as const;

    for (const [field, value] of bad) {
      const result = validateAccrualRequest(
        { ...request(), [field]: value } as unknown as CommissionAccrualRequest,
        NOW
      );

      expect({ field, valid: result.valid }).toEqual({ field, valid: false });
    }

    // ...and the same through the HTTP body validator.
    for (const [field, value] of bad) {
      const body = {
        employmentId: EMPLOYMENT,
        ruleKey: "upsell",
        source: { type: "sale_line", ref: "ORD-1" },
        baseAmount: "10",
        currencyCode: "XTS",
        occurredAt: "2026-10-11T10:00:00Z",
        occurredOn: "2026-10-11",
        [field]: value
      };

      expect(validateAccrueBody(body, NOW).valid).toBe(false);
    }
  });

  test("occurredOn must sit within a day of the instant", () => {
    expect(
      validateAccrualRequest(request({ occurredOn: "2026-09-01" }), NOW).valid
    ).toBe(false);
  });

  test("the body refuses fields a client must never assert", () => {
    const body = {
      employmentId: EMPLOYMENT,
      ruleKey: "upsell",
      source: { type: "sale_line", ref: "ORD-1" },
      baseAmount: "10",
      currencyCode: "XTS",
      occurredAt: "2026-10-11T10:00:00Z",
      occurredOn: "2026-10-11"
    };

    expect(validateAccrueBody(body, NOW).valid).toBe(true);

    for (const extra of [
      { amount: "5" },
      { status: "paid" },
      { ruleVersion: 1 },
      { approvedBy: EMPLOYMENT },
      { source: { type: "sale_line", ref: "x", amount: "1" } }
    ]) {
      expect(validateAccrueBody({ ...body, ...extra }, NOW).valid).toBe(false);
    }

    expect(validateAccrueBody({ ...body, baseAmount: 10 }, NOW).valid).toBe(
      false
    );
    expect(
      validateAccrueBody({ ...body, occurredAt: "yesterday" }, NOW).valid
    ).toBe(false);
    expect(validateAccrueBody(null, NOW).valid).toBe(false);
  });
});

describe("the canonical request digest", () => {
  test("is stable and ignores the correlation id", () => {
    expect(accrualRequestDigest(request())).toBe(
      accrualRequestDigest(request({ correlationId: "corr-1" }))
    );
    expect(accrualRequestDigest(request())).toMatch(/^[0-9a-f]{64}$/);
  });

  test("treats equal decimals as one request, and a different amount, date, rule or currency as another", () => {
    const base = accrualRequestDigest(request({ baseAmount: "10" }));

    expect(accrualRequestDigest(request({ baseAmount: "10.000000" }))).toBe(
      base
    );
    expect(accrualRequestDigest(request({ baseAmount: "10.01" }))).not.toBe(
      base
    );
    expect(
      accrualRequestDigest(request({ baseAmount: "10", ruleKey: "x" }))
    ).not.toBe(base);
    expect(
      accrualRequestDigest(request({ baseAmount: "10", currencyCode: "XXX" }))
    ).not.toBe(base);
    expect(
      accrualRequestDigest(
        request({ baseAmount: "10", occurredOn: "2026-10-10" })
      )
    ).not.toBe(base);
  });

  test("the employment id is case-insensitive", () => {
    expect(
      accrualRequestDigest(request({ employmentId: EMPLOYMENT.toUpperCase() }))
    ).toBe(accrualRequestDigest(request()));
  });
});

describe("transition and publish bodies", () => {
  test("void takes a code, never free text", () => {
    expect(validateVoidBody({ reasonCode: "sale_cancelled" })).toEqual({
      valid: true,
      value: { reasonCode: "sale_cancelled" }
    });
    expect(validateVoidBody({})).toEqual({
      valid: true,
      value: { reasonCode: null }
    });
    expect(
      validateVoidBody({ reasonCode: "the customer was rude" }).valid
    ).toBe(false);
    expect(validateVoidBody({ note: "x" }).valid).toBe(false);
  });

  test("pay takes an opaque reference, never an account number shape", () => {
    expect(validatePayBody({ paymentReference: "batch-2026/10:1" }).valid).toBe(
      true
    );
    expect(validatePayBody({ paymentReference: "has space" }).valid).toBe(
      false
    );
    expect(validatePayBody({ paymentReference: "x".repeat(65) }).valid).toBe(
      false
    );
    expect(validatePayBody({ amount: "1" }).valid).toBe(false);
  });

  test("publish carries an optional trimmed reason of at most 500 characters", () => {
    const digest = "a".repeat(64);

    expect(validatePublishBody({ expectedContentDigest: digest })).toEqual({
      valid: true,
      value: { expectedContentDigest: digest, backdatedReason: null }
    });
    expect(
      validatePublishBody({
        expectedContentDigest: digest,
        backdatedReason: "  agreed with finance  "
      })
    ).toEqual({
      valid: true,
      value: {
        expectedContentDigest: digest,
        backdatedReason: "agreed with finance"
      }
    });

    for (const bad of ["   ", "x".repeat(501), 5]) {
      expect(
        validatePublishBody({
          expectedContentDigest: digest,
          backdatedReason: bad
        }).valid
      ).toBe(false);
    }
  });
});

describe("refusal mapping", () => {
  test("every refusal is a distinct, stable HTTP code", async () => {
    const codes = async (response: Response | null) =>
      response
        ? `${response.status} ${((await response.json()) as { error: { code: string } }).error.code}`
        : null;

    expect(
      await codes(accrueRefusal({ outcome: "source_conflict", accrualId: "x" }))
    ).toBe("409 SOURCE_CONFLICT");
    expect(await codes(accrueRefusal({ outcome: "no_effective_rule" }))).toBe(
      "409 NO_EFFECTIVE_RULE"
    );
    expect(
      await codes(accrueRefusal({ outcome: "employment_not_found" }))
    ).toBe("404 EMPLOYMENT_NOT_FOUND");
    expect(
      await codes(accrueRefusal({ outcome: "employment_not_eligible" }))
    ).toBe("409 EMPLOYMENT_NOT_ELIGIBLE");
    expect(
      await codes(accrueRefusal({ outcome: "input_invalid", message: "m" }))
    ).toBe("400 VALIDATION_ERROR");
    expect(
      await codes(
        transitionRefusal("pay", { outcome: "invalid_state", status: "voided" })
      )
    ).toBe("409 ACCRUAL_INVALID_STATE");
    expect(
      await codes(
        transitionRefusal("approve", {
          outcome: "sod_violation",
          kind: "beneficiary"
        })
      )
    ).toBe("403 APPROVE_OWN_ACCRUAL_FORBIDDEN");
    expect(transitionRefusal("pay", { outcome: "not_found" })?.status).toBe(
      404
    );
  });
});
