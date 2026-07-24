/**
 * Unit tests for `data_lifecycle`'s pure legal-hold domain rules
 * (`domain/legal-hold.ts`). No DB — these guard the critical invariant "an
 * active legal hold overrides ordinary retention/purge and cannot be silently
 * bypassed" in complete isolation from Postgres.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateLegalHoldForDescriptor,
  isLegalHoldActive,
  validateCreateLegalHoldInput,
  validateReleaseLegalHoldInput,
  type LegalHoldRecord
} from "../src/modules/data-lifecycle/domain/legal-hold";

function hold(
  partial: Partial<LegalHoldRecord> & Pick<LegalHoldRecord, "status">
): LegalHoldRecord {
  return {
    id: partial.id ?? crypto.randomUUID(),
    tenantId: partial.tenantId ?? crypto.randomUUID(),
    descriptorKey: partial.descriptorKey ?? null,
    status: partial.status
  };
}

describe("isLegalHoldActive", () => {
  test("only status is consulted — endsAt is never an auto-expiry", () => {
    expect(isLegalHoldActive({ status: "active" })).toBe(true);
    expect(isLegalHoldActive({ status: "released" })).toBe(false);
  });
});

describe("evaluateLegalHoldForDescriptor", () => {
  const KEY = "logging.audit_events";

  test("a released hold never applies", () => {
    const result = evaluateLegalHoldForDescriptor(
      [hold({ status: "released", descriptorKey: KEY })],
      KEY
    );
    expect(result.held).toBe(false);
    expect(result.matchedHoldIds).toEqual([]);
  });

  test("a hold scoped exactly to the descriptor applies", () => {
    const h = hold({ status: "active", descriptorKey: KEY });
    const result = evaluateLegalHoldForDescriptor([h], KEY);
    expect(result.held).toBe(true);
    expect(result.matchedHoldIds).toEqual([h.id]);
  });

  test("a tenant-wide (descriptorKey null) hold applies to ANY descriptor", () => {
    const h = hold({ status: "active", descriptorKey: null });
    expect(evaluateLegalHoldForDescriptor([h], KEY).held).toBe(true);
    expect(
      evaluateLegalHoldForDescriptor([h], "visitor_analytics.visit_events").held
    ).toBe(true);
  });

  test("a hold scoped to a DIFFERENT descriptor does not apply", () => {
    const h = hold({
      status: "active",
      descriptorKey: "visitor_analytics.visit_events"
    });
    expect(evaluateLegalHoldForDescriptor([h], KEY).held).toBe(false);
  });

  test("collects every matching active hold id", () => {
    const a = hold({ status: "active", descriptorKey: null });
    const b = hold({ status: "active", descriptorKey: KEY });
    const c = hold({ status: "released", descriptorKey: KEY });
    const result = evaluateLegalHoldForDescriptor([a, b, c], KEY);
    expect(result.held).toBe(true);
    expect(new Set(result.matchedHoldIds)).toEqual(new Set([a.id, b.id]));
  });
});

describe("validateCreateLegalHoldInput", () => {
  const valid = {
    descriptorKey: null,
    scopeDescription: "All audit events for this tenant.",
    reason: "Ongoing litigation matter 2026-07.",
    authorityReference: "Court order 12345",
    endsAt: null
  };

  test("accepts a well-formed input", () => {
    expect(validateCreateLegalHoldInput(valid)).toEqual([]);
  });

  test("rejects a too-short reason (evidentiary requirement)", () => {
    const errors = validateCreateLegalHoldInput({ ...valid, reason: "short" });
    expect(errors.map((e) => e.field)).toContain("reason");
  });

  test("rejects empty scopeDescription and authorityReference", () => {
    const errors = validateCreateLegalHoldInput({
      ...valid,
      scopeDescription: "   ",
      authorityReference: ""
    });
    const fields = errors.map((e) => e.field);
    expect(fields).toContain("scopeDescription");
    expect(fields).toContain("authorityReference");
  });

  test("rejects an empty-string descriptorKey (must be null or non-empty)", () => {
    const errors = validateCreateLegalHoldInput({
      ...valid,
      descriptorKey: "  "
    });
    expect(errors.map((e) => e.field)).toContain("descriptorKey");
  });

  test("rejects an invalid endsAt date", () => {
    const errors = validateCreateLegalHoldInput({
      ...valid,
      endsAt: new Date("not-a-date")
    });
    expect(errors.map((e) => e.field)).toContain("endsAt");
  });
});

describe("validateReleaseLegalHoldInput", () => {
  test("requires a reason of at least 10 characters", () => {
    expect(
      validateReleaseLegalHoldInput({ releaseReason: "Matter closed 2026." })
    ).toEqual([]);
    expect(
      validateReleaseLegalHoldInput({ releaseReason: "done" }).map(
        (e) => e.field
      )
    ).toContain("releaseReason");
  });
});
