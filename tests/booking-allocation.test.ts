/**
 * `booking` allocation and hold-expiry rules as pure functions (Issue #939,
 * ADR-0131; booking.md section 5.1 and 8.1). No database: the allocator's
 * concurrency is proved against PostgreSQL in
 * tests/integration/booking-concurrency.integration.test.ts.
 */
import { describe, expect, test } from "bun:test";

import {
  ALLOCATOR_LIMITS,
  HOLD_LIMITS,
  PLACEMENT_REFUSALS,
  classifyDatabaseFailure,
  compareBytes,
  deriveSlotWindow,
  insertionOrder,
  isHoldDue,
  overdueSeconds,
  planAttempts,
  resolveHoldSeconds,
  retryDelayMs,
  validatePlaceHold,
  type PlaceHoldInput,
  type UnitRef
} from "../src/modules/booking/domain/booking-allocation";

const NO_POLICY = { tenantDefaultSeconds: null, tenantMaxSeconds: null };

describe("resolveHoldSeconds (booking.md section 5.1)", () => {
  test("defaults to 900 seconds and never exceeds the module maximum", () => {
    expect(resolveHoldSeconds(undefined, NO_POLICY)).toBe(900);
    expect(resolveHoldSeconds(null, NO_POLICY)).toBe(900);
    expect(resolveHoldSeconds(10 ** 9, NO_POLICY)).toBe(HOLD_LIMITS.maxSeconds);
  });

  test("clamps up to the 60 second floor", () => {
    expect(resolveHoldSeconds(1, NO_POLICY)).toBe(60);
    expect(resolveHoldSeconds(59.9, NO_POLICY)).toBe(60);
  });

  test("the tenant default replaces the module default, the tenant maximum caps the request", () => {
    const policy = { tenantDefaultSeconds: 300, tenantMaxSeconds: 600 };

    expect(resolveHoldSeconds(undefined, policy)).toBe(300);
    expect(resolveHoldSeconds(450, policy)).toBe(450);
    expect(resolveHoldSeconds(3600, policy)).toBe(600);
  });

  test("a tenant maximum below the default pulls the default down with it", () => {
    expect(
      resolveHoldSeconds(undefined, {
        tenantDefaultSeconds: 900,
        tenantMaxSeconds: 120
      })
    ).toBe(120);
  });

  test("a tenant maximum above the module maximum cannot raise it", () => {
    expect(
      resolveHoldSeconds(10 ** 9, {
        tenantDefaultSeconds: null,
        tenantMaxSeconds: 10 ** 9
      })
    ).toBe(HOLD_LIMITS.maxSeconds);
  });

  test("NaN, zero and negative requests fall back to the default rather than an instant or eternal hold", () => {
    expect(resolveHoldSeconds(Number.NaN, NO_POLICY)).toBe(900);
    expect(resolveHoldSeconds(0, NO_POLICY)).toBe(900);
    expect(resolveHoldSeconds(-5, NO_POLICY)).toBe(900);
    expect(resolveHoldSeconds(Number.POSITIVE_INFINITY, NO_POLICY)).toBe(900);
  });
});

describe("deriveSlotWindow (booking.md section 2.3)", () => {
  const start = Date.parse("2026-11-01T03:00:00Z");

  test("the service interval is start + duration; buffers widen the occupied range", () => {
    expect(
      deriveSlotWindow({
        startsAtMs: start,
        durationSeconds: 3600,
        setupSeconds: 300,
        cleanupSeconds: 900
      })
    ).toEqual({
      startsAtMs: start,
      endsAtMs: start + 3_600_000,
      occupiedFromMs: start - 300_000,
      occupiedToMs: start + 3_600_000 + 900_000
    });
  });

  test("zero buffers occupy exactly the service interval (half-open boundary)", () => {
    const window = deriveSlotWindow({
      startsAtMs: start,
      durationSeconds: 1800,
      setupSeconds: 0,
      cleanupSeconds: 0
    })!;

    expect(window.occupiedFromMs).toBe(window.startsAtMs);
    expect(window.occupiedToMs).toBe(window.endsAtMs);
  });

  test("input that cannot describe a slot is null, never a negative or empty interval", () => {
    const ok = {
      startsAtMs: start,
      durationSeconds: 60,
      setupSeconds: 0,
      cleanupSeconds: 0
    };

    expect(deriveSlotWindow({ ...ok, durationSeconds: 0 })).toBeNull();
    expect(deriveSlotWindow({ ...ok, durationSeconds: -1 })).toBeNull();
    expect(deriveSlotWindow({ ...ok, setupSeconds: -1 })).toBeNull();
    expect(deriveSlotWindow({ ...ok, cleanupSeconds: 1.5 })).toBeNull();
    expect(deriveSlotWindow({ ...ok, startsAtMs: Number.NaN })).toBeNull();
  });
});

describe("unit ordering (booking.md section 8.1 rule 3)", () => {
  const unit = (resourceId: string, ordinal: number): UnitRef => ({
    resourceId,
    unitId: `${resourceId}-u${ordinal}`,
    ordinal
  });

  test("compareBytes is locale independent", () => {
    expect(compareBytes("a", "b")).toBe(-1);
    expect(compareBytes("b", "a")).toBe(1);
    expect(compareBytes("a", "a")).toBe(0);
    // Uppercase sorts before lowercase by code unit, whatever the process locale.
    expect(compareBytes("B", "a")).toBe(-1);
  });

  test("insertionOrder is resource id bytewise, then ordinal", () => {
    const ordered = insertionOrder([
      unit("r2", 1),
      unit("r1", 3),
      unit("r1", 1),
      unit("r2", 0)
    ]);

    expect(ordered.map((u) => u.unitId)).toEqual([
      "r1-u1",
      "r1-u3",
      "r2-u0",
      "r2-u1"
    ]);
  });

  test("insertionOrder does not mutate its input", () => {
    const input = [unit("r2", 1), unit("r1", 1)];

    insertionOrder(input);

    expect(input.map((u) => u.resourceId)).toEqual(["r2", "r1"]);
  });

  test("planAttempts tries the first `need` units in insertion order, then the spares in preference order", () => {
    // Preference order: pool room 2 before room 1 (sort_order), then ordinals.
    const candidates = [
      unit("r2", 1),
      unit("r2", 2),
      unit("r1", 1),
      unit("r1", 2)
    ];

    expect(planAttempts(candidates, 2).map((u) => u.unitId)).toEqual([
      "r2-u1",
      "r2-u2",
      "r1-u1",
      "r1-u2"
    ]);
    expect(planAttempts(candidates, 3).map((u) => u.unitId)).toEqual([
      "r1-u1",
      "r2-u1",
      "r2-u2",
      "r1-u2"
    ]);
  });

  test("planAttempts with fewer candidates than needed returns them all", () => {
    expect(planAttempts([unit("r1", 1)], 3)).toHaveLength(1);
    expect(planAttempts([], 1)).toHaveLength(0);
  });
});

describe("database failure classification", () => {
  test("23P01 is an exclusion conflict, 40P01 a deadlock", () => {
    expect(classifyDatabaseFailure("23P01", null)).toBe("exclusion_conflict");
    expect(classifyDatabaseFailure("40P01", null)).toBe("deadlock");
  });

  test("23505 is ours only on the natural-key backstop", () => {
    expect(
      classifyDatabaseFailure(
        "23505",
        "awcms_booking_reservations_external_ref_key"
      )
    ).toBe("external_ref_in_use");
    expect(classifyDatabaseFailure("23505", "some_other_key")).toBeNull();
    expect(classifyDatabaseFailure("23505", null)).toBeNull();
  });

  test("anything else is not ours to swallow", () => {
    expect(classifyDatabaseFailure("23503", null)).toBeNull();
    expect(classifyDatabaseFailure("55000", null)).toBeNull();
    expect(classifyDatabaseFailure(undefined, undefined)).toBeNull();
  });

  test("every refusal has a client-error or conflict status, never 5xx", () => {
    for (const status of Object.values(PLACEMENT_REFUSALS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }

    expect(PLACEMENT_REFUSALS.SLOT_UNAVAILABLE).toBe(409);
    expect(PLACEMENT_REFUSALS.HOLD_LIMIT_EXCEEDED).toBe(429);
  });
});

describe("retryDelayMs", () => {
  test("grows exponentially and stays inside [ceiling/2, ceiling)", () => {
    const base = ALLOCATOR_LIMITS.retryBaseMs;

    for (
      let attempt = 0;
      attempt < ALLOCATOR_LIMITS.maxDeadlockRetries;
      attempt++
    ) {
      const ceiling = base * 2 ** attempt;

      expect(retryDelayMs(attempt, () => 0)).toBe(Math.floor(ceiling / 2));
      expect(retryDelayMs(attempt, () => 0.999999)).toBeLessThan(ceiling);
    }
  });

  test("jitter separates two victims of the same deadlock", () => {
    expect(retryDelayMs(2, () => 0.1)).not.toBe(retryDelayMs(2, () => 0.9));
  });
});

describe("hold due / overdue (database clock supplied by the caller)", () => {
  test("a hold is due at its expiry instant, not before (half-open: expiry is the first instant it is gone)", () => {
    expect(isHoldDue(1000, 999)).toBe(false);
    expect(isHoldDue(1000, 1000)).toBe(true);
    expect(isHoldDue(1000, 1001)).toBe(true);
  });

  test("overdueSeconds is never negative", () => {
    expect(overdueSeconds(10_000, 5_000)).toBe(0);
    expect(overdueSeconds(10_000, 70_000)).toBe(60);
  });
});

describe("validatePlaceHold", () => {
  const ok: PlaceHoldInput = {
    offeringId: "b9390000-0000-4000-8000-000000000001",
    resourceId: "b9390000-0000-4000-8000-000000000002",
    startsAtMs: Date.parse("2026-11-01T03:00:00Z"),
    partySize: 1,
    quantity: 1
  };
  const fields = (input: PlaceHoldInput) =>
    validatePlaceHold(input).map((issue) => issue.field);

  test("a well-formed input has no issues", () => {
    expect(validatePlaceHold(ok)).toEqual([]);
    expect(
      validatePlaceHold({
        ...ok,
        resourceId: undefined,
        poolId: "b9390000-0000-4000-8000-000000000003",
        holdSeconds: 600,
        externalCustomerRef: "cust:42",
        externalRef: { type: "order", id: "ORD-1" },
        source: "portal",
        customerNote: "window seat"
      })
    ).toEqual([]);
  });

  test("exactly one of resourceId and poolId", () => {
    expect(fields({ ...ok, poolId: ok.resourceId })).toContain("resourceId");
    expect(fields({ ...ok, resourceId: undefined })).toContain("resourceId");
  });

  test("ids must be UUIDs", () => {
    expect(fields({ ...ok, offeringId: "nope" })).toEqual(["offeringId"]);
    expect(fields({ ...ok, resourceId: "nope" })).toEqual(["resourceId"]);
  });

  test("party size and quantity are 1..500 integers", () => {
    expect(fields({ ...ok, partySize: 0 })).toEqual(["partySize"]);
    expect(fields({ ...ok, partySize: 501 })).toEqual(["partySize"]);
    expect(fields({ ...ok, quantity: 1.5 })).toEqual(["quantity"]);
    expect(fields({ ...ok, quantity: 501 })).toEqual(["quantity"]);
  });

  test("the customer reference is an opaque token: no email, no spaces", () => {
    expect(fields({ ...ok, externalCustomerRef: "a@b.id" })).toEqual([
      "externalCustomerRef"
    ]);
    expect(fields({ ...ok, externalCustomerRef: "Budi Santoso" })).toEqual([
      "externalCustomerRef"
    ]);
  });

  test("source, external reference and note shapes mirror the CHECK constraints", () => {
    expect(fields({ ...ok, source: "Portal" })).toEqual(["source"]);
    expect(fields({ ...ok, externalRef: { type: "Order", id: "1" } })).toEqual([
      "externalRef.type"
    ]);
    expect(fields({ ...ok, externalRef: { type: "order", id: "" } })).toEqual([
      "externalRef.id"
    ]);
    expect(fields({ ...ok, customerNote: "x".repeat(501) })).toEqual([
      "customerNote"
    ]);
  });

  test("a non-positive hold is refused rather than clamped silently", () => {
    expect(fields({ ...ok, holdSeconds: 0 })).toEqual(["holdSeconds"]);
    expect(fields({ ...ok, holdSeconds: Number.NaN })).toEqual(["holdSeconds"]);
  });
});
