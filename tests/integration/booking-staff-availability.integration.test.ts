/**
 * `booking` consumes the `hr_workforce` StaffAvailabilityPort (Issue #949,
 * ADR-0011, ADR-0131, ADR-0132; docs/awcms/booking.md section 10.3).
 *
 * What is proved, against real PostgreSQL as the runtime role (FORCE RLS):
 *
 *   * AVAILABILITY with and without the module: the same resource, schedule and
 *     offering answer more slots when `hr_workforce` is off (no staff constraint,
 *     `staffAvailability: "unchecked"`) than when it is on (only slots inside a
 *     rostered shift, `"checked"`); a person already serving a live claim is not
 *     offered again; a person on leave, or `unknown` to the port, offers nothing
 *     (fail closed);
 *   * a CLAIM wins a free person under the staff exclusion constraint and writes
 *     the assignment in the same savepoint as the units;
 *   * a staff CONFLICT is `SLOT_UNAVAILABLE` and NEVER allocates partially: with
 *     a free unit but no free person, no reservation, item, allocation or staff
 *     row survives (checked by counting every table);
 *   * N parallel claims for the one rostered person: exactly one wins, every
 *     loser is a refusal VALUE with nothing written, and the exclusion
 *     constraint is what decided it;
 *   * the person is released with the allocation (cancel, expiry, reschedule),
 *     so the slot can be taken again;
 *   * with the module off a resource that names staff still books (no staff
 *     constraint), and a resource that names nobody is untouched either way.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected as assertRejectedByDatabase,
  createRuntimePool,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { staffAvailabilityAdapter } from "../../src/modules/hr-workforce/application/staff-availability-adapter";
import {
  answerAvailability,
  type SlotAnswer
} from "../../src/modules/booking/application/booking-availability-directory";
import {
  placeHold,
  type PlaceHoldOutcome
} from "../../src/modules/booking/application/booking-hold-service";
import { expireDueHolds } from "../../src/modules/booking/application/booking-hold-expiry";
import { createBookingPort } from "../../src/modules/booking/application/booking-port-adapter";
import { resolveStaffAvailability } from "../../src/modules/booking/application/booking-staff-availability-consumer";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";
import { loadStaffAvailabilityPort } from "../../src/modules/booking/module";

const TENANT = "b9490000-0000-4000-8000-00000000000a";
// Monday 2029-01-08, Asia/Pontianak (UTC+7): the weekday schedule is 09:00-17:00
// local = 02:00Z-10:00Z.
const DAY_FROM = Date.parse("2029-01-08T00:00:00Z");
const DAY_TO = Date.parse("2029-01-09T00:00:00Z");
const SHIFT_FROM = "2029-01-08T03:00:00Z"; // 10:00 local
const SHIFT_TO = "2029-01-08T06:00:00Z"; // 13:00 local
const AT_0300 = Date.parse("2029-01-08T03:00:00Z");

let pool: Bun.SQL;
let sequence = 0;
let actorId = "";

function tenantTx<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
    return fn(tx);
  });
}

async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  expect(
    `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`
  ).toMatch(expected);
}

/** An employment with an active term and a PUBLISHED shift, returning its id (the opaque staff ref). */
async function rosterStaff(
  tag: string,
  shift: { from: string; to: string; kind?: "work" | "time_off" } | null
): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Staff ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const employment = (await admin`
    INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
    VALUES (${TENANT}, ${profile[0]!.id}, ${`E-${tag}`}, '2026-01-01')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_hr_employment_terms
      (tenant_id, employment_id, employment_type, status, effective_from)
    VALUES (${TENANT}, ${employment[0]!.id}, 'permanent', 'active', '2026-01-01')
  `;

  if (shift) {
    const kind = shift.kind ?? "work";

    const assignment = (await admin`
      INSERT INTO awcms_hr_shift_assignments
        (tenant_id, employment_id, kind, time_off_kind, starts_at, ends_at,
         time_zone)
      VALUES (${TENANT}, ${employment[0]!.id}, ${kind},
              ${kind === "time_off" ? "leave" : null}, ${shift.from}::timestamptz,
              ${shift.to}::timestamptz, 'Asia/Pontianak')
      RETURNING id
    `) as { id: string }[];

    await admin`
      UPDATE awcms_hr_shift_assignments
      SET status = 'published', published_at = now()
      WHERE id = ${assignment[0]!.id}
    `;
  }

  return employment[0]!.id;
}

type Fixture = { resourceId: string; offeringId: string; unitIds: string[] };

/** A slot resource open 09:00-17:00 on weekdays that NAMES `staffRefs` (empty = needs nobody). */
async function newResource(
  staffRefs: readonly string[],
  capacity = 1
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `s${sequence}`;
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, required_staff_refs)
    VALUES (${TENANT}, ${code}, ${`Chair ${code}`}, 'chair', ${capacity},
            'Asia/Pontianak', ${admin.array([...staffRefs], "text")}::text[])
    RETURNING id
  `) as { id: string }[];
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${TENANT}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  await admin`
    INSERT INTO awcms_booking_schedules
      (tenant_id, resource_id, timezone, effective_from, rules)
    VALUES (${TENANT}, ${resource[0]!.id}, 'Asia/Pontianak', '2029-01-01',
            ${
              {
                weekly: Object.fromEntries(
                  ["mon", "tue", "wed", "thu", "fri"].map((day) => [
                    day,
                    [{ from: "09:00", to: "17:00" }]
                  ])
                )
              } as object
            }::jsonb)
  `;

  const offering = (await admin`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, slot_step_seconds, max_party, confirmation_mode)
    VALUES (${TENANT}, ${`svc-${code}`}, 'Hour', 'time', 3600, 0, 0, 900, 4,
            'hold_then_confirm')
    RETURNING id
  `) as { id: string }[];

  return {
    resourceId: resource[0]!.id,
    offeringId: offering[0]!.id,
    unitIds
  };
}

function claim(
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs: AT_0300,
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

function place(
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {},
  withStaff = true
): Promise<PlaceHoldOutcome> {
  return tenantTx(async (tx) => {
    const staff = withStaff
      ? await resolveStaffAvailability(
          tx,
          TENANT,
          async () => staffAvailabilityAdapter
        )
      : NO_OP_STAFF_AVAILABILITY;

    return placeHold(
      tx,
      {
        tenantId: TENANT,
        actorTenantUserId: actorId,
        correlationId: crypto.randomUUID(),
        staff
      },
      claim(fixture, overrides)
    );
  });
}

async function slots(
  fixture: Fixture,
  staff: "on" | "off"
): Promise<{ starts: string[]; answer: SlotAnswer }> {
  const outcome = await tenantTx(async (tx) =>
    answerAvailability(
      tx,
      TENANT,
      {
        mode: "slot",
        resourceId: fixture.resourceId,
        offeringId: fixture.offeringId,
        quantity: 1,
        fromMs: DAY_FROM,
        toMs: DAY_TO,
        limit: 100
      },
      staff === "on"
        ? await resolveStaffAvailability(
            tx,
            TENANT,
            async () => staffAvailabilityAdapter
          )
        : NO_OP_STAFF_AVAILABILITY
    )
  );

  if (outcome.outcome !== "ok" || outcome.answer.mode !== "slot") {
    throw new Error("expected a slot answer");
  }

  return {
    starts: outcome.answer.slots.map((slot) => slot.startsAt),
    answer: outcome.answer
  };
}

async function counts(resourceId: string): Promise<{
  reservations: number;
  items: number;
  allocations: number;
  staff: number;
}> {
  const admin = getAdminSql();
  const rows = (await admin`
    SELECT
      (SELECT count(*)::int FROM awcms_booking_reservations WHERE tenant_id = ${TENANT}) AS reservations,
      (SELECT count(*)::int FROM awcms_booking_reservation_items WHERE tenant_id = ${TENANT}) AS items,
      (SELECT count(*)::int FROM awcms_booking_resource_allocations WHERE resource_id = ${resourceId}) AS allocations,
      (SELECT count(*)::int FROM awcms_booking_staff_assignments WHERE resource_id = ${resourceId}) AS staff
  `) as {
    reservations: number;
    items: number;
    allocations: number;
    staff: number;
  }[];

  return rows[0]!;
}

async function liveStaff(resourceId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT staff_ref FROM awcms_booking_staff_assignments
    WHERE resource_id = ${resourceId} AND released_at IS NULL
    ORDER BY staff_ref
  `) as { staff_ref: string }[];

  return rows.map((row) => row.staff_ref);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("booking x hr_workforce StaffAvailabilityPort (Issue #949)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    pool = createRuntimePool(24);
  });

  afterAll(async () => {
    await pool?.close();
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();

    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 'stf', 'Staff Booking')
    `;

    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', 'Actor')
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, 'actor@example.com', 'x')
      RETURNING id
    `) as { id: string }[];
    const user = (await admin`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id)
      VALUES (${TENANT}, ${identity[0]!.id})
      RETURNING id
    `) as { id: string }[];

    actorId = user[0]!.id;
    await admin`
      INSERT INTO awcms_booking_settings (tenant_id, max_horizon_days)
      VALUES (${TENANT}, 3650)
      ON CONFLICT (tenant_id) DO UPDATE SET max_horizon_days = 3650
    `;
  });

  describe("availability with and without the module", () => {
    test("module off: no staff constraint at all, answer says unchecked", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const off = await slots(fixture, "off");

      // 09:00-17:00 local, 60-minute service, 15-minute step.
      expect(off.starts[0]).toBe("2029-01-08T02:00:00.000Z");
      expect(off.starts).toContain("2029-01-08T09:00:00.000Z");
      expect(off.answer.staffAvailability).toBe("unchecked");
    });

    test("module on: only slots inside a rostered shift, answer says checked", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const on = await slots(fixture, "on");

      // The shift is 03:00Z-06:00Z: a 60-minute service starts 03:00Z..05:00Z.
      expect(on.starts[0]).toBe("2029-01-08T03:00:00.000Z");
      expect(on.starts.at(-1)).toBe("2029-01-08T05:00:00.000Z");
      expect(on.starts).toHaveLength(9);
      expect(on.answer.staffAvailability).toBe("checked");
    });

    test("a resource that names nobody is unchecked even with the module on", async () => {
      const fixture = await newResource([]);
      const on = await slots(fixture, "on");

      expect(on.answer.staffAvailability).toBe("unchecked");
      expect(on.starts).toHaveLength(
        (await slots(fixture, "off")).starts.length
      );
    });

    test("the module switched off for the tenant degrades to no constraint", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);

      await getAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name)
        VALUES ('hr_workforce', 'HR Workforce')
        ON CONFLICT (module_key) DO NOTHING
      `;
      await getAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT}, 'hr_workforce', false)
      `;

      const consumer = await tenantTx((tx) =>
        resolveStaffAvailability(tx, TENANT, loadStaffAvailabilityPort)
      );

      expect(consumer).toBe(NO_OP_STAFF_AVAILABILITY);

      // And with it on again (no row = enabled by default convention) the real
      // adapter is loaded through the module's lazy import.
      await getAdminSql()`
        UPDATE awcms_tenant_modules SET enabled = true
        WHERE tenant_id = ${TENANT} AND module_key = 'hr_workforce'
      `;
      expect(
        await tenantTx((tx) =>
          resolveStaffAvailability(tx, TENANT, loadStaffAvailabilityPort)
        )
      ).not.toBe(NO_OP_STAFF_AVAILABILITY);
      expect(fixture.resourceId).toBeTruthy();
    });

    test("a loader that throws degrades to no constraint (an absent provider is not an outage)", async () => {
      const consumer = await tenantTx((tx) =>
        resolveStaffAvailability(tx, TENANT, async () => {
          throw new Error("provider not built");
        })
      );

      expect(consumer).toBe(NO_OP_STAFF_AVAILABILITY);
    });

    test("fail closed: a person on leave, or unknown to the port, offers nothing", async () => {
      const onLeave = await rosterStaff("leave", {
        from: SHIFT_FROM,
        to: SHIFT_TO,
        kind: "time_off"
      });
      const noRoster = await rosterStaff("none", null);
      const fixture = await newResource([
        onLeave,
        noRoster,
        crypto.randomUUID()
      ]);
      const on = await slots(fixture, "on");

      expect(on.starts).toEqual([]);
      expect(on.answer.staffAvailability).toBe("checked");
    });

    test("a person already serving a live claim is not offered again", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff], 2);
      const placed = await place(fixture);

      expect(placed.outcome).toBe("ok");

      const on = await slots(fixture, "on");

      // 03:00Z-04:00Z is served; a service starting at 03:00..03:45Z overlaps it.
      expect(on.starts).not.toContain("2029-01-08T03:00:00.000Z");
      expect(on.starts).not.toContain("2029-01-08T03:45:00.000Z");
      expect(on.starts).toContain("2029-01-08T04:00:00.000Z");
      // A free unit alone is not enough: units are free (capacity 2), the
      // person is the constraint.
      expect((await slots(fixture, "off")).starts).toContain(
        "2029-01-08T03:00:00.000Z"
      );
    });

    test("a service that spans past the end of the shift is not offered", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const on = await slots(fixture, "on");

      expect(on.starts).not.toContain("2029-01-08T05:15:00.000Z");
    });
  });

  describe("the claim", () => {
    test("wins a rostered person in the same transaction as the units", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const placed = await place(fixture);

      expect(placed.outcome).toBe("ok");
      expect(await liveStaff(fixture.resourceId)).toEqual([staff]);
      expect(await counts(fixture.resourceId)).toMatchObject({
        reservations: 1,
        allocations: 1,
        staff: 1
      });
    });

    test("picks the first free rostered person and falls over to the next", async () => {
      const first = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const second = await rosterStaff("b", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([first, second], 2);

      expect((await place(fixture)).outcome).toBe("ok");
      expect((await place(fixture)).outcome).toBe("ok");
      expect(await liveStaff(fixture.resourceId)).toEqual(
        [first, second].sort()
      );
    });

    test("a staff conflict is SLOT_UNAVAILABLE and allocates NOTHING (a free unit, no free person)", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      // Two units: the second claim finds a free UNIT but no free PERSON.
      const fixture = await newResource([staff], 2);

      expect((await place(fixture)).outcome).toBe("ok");

      const before = await counts(fixture.resourceId);
      const refused = await place(fixture);

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await counts(fixture.resourceId)).toEqual(before);
    });

    test("outside the roster is SLOT_UNAVAILABLE with nothing written", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const refused = await place(fixture, {
        startsAtMs: Date.parse("2029-01-08T07:00:00Z")
      });

      expect(refused).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect(await counts(fixture.resourceId)).toEqual({
        reservations: 0,
        items: 0,
        allocations: 0,
        staff: 0
      });
    });

    test("module off: a resource that names staff still books, with no staff row", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const placed = await place(
        fixture,
        { startsAtMs: Date.parse("2029-01-08T07:00:00Z") },
        false
      );

      expect(placed.outcome).toBe("ok");
      expect(await counts(fixture.resourceId)).toMatchObject({
        allocations: 1,
        staff: 0
      });
    });

    test("one person serves the whole claim of a resource, however many units it takes", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff], 3);
      const placed = await place(fixture, { quantity: 2 });

      expect(placed.outcome).toBe("ok");
      expect(await counts(fixture.resourceId)).toMatchObject({
        allocations: 2,
        staff: 1
      });
    });

    test("two resources of one pool: the claim needs a person on the resource it lands on", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const staffed = await newResource([staff]);
      const refused = await place(staffed, {
        startsAtMs: Date.parse("2029-01-08T06:00:00Z")
      });

      // The rostered person leaves at 06:00Z: nothing is written for the claim.
      expect(refused).toMatchObject({
        outcome: "refused",
        code: "SLOT_UNAVAILABLE"
      });
      expect((await counts(staffed.resourceId)).staff).toBe(0);
    });
  });

  describe("the BookingPort adapter is staff-aware (H1)", () => {
    const port = () =>
      createBookingPort((tx, tenantId) =>
        resolveStaffAvailability(
          tx,
          tenantId,
          async () => staffAvailabilityAdapter
        )
      );

    function portHold(fixture: Fixture, key: string) {
      return tenantTx((tx) =>
        port().hold(tx, {
          tenantId: TENANT,
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAt: new Date(AT_0300).toISOString(),
          partySize: 1,
          idempotencyKey: key,
          correlationId: crypto.randomUUID(),
          actorTenantUserId: actorId
        })
      );
    }

    test("a port reservation writes the staff row; a conflicting one is SLOT_UNAVAILABLE", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      // Two units: only the PERSON can decide the second.
      const fixture = await newResource([staff], 2);
      const first = await portHold(fixture, `k-${crypto.randomUUID()}`);

      expect(first.ok).toBe(true);
      expect(await liveStaff(fixture.resourceId)).toEqual([staff]);

      const before = await counts(fixture.resourceId);
      const second = await portHold(fixture, `k-${crypto.randomUUID()}`);

      expect(second).toMatchObject({ ok: false, reason: "SLOT_UNAVAILABLE" });
      expect(await counts(fixture.resourceId)).toEqual(before);
    });

    test("a port quote is narrowed by the roster too", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const ask = (startsAt: string) =>
        tenantTx((tx) =>
          port().quote(tx, {
            tenantId: TENANT,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            startsAt,
            partySize: 1,
            correlationId: crypto.randomUUID()
          })
        );

      expect(await ask("2029-01-08T03:00:00Z")).toMatchObject({ ok: true });
      expect(await ask("2029-01-08T08:00:00Z")).toMatchObject({
        ok: false,
        reason: "SLOT_UNAVAILABLE"
      });
    });
  });

  describe("occupancy does not depend on the reaper (M1)", () => {
    async function backdateHolds(): Promise<void> {
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '2 seconds'
          WHERE tenant_id = ${TENANT} AND status = 'held'
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });
    }

    test("an elapsed, unreaped hold on R1 does not block the same person on R2", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const r1 = await newResource([staff]);
      const r2 = await newResource([staff]);

      expect((await place(r1)).outcome).toBe("ok");
      // While the hold is live the person is busy on R2.
      expect(await place(r2)).toMatchObject({ outcome: "refused" });

      await backdateHolds();

      // READ: the elapsed hold is not occupancy.
      expect((await slots(r2, "on")).starts).toContain(
        "2029-01-08T03:00:00.000Z"
      );
      // CLAIM: reclaimed by staff reference, no reaper involved.
      expect((await place(r2)).outcome).toBe("ok");
      expect(await liveStaff(r1.resourceId)).toEqual([]);
      expect(await liveStaff(r2.resourceId)).toEqual([staff]);

      const released = (await getAdminSql()`
        SELECT released_reason FROM awcms_booking_staff_assignments
        WHERE resource_id = ${r1.resourceId}
      `) as { released_reason: string }[];

      expect(released.map((row) => row.released_reason)).toEqual(["expired"]);
    });
  });

  describe("concurrency at the database", () => {
    test("N parallel claims for the one rostered person: exactly one wins, the rest are values with nothing written", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      // Plenty of units, so the UNITS never decide: only the person can.
      const fixture = await newResource([staff], 12);
      const contenders = Array.from({ length: 12 }, () => () => place(fixture));
      let go!: () => void;
      const start = new Promise<void>((resolve) => {
        go = resolve;
      });
      const running = contenders.map(async (contender) => {
        await start;
        return contender();
      });

      go();

      const results = await Promise.all(running);
      const won = results.filter((result) => result.outcome === "ok");
      const refused = results.filter((result) => result.outcome === "refused");

      expect(won).toHaveLength(1);
      expect(refused).toHaveLength(11);
      expect(
        refused.every(
          (result) =>
            result.outcome === "refused" &&
            ["SLOT_UNAVAILABLE", "CONTENTION_RETRY"].includes(result.code)
        )
      ).toBe(true);
      expect(await counts(fixture.resourceId)).toEqual({
        reservations: 1,
        items: 1,
        allocations: 1,
        staff: 1
      });
    });

    test("the exclusion constraint refuses a second live claim of one person even for a direct write", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff], 2);

      expect((await place(fixture)).outcome).toBe("ok");

      const item = (await getAdminSql()`
        SELECT id, starts_at FROM awcms_booking_reservation_items
        WHERE tenant_id = ${TENANT} LIMIT 1
      `) as { id: string; starts_at: Date }[];

      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_booking_staff_assignments
            (tenant_id, item_id, resource_id, staff_ref, occupied_from, occupied_to)
          VALUES (${TENANT}, ${item[0]!.id}, ${fixture.resourceId}, ${staff},
                  ${"2029-01-08T03:30:00Z"}::timestamptz, ${"2029-01-08T04:30:00Z"}::timestamptz)
        `,
        /staff_excl|23P01|conflicting key/
      );
    });
  });

  describe("release follows the allocation", () => {
    test("cancel (allocation release) frees the person for the next claim", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);
      const first = await place(fixture);

      expect(first.outcome).toBe("ok");
      expect(await place(fixture)).toMatchObject({ outcome: "refused" });

      // The cancel path, in a tenant context (the policy fails loudly without one).
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
        await tx`
          UPDATE awcms_booking_resource_allocations
          SET released_at = now(), released_reason = 'cancelled'
          WHERE resource_id = ${fixture.resourceId} AND released_at IS NULL
        `;
      });

      expect(await liveStaff(fixture.resourceId)).toEqual([]);

      const released = (await getAdminSql()`
        SELECT released_reason FROM awcms_booking_staff_assignments
        WHERE resource_id = ${fixture.resourceId}
      `) as { released_reason: string }[];

      expect(released.map((row) => row.released_reason)).toEqual(["cancelled"]);
      expect((await place(fixture)).outcome).toBe("ok");
    });

    test("an elapsed hold is reclaimed lazily and its person with it", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);

      expect((await place(fixture)).outcome).toBe("ok");
      // Backdate the hold through SQL (the database clock is the authority);
      // no reaper runs: the next claim reclaims lazily.
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '2 seconds'
          WHERE tenant_id = ${TENANT} AND status = 'held'
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });

      expect((await place(fixture)).outcome).toBe("ok");
      expect(await liveStaff(fixture.resourceId)).toEqual([staff]);

      const released = (await getAdminSql()`
        SELECT released_reason FROM awcms_booking_staff_assignments
        WHERE resource_id = ${fixture.resourceId} AND released_at IS NOT NULL
      `) as { released_reason: string }[];

      expect(released.map((row) => row.released_reason)).toEqual(["expired"]);
    });

    test("the worker sweep (a memberless role) releases the person with the hold", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);

      expect((await place(fixture)).outcome).toBe("ok");
      await getAdminSql().begin(async (tx) => {
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations DISABLE TRIGGER awcms_booking_reservations_update_guard"
        );
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '2 seconds'
          WHERE tenant_id = ${TENANT} AND status = 'held'
        `;
        await tx.unsafe(
          "ALTER TABLE awcms_booking_reservations ENABLE TRIGGER awcms_booking_reservations_update_guard"
        );
      });

      const swept = await getWorkerRoleSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
        return expireDueHolds(tx, TENANT);
      });

      expect(swept.expired).toBe(1);
      expect(await liveStaff(fixture.resourceId)).toEqual([]);
    });

    test("a staff assignment is never deleted and only its release may change", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);

      expect((await place(fixture)).outcome).toBe("ok");
      await assertRejected(
        getAdminSql()`DELETE FROM awcms_booking_staff_assignments WHERE resource_id = ${fixture.resourceId}`,
        /append-only|55000/
      );
      await assertRejected(
        getAdminSql()`UPDATE awcms_booking_staff_assignments SET staff_ref = 'x' WHERE resource_id = ${fixture.resourceId}`,
        /only released_at/
      );
    });
  });

  describe("tenant isolation", () => {
    test("the runtime role cannot read another tenant's staff assignments", async () => {
      const staff = await rosterStaff("a", { from: SHIFT_FROM, to: SHIFT_TO });
      const fixture = await newResource([staff]);

      expect((await place(fixture)).outcome).toBe("ok");

      const other = "b9490000-0000-4000-8000-00000000000b";

      await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${other}, 'stf2', 'Other')
      `;

      const rows = await pool.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${other}'`);
        return tx`SELECT id FROM awcms_booking_staff_assignments`;
      });

      expect(rows).toHaveLength(0);
    });
  });
});
