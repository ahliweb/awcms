/**
 * Pure unit tests for procurement's vocabulary, validators, state machine and
 * identifier masking (Issue #888, ADR-0128). The database-level invariants are in
 * `tests/integration/procurement-*.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { prepareIdentifier } from "../src/modules/procurement/domain/procurement-identifier";
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TRANSITIONS,
  LEDGER_SOURCE_TYPE,
  canTransition,
  classifyIdentifier
} from "../src/modules/procurement/domain/procurement-types";
import {
  normalizeDecimalInput,
  validateAddIdentifier,
  validateCreateDocument,
  validateCreateSupplier,
  validateEmptyBody,
  validatePolicyInput,
  validateReason,
  validateUpdateSupplier
} from "../src/modules/procurement/domain/procurement-validation";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function line(over: Record<string, unknown> = {}) {
  return {
    itemType: "commerce.variant",
    itemRef: "sku-1",
    sku: "SKU-1",
    itemName: "Item",
    quantity: "2",
    unitCost: "1.5",
    ...over
  };
}

function receive(over: Record<string, unknown> = {}) {
  return {
    mode: "receive",
    supplierId: UUID_A,
    locationId: UUID_B,
    lines: [line()],
    ...over
  };
}

function errorsOf(result: { valid: boolean; errors?: { field: string }[] }) {
  return result.valid ? [] : result.errors!.map((e) => e.field);
}

describe("state machine", () => {
  test("only the documented transitions are legal", () => {
    expect(DOCUMENT_TRANSITIONS).toEqual({
      draft: ["submitted", "cancelled"],
      submitted: ["finalised", "cancelled"],
      finalised: ["reversed"],
      cancelled: [],
      reversed: []
    });
  });

  test("a document cannot skip submit, return to draft, or leave a terminal state", () => {
    expect(canTransition("draft", "finalised")).toBe(false);
    expect(canTransition("submitted", "draft")).toBe(false);
    expect(canTransition("finalised", "cancelled")).toBe(false);
    expect(canTransition("finalised", "submitted")).toBe(false);

    for (const terminal of ["cancelled", "reversed"] as const) {
      for (const next of DOCUMENT_STATUSES) {
        expect(canTransition(terminal, next)).toBe(false);
      }
    }
  });

  test("ledger source types are server-owned, distinct, and never the ledger's reserved 'reversal'", () => {
    const all = Object.values(LEDGER_SOURCE_TYPE).flatMap((t) => [
      t.post,
      t.reversal
    ]);

    expect(new Set(all).size).toBe(8);
    expect(all).not.toContain("reversal");
    expect(all.every((type) => /^[a-z][a-z0-9_.-]{0,63}$/.test(type))).toBe(
      true
    );
  });
});

describe("exact decimals", () => {
  test("accepts decimal text and round-tripping numbers, canonicalised", () => {
    expect(normalizeDecimalInput("12.500")).toBe("12.5");
    expect(normalizeDecimalInput("007")).toBe("7");
    expect(normalizeDecimalInput(3)).toBe("3");
    expect(normalizeDecimalInput("0.000001")).toBe("0.000001");
  });

  test("refuses exponent notation, signs, excess precision and junk", () => {
    for (const bad of [1e-7, "1e3", "-1", "1.1234567", "abc", "", null, {}]) {
      expect(normalizeDecimalInput(bad)).toBeNull();
    }

    expect(normalizeDecimalInput("123456789012345")).toBeNull();
  });
});

describe("document validation", () => {
  test("a valid receipt parses and canonicalises its numbers", () => {
    const result = validateCreateDocument(
      receive({ lines: [line({ quantity: 2, unitCost: "1.50" })] })
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.lines[0]).toMatchObject({
        quantity: "2",
        unitCost: "1.5",
        unitCode: "unit"
      });
      expect(result.value.currencyCode).toBe("IDR");
    }
  });

  test("a client cannot assert lifecycle state, totals, snapshots or balances", () => {
    for (const forbidden of [
      "status",
      "totalCost",
      "documentNo",
      "supplierName",
      "approvalStatus",
      "finalisedAt",
      "onHand"
    ]) {
      expect(
        errorsOf(validateCreateDocument(receive({ [forbidden]: "x" })))
      ).toContain(forbidden);
    }

    expect(
      errorsOf(
        validateCreateDocument(receive({ lines: [line({ lineTotal: "1" })] }))
      )
    ).toContain("lines[0].lineTotal");
  });

  test("the mode decides the shape", () => {
    expect(
      errorsOf(validateCreateDocument(receive({ supplierId: undefined })))
    ).toContain("supplierId");
    expect(
      errorsOf(validateCreateDocument(receive({ sourceLocationId: UUID_A })))
    ).toContain("sourceLocationId");

    const transfer = {
      mode: "transfer",
      locationId: UUID_B,
      sourceLocationId: UUID_A,
      lines: [line({ unitCost: undefined })]
    };

    expect(validateCreateDocument(transfer).valid).toBe(true);
    expect(
      errorsOf(validateCreateDocument({ ...transfer, supplierId: UUID_A }))
    ).toContain("supplierId");
    expect(
      errorsOf(
        validateCreateDocument({ ...transfer, sourceLocationId: UUID_B })
      )
    ).toContain("sourceLocationId");
    expect(
      errorsOf(
        validateCreateDocument({ ...transfer, sourceLocationId: undefined })
      )
    ).toContain("sourceLocationId");
  });

  test("a supplier return needs a cost on every line (the approval threshold is cost-based); a transfer and a requisition do not", () => {
    const supplierReturn = (cost: string | undefined) => ({
      mode: "supplier_return",
      supplierId: UUID_A,
      locationId: UUID_B,
      lines: [line({ unitCost: cost })]
    });

    expect(
      errorsOf(validateCreateDocument(supplierReturn(undefined)))
    ).toContain("lines[0].unitCost");
    expect(validateCreateDocument(supplierReturn("1.5")).valid).toBe(true);

    for (const mode of ["transfer", "requisition"]) {
      expect(
        validateCreateDocument({
          mode,
          locationId: UUID_B,
          sourceLocationId: UUID_A,
          lines: [line({ unitCost: undefined })]
        }).valid
      ).toBe(true);
    }
  });

  test("a receipt needs a cost on every line; quantity must be positive; items are unique", () => {
    expect(
      errorsOf(
        validateCreateDocument(
          receive({ lines: [line({ unitCost: undefined })] })
        )
      )
    ).toContain("lines[0].unitCost");
    expect(
      errorsOf(
        validateCreateDocument(receive({ lines: [line({ quantity: 0 })] }))
      )
    ).toContain("lines[0].quantity");
    expect(
      errorsOf(
        validateCreateDocument(receive({ lines: [line({ quantity: -1 })] }))
      )
    ).toContain("lines[0].quantity");
    expect(
      errorsOf(validateCreateDocument(receive({ lines: [line(), line()] })))
    ).toContain("lines[1].itemRef");
    expect(errorsOf(validateCreateDocument(receive({ lines: [] })))).toContain(
      "lines"
    );
  });

  test("a credential-shaped item reference is a 400, not a 500 from the event guard", () => {
    const jwtLike = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk"
    ].join(".");

    expect(
      errorsOf(
        validateCreateDocument(receive({ lines: [line({ itemRef: jwtLike })] }))
      )
    ).toContain("lines[0].itemRef");
  });

  test("dates and currency are validated", () => {
    expect(
      errorsOf(validateCreateDocument(receive({ documentDate: "2026-02-31" })))
    ).toContain("documentDate");
    expect(
      validateCreateDocument(receive({ documentDate: "2026-02-28" })).valid
    ).toBe(true);
    expect(
      errorsOf(validateCreateDocument(receive({ currencyCode: "idr" })))
    ).toContain("currencyCode");
  });

  test("an unknown mode stops validation early", () => {
    expect(errorsOf(validateCreateDocument({ mode: "sale" }))).toEqual([
      "mode"
    ]);
  });
});

describe("supplier, identifier, reason and policy validation", () => {
  test("a supplier needs a code and a name; labels are normalised and bounded", () => {
    const ok = validateCreateSupplier({
      vendorCode: "ACME-1",
      name: "  Acme  ",
      categories: ["Food", "food", "dry-goods"],
      tags: []
    });

    expect(ok.valid).toBe(true);
    if (ok.valid) {
      expect(ok.value.name).toBe("Acme");
      expect(ok.value.categories).toEqual(["dry-goods", "food"]);
    }

    expect(errorsOf(validateCreateSupplier({ name: "x" }))).toContain(
      "vendorCode"
    );
    expect(
      errorsOf(validateCreateSupplier({ vendorCode: "a b", name: "x" }))
    ).toContain("vendorCode");
    expect(
      errorsOf(
        validateCreateSupplier({
          vendorCode: "A",
          name: "x",
          categories: Array.from({ length: 21 }, (_, i) => `c${i}`)
        })
      )
    ).toContain("categories");
  });

  test("an update must say something and may detach the party", () => {
    expect(errorsOf(validateUpdateSupplier({}))).toContain("body");
    const detach = validateUpdateSupplier({ profileId: null });

    expect(detach.valid && detach.value.profileId).toBeNull();
  });

  test("identifier types are closed; reason is required where it must be", () => {
    expect(
      errorsOf(validateAddIdentifier({ type: "passport", value: "x" }))
    ).toContain("type");
    expect(errorsOf(validateReason(true)({}))).toContain("reason");
    expect(validateReason(false)(undefined).valid).toBe(true);
    expect(validateEmptyBody(null).valid).toBe(true);
    expect(errorsOf(validateEmptyBody({ force: true }))).toContain("force");
  });

  test("the approval threshold is a decimal or null, and must be stated", () => {
    expect(validatePolicyInput({ approvalThreshold: null }).valid).toBe(true);
    expect(validatePolicyInput({ approvalThreshold: "100.5" }).valid).toBe(
      true
    );
    expect(errorsOf(validatePolicyInput({}))).toContain("approvalThreshold");
    expect(errorsOf(validatePolicyInput({ approvalThreshold: -1 }))).toContain(
      "approvalThreshold"
    );
  });
});

describe("sensitive identifier pipeline", () => {
  // Obviously synthetic values.
  const TAX = "00.000.000.0-000.000";

  test("never returns the raw value in the mask, hashes the normalised value, classifies by type", () => {
    const prepared = prepareIdentifier("tax_id", ` ${TAX} `);

    expect(prepared.normalizedValue).toBe(TAX);
    expect(prepared.maskedValue).toBe("****************.000");
    expect(prepared.maskedValue).not.toContain(TAX);
    expect(prepared.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.valueHash).toBe(prepareIdentifier("tax_id", TAX).valueHash);

    expect(classifyIdentifier("tax_id")).toBe("sensitive");
    expect(classifyIdentifier("business_id")).toBe("sensitive");
    expect(classifyIdentifier("payment_ref")).toBe("confidential");
  });

  test("a contact reference that looks like an address takes the tail mask, not the email mask", () => {
    const prepared = prepareIdentifier("contact_ref", "someone@vendor.example");

    expect(prepared.maskedValue).not.toContain("vendor.example");
    expect(prepared.maskedValue).not.toContain("@");
  });

  test("a short value is fully masked", () => {
    expect(prepareIdentifier("other", "abcd").maskedValue).toBe("****");
  });

  test("a payment/contact/other reference under 8 characters shows no tail at all (audit L3)", () => {
    expect(prepareIdentifier("payment_ref", "abcdefg").maskedValue).toBe(
      "*******"
    );
    expect(prepareIdentifier("contact_ref", "123456").maskedValue).toBe(
      "******"
    );
    expect(prepareIdentifier("other", "abcdefg").maskedValue).not.toContain(
      "defg"
    );
    // From 8 characters the shared tail mask applies again.
    expect(prepareIdentifier("payment_ref", "12345678").maskedValue).toBe(
      "****5678"
    );
  });
});
