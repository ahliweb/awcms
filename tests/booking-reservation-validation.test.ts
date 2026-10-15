/**
 * Request validation for the booking reservation routes (Issue #941, ADR-0131;
 * docs/awcms/booking.md sections 3 and 9). Pure: no database, no clock.
 */
import { describe, expect, test } from "bun:test";

import {
  asValidated,
  isPaymentFieldName,
  validateCancel,
  validateCreateReservation,
  validateEmptyReservationBody,
  validateReschedule
} from "../src/modules/booking/domain/booking-reservation-validation";

const OFFERING = "11111111-1111-4111-8111-111111111111";
const RESOURCE = "22222222-2222-4222-8222-222222222222";

const slotBody = {
  offeringId: OFFERING,
  resourceId: RESOURCE,
  startsAt: "2026-11-01T03:00:00Z",
  partySize: 2
};

describe("payment fields are refused by name", () => {
  test.each([
    "paid",
    "isPaid",
    "payment",
    "paymentStatus",
    "payment_status",
    "deposit",
    "depositAmount",
    "amount",
    "balance",
    "price",
    "total",
    "currency",
    "refund",
    "invoiceNo",
    "discount",
    "cost",
    "fee",
    "cancellationFee"
  ])("%s is payment state", (key) => {
    expect(isPaymentFieldName(key)).toBe(true);

    const result = validateCreateReservation({ ...slotBody, [key]: 1 });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PAYMENT_FIELD_NOT_ACCEPTED");
      expect(result.errors.map((error) => error.field)).toContain(key);
    }
  });

  test("none of the fields the module accepts is mistaken for one", () => {
    for (const key of [
      "offeringId",
      "resourceId",
      "poolId",
      "startsAt",
      "stay",
      "partySize",
      "quantity",
      "holdSeconds",
      "externalCustomerRef",
      "externalRef",
      "source",
      "customerNote",
      "overridePolicy",
      "reasonCode",
      "checkInDate",
      "checkOutDate"
    ]) {
      expect(isPaymentFieldName(key)).toBe(false);
    }
  });

  test("a payment field outranks a plain unknown key on every body", () => {
    for (const validate of [
      validateReschedule,
      validateCancel,
      validateEmptyReservationBody
    ]) {
      const result = validate({ startsAt: "2026-11-01T03:00:00Z", paid: true });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("PAYMENT_FIELD_NOT_ACCEPTED");
      }
    }
  });

  test("an unknown key that is not payment state is a plain validation error naming it", () => {
    const result = validateCreateReservation({ ...slotBody, status: "paid_x" });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      // `status` is a server-owned fact; a client cannot assert it.
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.errors).toContainEqual({
        field: "status",
        message: "status is not accepted."
      });
    }
  });
});

describe("create body", () => {
  test("a slot claim parses to the typed input, with defaults", () => {
    const result = validateCreateReservation(slotBody);

    expect(result).toEqual({
      valid: true,
      value: {
        claim: {
          offeringId: OFFERING,
          resourceId: RESOURCE,
          startsAtMs: Date.parse("2026-11-01T03:00:00Z"),
          partySize: 2,
          quantity: 1
        },
        overridePolicy: false
      }
    });
  });

  test("a stay claim sends dates, never an instant", () => {
    const result = validateCreateReservation({
      offeringId: OFFERING,
      resourceId: RESOURCE,
      stay: { checkInDate: "2026-11-10", checkOutDate: "2026-11-12" }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.claim.stay).toEqual({
        checkInDate: "2026-11-10",
        checkOutDate: "2026-11-12"
      });
      expect(result.value.claim.startsAtMs).toBeUndefined();
    }
  });

  test("exactly one of startsAt and stay", () => {
    for (const body of [
      { offeringId: OFFERING, resourceId: RESOURCE },
      {
        ...slotBody,
        stay: { checkInDate: "2026-11-10", checkOutDate: "2026-11-12" }
      }
    ]) {
      expect(validateCreateReservation(body).valid).toBe(false);
    }
  });

  test("an instant without an offset is refused, never read as server-local", () => {
    expect(
      validateCreateReservation({
        ...slotBody,
        startsAt: "2026-11-01T10:00:00"
      }).valid
    ).toBe(false);
  });

  test("exactly one of resourceId and poolId", () => {
    expect(
      validateCreateReservation({
        ...slotBody,
        poolId: "33333333-3333-4333-8333-333333333333"
      }).valid
    ).toBe(false);
  });

  test("an external reference that looks like a credential is a 400, not a failed event after the claim is won", () => {
    // The outbox REFUSES a payload carrying a credential-shaped value; the
    // reference rides every event, so it is refused up front.
    const result = validateCreateReservation({
      ...slotBody,
      externalRef: {
        type: "order",
        id: "Bearer abcdefghijklmnopqrstuvwxyz0123456789"
      }
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "externalRef.id"
      );
    }
  });

  test("an ordinary adapter reference passes", () => {
    expect(
      validateCreateReservation({
        ...slotBody,
        externalRef: { type: "order", id: "ORD-2026-000123" }
      }).valid
    ).toBe(true);
  });

  test("a customer reference is an opaque token, not a name or a contact", () => {
    for (const bad of ["Budi Santoso", "budi@example.com"]) {
      expect(
        validateCreateReservation({ ...slotBody, externalCustomerRef: bad })
          .valid
      ).toBe(false);
    }
    expect(
      validateCreateReservation({
        ...slotBody,
        externalCustomerRef: "cus_9f3a"
      }).valid
    ).toBe(true);
  });

  test("a note longer than 500 characters is refused", () => {
    expect(
      validateCreateReservation({ ...slotBody, customerNote: "x".repeat(501) })
        .valid
    ).toBe(false);
  });

  test("overridePolicy is a boolean and defaults to off", () => {
    const off = validateCreateReservation(slotBody);
    const on = validateCreateReservation({ ...slotBody, overridePolicy: true });
    const bad = validateCreateReservation({
      ...slotBody,
      overridePolicy: "yes"
    });

    expect(off.valid && off.value.overridePolicy).toBe(false);
    expect(on.valid && on.value.overridePolicy).toBe(true);
    expect(bad.valid).toBe(false);
  });

  test("a body is required", () => {
    expect(validateCreateReservation(undefined).valid).toBe(false);
    expect(validateCreateReservation(null).valid).toBe(false);
    expect(validateCreateReservation([]).valid).toBe(false);
  });
});

describe("reschedule, cancel and empty bodies", () => {
  test("reschedule takes a new time and optionally a new place", () => {
    const result = validateReschedule({
      startsAt: "2026-11-02T03:00:00+07:00",
      resourceId: RESOURCE.toUpperCase()
    });

    expect(result).toEqual({
      valid: true,
      value: {
        startsAtMs: Date.parse("2026-11-02T03:00:00+07:00"),
        resourceId: RESOURCE,
        overridePolicy: false
      }
    });
  });

  test("reschedule refuses both resourceId and poolId, and needs a time", () => {
    expect(
      validateReschedule({
        startsAt: "2026-11-02T03:00:00Z",
        resourceId: RESOURCE,
        poolId: "33333333-3333-4333-8333-333333333333"
      }).valid
    ).toBe(false);
    expect(validateReschedule({}).valid).toBe(false);
    expect(validateReschedule(null).valid).toBe(false);
  });

  test("cancel takes a short code, never free text, and the body is optional", () => {
    expect(validateCancel(undefined)).toEqual({
      valid: true,
      value: { reasonCode: null }
    });
    expect(validateCancel({ reasonCode: "customer_request" })).toEqual({
      valid: true,
      value: { reasonCode: "customer_request" }
    });
    expect(validateCancel({ reasonCode: "The customer called us" }).valid).toBe(
      false
    );
  });

  test("a transition with no input accepts an absent body or {} and nothing else", () => {
    expect(validateEmptyReservationBody(undefined).valid).toBe(true);
    expect(validateEmptyReservationBody({}).valid).toBe(true);
    expect(validateEmptyReservationBody({ reason: "x" }).valid).toBe(false);
  });

  test("asValidated drops the code and keeps the errors, for the generic body reader", () => {
    const result = validateCreateReservation({ ...slotBody, paid: true });

    expect(asValidated(result).valid).toBe(false);
  });
});
