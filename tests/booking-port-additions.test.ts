/**
 * The pure half of the BookingPort additions (Issue #1108, contract 1.1.0):
 * input validation that must answer BEFORE the database is touched, the
 * "reads carry no customer data" source pin, and the registry/manifest version.
 * The behaviour against a real database (transitions, RLS, the anonymous read)
 * is `tests/integration/booking-port-additions.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createBookingPort } from "../src/modules/booking/application/booking-port-adapter";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import { NO_OP_STAFF_AVAILABILITY } from "../src/modules/booking/domain/booking-staff-availability";

const ROOT = join(import.meta.dir, "..");
const TENANT = "b1080000-0000-4000-8000-00000000000a";
const UUID = "b1080000-0000-4000-8000-0000000000f1";

/** Any use is a failure: these inputs must be refused before a query is built. */
const NO_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("the database was reached");
    },
    apply() {
      throw new Error("the database was reached");
    }
  }
) as unknown as Bun.SQL;

const port = createBookingPort(async () => NO_OP_STAFF_AVAILABILITY);

describe("get refuses a malformed key as a value", () => {
  test("neither or both of id and number", async () => {
    expect(await port.get(NO_DB, { tenantId: TENANT } as never)).toEqual({
      ok: false,
      reason: "VALIDATION_ERROR"
    });
    expect(
      await port.get(NO_DB, {
        tenantId: TENANT,
        reservationId: UUID,
        reservationNo: "BK-0001"
      } as never)
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });

  test("a non-UUID id and a number that cannot exist", async () => {
    expect(
      await port.get(NO_DB, { tenantId: TENANT, reservationId: "nope" })
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
    expect(
      await port.get(NO_DB, { tenantId: TENANT, reservationNo: "bk-1; --" })
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });
});

describe("the offering reads refuse a malformed input as a value", () => {
  test("getOffering with a non-UUID", async () => {
    expect(
      await port.getOffering(NO_DB, { tenantId: TENANT, offeringId: "x" })
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });

  test("listOfferings: limit bounds, status and a corrupt cursor", async () => {
    for (const bad of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { status: "deleted" as never },
      { cursor: "not-a-cursor" }
    ]) {
      expect(
        await port.listOfferings(NO_DB, { tenantId: TENANT, ...bad })
      ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
    }
  });
});

describe("availability refuses a malformed ask before reading", () => {
  const base = { tenantId: TENANT, offeringId: UUID, resourceId: UUID };

  test("a slot window must be ordered, at most 31 days, and limited to 500", async () => {
    const from = "2030-01-01T00:00:00Z";

    for (const bad of [
      { from, to: from },
      { from, to: "2030-03-01T00:00:00Z" },
      { from, to: "2030-01-02T00:00:00Z", limit: 501 },
      { from: "2030-01-01", to: "2030-01-02" },
      { from, to: "2030-01-02T00:00:00Z", quantity: 0 }
    ]) {
      expect(await port.availability(NO_DB, { ...base, ...bad })).toEqual({
        ok: false,
        reason: "VALIDATION_ERROR"
      });
    }
  });

  test("a slot ask and a stay ask are exclusive, and one of them is required", async () => {
    expect(await port.availability(NO_DB, base as never)).toEqual({
      ok: false,
      reason: "VALIDATION_ERROR"
    });
    expect(
      await port.availability(NO_DB, {
        ...base,
        from: "2030-01-01T00:00:00Z",
        to: "2030-01-02T00:00:00Z",
        stay: { checkInDate: "2030-01-01", checkOutDate: "2030-01-02" }
      } as never)
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });

  test("stay dates that are not calendar dates are STAY_DATES_INVALID", async () => {
    expect(
      await port.availability(NO_DB, {
        ...base,
        stay: {
          checkInDate: "2030-01-01T00:00:00Z",
          checkOutDate: "2030-01-02"
        }
      })
    ).toEqual({ ok: false, reason: "STAY_DATES_INVALID" });
  });

  test("a malformed tenant id is a validation value on every read, never a Postgres throw", async () => {
    const bad = "not-a-uuid";
    const refused = { ok: false, reason: "VALIDATION_ERROR" } as const;

    expect(
      await port.get(NO_DB, { tenantId: bad, reservationId: UUID })
    ).toEqual(refused);
    expect(
      await port.getOffering(NO_DB, { tenantId: bad, offeringId: UUID })
    ).toEqual(refused);
    expect(await port.listOfferings(NO_DB, { tenantId: bad })).toEqual(refused);
    expect(
      await port.availability(NO_DB, {
        ...base,
        tenantId: bad,
        from: "2030-01-01T00:00:00Z",
        to: "2030-01-02T00:00:00Z"
      })
    ).toEqual(refused);
  });

  test("a non-UUID offering or resource", async () => {
    expect(
      await port.availability(NO_DB, {
        ...base,
        resourceId: "x",
        from: "2030-01-01T00:00:00Z",
        to: "2030-01-02T00:00:00Z"
      })
    ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
  });
});

describe("the reads carry no customer, contact or note data", () => {
  const reads = readFileSync(
    join(ROOT, "src/modules/booking/application/booking-port-reads.ts"),
    "utf8"
  );
  // Strip comments: the docblock names the columns it refuses to select.
  const code = reads.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("the allow-listed queries never name a person column", () => {
    for (const forbidden of [
      "external_customer_ref",
      "customer",
      "note",
      "cancel_reason_code",
      "party_size",
      "status_changed_by",
      "created_by",
      "SELECT \\*"
    ]) {
      expect(new RegExp(forbidden, "i").test(code)).toBe(false);
    }
  });

  test("the port's record types name no customer field", () => {
    const port = readFileSync(
      join(ROOT, "src/modules/_shared/ports/booking-port.ts"),
      "utf8"
    );
    const types = port.slice(port.indexOf("export type BookingGetInput"));
    const records = types.slice(0, types.indexOf("export type Targeted"));
    const code = records
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(/customer|contact|note|email|phone/i.test(code)).toBe(false);
  });
});

describe("the contract version", () => {
  test("the booking capability is declared at 1.1.0 in the registry and the manifest", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.booking).toBe("1.1.0");
    expect(
      readFileSync(join(ROOT, "awcms-family-compatibility.yaml"), "utf8")
    ).toMatch(/^\s+booking: "1\.1\.0"$/m);
  });
});
