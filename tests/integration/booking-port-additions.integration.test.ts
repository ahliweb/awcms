/**
 * The BookingPort additions against a real PostgreSQL (Issue #1108, contract
 * 1.1.0 of the `booking` capability) -- WORLD-1 of the harness: the port driven
 * as the runtime role `awcms_app` (FORCE RLS in effect), on separate
 * connections, under `app.current_tenant_id`.
 *
 * What this proves that the unit tests (`tests/booking-port-additions.test.ts`)
 * cannot:
 *
 *   * `checkIn`, `checkOut` and `markNoShow` make the module's transition (one
 *     history row, one audit row, one `awcms.booking.reservation.*` event), are
 *     idempotent by key AND by state, and refuse as VALUES (wrong state, too
 *     early, another tenant's id, a reused key for another request) without
 *     writing;
 *   * `get` finds a reservation by id and by number, says "not found" as a
 *     value, never crosses a tenant, and returns no customer reference;
 *   * `getOffering` and `listOfferings` read through RLS, page by keyset
 *     without skipping or repeating a row, and never cross a tenant;
 *   * `availability` answers with no actor and no personal data, narrows after
 *     a hold, and a caller naming another tenant than its transaction's sees
 *     nothing.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createRuntimePool,
  getAdminSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { createBookingPort } from "../../src/modules/booking/application/booking-port-adapter";
import {
  createReservation,
  rescheduleReservation
} from "../../src/modules/booking/application/booking-reservation-service";
import type { PlaceHoldInput } from "../../src/modules/booking/domain/booking-allocation";
import { NO_OP_STAFF_AVAILABILITY } from "../../src/modules/booking/domain/booking-staff-availability";

const TENANT_A = "b1080000-0000-4000-8000-00000000000a";
const TENANT_B = "b1080000-0000-4000-8000-00000000000b";
const port = createBookingPort(async () => NO_OP_STAFF_AVAILABILITY);
const ACTORS = new Map<string, string>();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A whole hour three days from now: inside any sane lead time and horizon, on every step grid. */
const START = Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR;

function dateAfter(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

let pool: Bun.SQL;
let sequence = 0;

function tenantTx<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

async function seedTenant(tenantId: string, code: string): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${`Booking ${code}`})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Actor ${code}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  ACTORS.set(tenantId, user[0]!.id);
}

type Fixture = { resourceId: string; unitIds: string[]; offeringId: string };

type FixtureOptions = {
  capacity?: number;
  mode?: "slot" | "stay";
  confirmation?: "immediate" | "hold_then_confirm";
  cutoffSeconds?: number | null;
  /** `false` leaves the resource with NO schedule (closed everywhere). */
  schedule?: boolean;
};

/** A resource, its units, an offering and (for a slot resource) a schedule that is open all day, every day. Fresh codes. */
async function newFixture(
  tenantId: string,
  options: FixtureOptions = {}
): Promise<Fixture> {
  const admin = getAdminSql();
  sequence += 1;
  const code = `r${sequence}`;
  const capacity = options.capacity ?? 1;
  const mode = options.mode ?? "slot";
  const resource = (await admin`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode,
       stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', ${mode},
            ${mode === "stay" ? "14:00" : null}::time,
            ${mode === "stay" ? "12:00" : null}::time)
    RETURNING id
  `) as { id: string }[];
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await admin`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  if (mode === "slot" && options.schedule !== false) {
    const day = [{ from: "00:00", to: "24:00" }];

    await admin`
      INSERT INTO awcms_booking_schedules
        (tenant_id, resource_id, timezone, effective_from, rules)
      VALUES (${tenantId}, ${resource[0]!.id}, 'Asia/Pontianak', '2020-01-01',
              ${{ weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } }}::jsonb)
    `;
  }

  const confirmation = options.confirmation ?? "hold_then_confirm";
  const offering =
    mode === "stay"
      ? ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, min_nights, max_nights,
             max_party, confirmation_mode, cancellation_cutoff_seconds)
          VALUES (${tenantId}, ${`night-${code}`}, 'Night', 'stay', 1, 30, 4,
                  ${confirmation}, ${options.cutoffSeconds ?? null})
          RETURNING id
        `) as { id: string }[])
      : ((await admin`
          INSERT INTO awcms_booking_service_offerings
            (tenant_id, code, name, granularity, duration_seconds, setup_seconds,
             cleanup_seconds, slot_step_seconds, max_party, confirmation_mode,
             cancellation_cutoff_seconds)
          VALUES (${tenantId}, ${`hour-${code}`}, 'Hour', 'time', 3600, 0, 0, 900,
                  4, ${confirmation}, ${options.cutoffSeconds ?? null})
          RETURNING id
        `) as { id: string }[]);

  return {
    resourceId: resource[0]!.id,
    unitIds,
    offeringId: offering[0]!.id
  };
}

function claim(
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {}
): PlaceHoldInput {
  return {
    offeringId: fixture.offeringId,
    resourceId: fixture.resourceId,
    startsAtMs: START,
    partySize: 1,
    quantity: 1,
    ...overrides
  };
}

/** Everything a call may write, counted: a refused or replayed call must leave all of them where they were. */
async function writeCounts(tenantId: string) {
  const rows = (await getAdminSql()`
    SELECT
      (SELECT count(*) FROM awcms_booking_reservations WHERE tenant_id = ${tenantId})::int AS reservations,
      (SELECT count(*) FROM awcms_booking_reservation_events WHERE tenant_id = ${tenantId})::int AS history,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit
  `) as Record<string, number>[];

  return { ...rows[0]! };
}

type DomainEventRow = {
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
};

async function domainEvents(reservationId: string): Promise<DomainEventRow[]> {
  return (await getAdminSql()`
    SELECT event_type, payload, correlation_id
    FROM awcms_domain_events
    WHERE aggregate_type = 'reservation' AND aggregate_id = ${reservationId}
    ORDER BY event_sequence
  `) as DomainEventRow[];
}

const key = () => `k-${crypto.randomUUID()}`;

function common(tenantId: string) {
  return {
    tenantId,
    actorTenantUserId: ACTORS.get(tenantId)!,
    correlationId: crypto.randomUUID()
  };
}

function ctxOf(tenantId: string) {
  return { ...common(tenantId), staff: NO_OP_STAFF_AVAILABILITY };
}

/** A reservation made by the service directly (so a past start or a policy override is possible), returned as its id and number. */
async function made(
  tenantId: string,
  fixture: Fixture,
  overrides: Partial<PlaceHoldInput> = {},
  options: { confirm?: boolean; lift?: boolean; customerRef?: string } = {}
): Promise<{ id: string; no: string }> {
  const outcome = await tenantTx(tenantId, (tx) =>
    createReservation(
      tx,
      ctxOf(tenantId),
      {
        claim: {
          ...claim(fixture, overrides),
          ...(options.customerRef
            ? { externalCustomerRef: options.customerRef }
            : {})
        },
        overridePolicy: options.lift ?? false
      },
      options.lift ?? false
    )
  );

  if (outcome.outcome !== "ok") {
    throw new Error(`expected a reservation, got ${JSON.stringify(outcome)}`);
  }

  if (options.confirm !== false) {
    const confirmed = await tenantTx(tenantId, (tx) =>
      port.confirm(tx, {
        ...common(tenantId),
        reservationId: outcome.reservation.id,
        idempotencyKey: key()
      })
    );

    expect(confirmed).toMatchObject({ ok: true, status: "confirmed" });
  }

  return { id: outcome.reservation.id, no: outcome.reservation.reservationNo };
}

const startedTwoHoursAgo = () => ({
  startsAtMs: Math.floor(Date.now() / HOUR) * HOUR - 2 * HOUR
});

const suite = integrationEnabled ? describe : describe.skip;

suite("BookingPort additions (Issue #1108)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
    pool = createRuntimePool(24);
    await seedTenant(TENANT_A, "port-a");
    await seedTenant(TENANT_B, "port-b");
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  describe("checkIn", () => {
    test("confirmed -> checked_in publishes one event; a replay of the key and a repeat with a new key write nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const { id } = await made(TENANT_A, fixture);
      const idempotencyKey = key();
      const input = { ...common(TENANT_A), reservationId: id, idempotencyKey };
      const first = await tenantTx(TENANT_A, (tx) => port.checkIn(tx, input));

      expect(first).toEqual({
        ok: true,
        reservationId: id,
        status: "checked_in",
        holdExpiresAt: null,
        replayed: false
      });
      expect((await domainEvents(id)).map((e) => e.event_type).at(-1)).toBe(
        "awcms.booking.reservation.checked_in"
      );

      expect(await tenantTx(TENANT_A, (tx) => port.checkIn(tx, input))).toEqual(
        { ...(first as object), replayed: true } as never
      );
      // Same key, different request: a conflict, not a replay of the other call.
      const other = await made(TENANT_A, fixture, { startsAtMs: START + DAY });

      expect(
        await tenantTx(TENANT_A, (tx) =>
          port.checkIn(tx, { ...input, reservationId: other.id })
        )
      ).toEqual({ ok: false, reason: "IDEMPOTENCY_CONFLICT" });
      // A fresh key for the state it is already in is a replay too.
      const afterOther = await writeCounts(TENANT_A);

      expect(
        await tenantTx(TENANT_A, (tx) =>
          port.checkIn(tx, { ...input, idempotencyKey: key() })
        )
      ).toMatchObject({ ok: true, status: "checked_in", replayed: true });
      expect(await writeCounts(TENANT_A)).toEqual(afterOther);
    });

    test("refusals are values and write nothing: a hold, an unknown id, another tenant's id, a stay before its date", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await made(TENANT_A, fixture, {}, { confirm: false });
      const theirs = await made(TENANT_B, await newFixture(TENANT_B));
      const stayFixture = await newFixture(TENANT_A, { mode: "stay" });
      const later = await made(TENANT_A, stayFixture, {
        startsAtMs: undefined,
        stay: { checkInDate: dateAfter(10), checkOutDate: dateAfter(12) }
      });
      const before = await writeCounts(TENANT_A);
      const run = (reservationId: string) =>
        tenantTx(TENANT_A, (tx) =>
          port.checkIn(tx, {
            ...common(TENANT_A),
            reservationId,
            idempotencyKey: key()
          })
        );

      expect(await run(hold.id)).toEqual({
        ok: false,
        reason: "INVALID_STATE"
      });
      expect(await run(crypto.randomUUID())).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
      expect(await run(theirs.id)).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
      expect(await run(later.id)).toEqual({
        ok: false,
        reason: "CHECK_IN_TOO_EARLY"
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
      expect(
        (
          await getAdminSql()`
          SELECT status FROM awcms_booking_reservations WHERE id = ${theirs.id}
        `
        )[0]
      ).toEqual({ status: "confirmed" });
    });
  });

  describe("checkOut", () => {
    test("checked_in -> completed; the allocations stay; the event is published; a replay writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const { id } = await made(TENANT_A, fixture);

      await tenantTx(TENANT_A, (tx) =>
        port.checkIn(tx, {
          ...common(TENANT_A),
          reservationId: id,
          idempotencyKey: key()
        })
      );

      const idempotencyKey = key();
      const input = { ...common(TENANT_A), reservationId: id, idempotencyKey };
      const done = await tenantTx(TENANT_A, (tx) => port.checkOut(tx, input));

      expect(done).toMatchObject({
        ok: true,
        status: "completed",
        replayed: false
      });
      expect((await domainEvents(id)).map((e) => e.event_type)).toEqual([
        "awcms.booking.reservation.created",
        "awcms.booking.reservation.held",
        "awcms.booking.reservation.confirmed",
        "awcms.booking.reservation.checked_in",
        "awcms.booking.reservation.completed"
      ]);

      const before = await writeCounts(TENANT_A);

      expect(
        await tenantTx(TENANT_A, (tx) => port.checkOut(tx, input))
      ).toMatchObject({ ok: true, status: "completed", replayed: true });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("a confirmed reservation cannot be checked out first; another tenant's is not found", async () => {
      const fixture = await newFixture(TENANT_A);
      const { id } = await made(TENANT_A, fixture);
      const theirs = await made(TENANT_B, await newFixture(TENANT_B));
      const before = await writeCounts(TENANT_A);
      const run = (reservationId: string) =>
        tenantTx(TENANT_A, (tx) =>
          port.checkOut(tx, {
            ...common(TENANT_A),
            reservationId,
            idempotencyKey: key()
          })
        );

      expect(await run(id)).toEqual({ ok: false, reason: "INVALID_STATE" });
      expect(await run(theirs.id)).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });
  });

  describe("markNoShow", () => {
    test("refused before the start plus the grace, allowed after it, idempotent, and the slot stays consumed", async () => {
      const upcoming = await made(TENANT_A, await newFixture(TENANT_A));
      const before = await writeCounts(TENANT_A);

      expect(
        await tenantTx(TENANT_A, (tx) =>
          port.markNoShow(tx, {
            ...common(TENANT_A),
            reservationId: upcoming.id,
            idempotencyKey: key()
          })
        )
      ).toEqual({ ok: false, reason: "NO_SHOW_TOO_EARLY" });
      expect(await writeCounts(TENANT_A)).toEqual(before);

      // A reservation that started two hours ago (an override creates it).
      const started = await made(
        TENANT_A,
        await newFixture(TENANT_A),
        startedTwoHoursAgo(),
        { lift: true }
      );
      const input = {
        ...common(TENANT_A),
        reservationId: started.id,
        idempotencyKey: key()
      };
      const marked = await tenantTx(TENANT_A, (tx) =>
        port.markNoShow(tx, input)
      );

      expect(marked).toMatchObject({
        ok: true,
        status: "no_show",
        replayed: false
      });
      expect((await domainEvents(started.id)).at(-1)?.event_type).toBe(
        "awcms.booking.reservation.no_show"
      );
      expect(
        (
          await getAdminSql()`
          SELECT count(*)::int AS n
          FROM awcms_booking_resource_allocations a
          JOIN awcms_booking_reservation_items i ON i.id = a.item_id
          WHERE i.reservation_id = ${started.id} AND a.released_at IS NULL
        `
        )[0]
      ).toEqual({ n: 1 });
      expect(
        await tenantTx(TENANT_A, (tx) => port.markNoShow(tx, input))
      ).toEqual({ ...(marked as object), replayed: true } as never);
    });

    test("a held reservation and another tenant's reservation are refused as values", async () => {
      const hold = await made(
        TENANT_A,
        await newFixture(TENANT_A),
        startedTwoHoursAgo(),
        { confirm: false, lift: true }
      );
      const theirs = await made(
        TENANT_B,
        await newFixture(TENANT_B),
        startedTwoHoursAgo(),
        { lift: true }
      );
      const run = (reservationId: string) =>
        tenantTx(TENANT_A, (tx) =>
          port.markNoShow(tx, {
            ...common(TENANT_A),
            reservationId,
            idempotencyKey: key()
          })
        );

      expect(await run(hold.id)).toEqual({
        ok: false,
        reason: "INVALID_STATE"
      });
      expect(await run(theirs.id)).toEqual({
        ok: false,
        reason: "RESERVATION_NOT_FOUND"
      });
    });
  });

  describe("get", () => {
    test("by id and by number: the schedule, the lineage, the external reference, and NO customer data", async () => {
      const fixture = await newFixture(TENANT_A);
      const hold = await tenantTx(TENANT_A, (tx) =>
        port.hold(tx, {
          ...common(TENANT_A),
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          startsAt: new Date(START).toISOString(),
          partySize: 2,
          customerRef: "cust-secret-1108",
          externalRef: { type: "order", id: "ORD-1108" },
          idempotencyKey: key()
        })
      );

      expect(hold.ok).toBe(true);
      if (!hold.ok) return;

      const byId = await tenantTx(TENANT_A, (tx) =>
        port.get(tx, { tenantId: TENANT_A, reservationId: hold.reservationId })
      );

      expect(byId.ok).toBe(true);
      if (!byId.ok) return;

      const record = byId.reservation;

      expect(Object.keys(record).sort()).toEqual([
        "endsAt",
        "externalRef",
        "holdExpiresAt",
        "lineageId",
        "reservationId",
        "reservationNo",
        "startsAt",
        "status",
        "stays",
        "supersededById"
      ]);
      expect(record).toMatchObject({
        reservationId: hold.reservationId,
        status: "held",
        supersededById: null,
        stays: [],
        externalRef: { type: "order", id: "ORD-1108" }
      });
      // Rendered by the database with microseconds; the same instants.
      expect(Date.parse(record.startsAt)).toBe(START);
      expect(Date.parse(record.endsAt)).toBe(START + HOUR);
      expect(record.startsAt).toMatch(/Z$/);
      expect(typeof record.holdExpiresAt).toBe("string");
      expect(JSON.stringify(byId)).not.toContain("cust-secret-1108");

      const byNo = await tenantTx(TENANT_A, (tx) =>
        port.get(tx, {
          tenantId: TENANT_A,
          reservationNo: record.reservationNo
        })
      );

      expect(byNo).toEqual(byId);
    });

    test("a stay lists its dates; a reschedule marks the original superseded and the replacement carries the lineage", async () => {
      const fixture = await newFixture(TENANT_A, { mode: "stay" });
      const original = await made(TENANT_A, fixture, {
        startsAtMs: undefined,
        stay: { checkInDate: dateAfter(10), checkOutDate: dateAfter(12) }
      });
      const read = (reservationId: string) =>
        tenantTx(TENANT_A, (tx) =>
          port.get(tx, { tenantId: TENANT_A, reservationId })
        );
      const first = await read(original.id);

      expect(first).toMatchObject({
        ok: true,
        reservation: {
          status: "confirmed",
          holdExpiresAt: null,
          stays: [
            {
              offeringId: fixture.offeringId,
              checkInDate: dateAfter(10),
              checkOutDate: dateAfter(12),
              nights: 2,
              timezone: "Asia/Pontianak"
            }
          ]
        }
      });

      const moved = await tenantTx(TENANT_A, async (tx) =>
        rescheduleReservation(
          tx,
          ctxOf(TENANT_A),
          original.id,
          {
            stay: { checkInDate: dateAfter(20), checkOutDate: dateAfter(22) },
            overridePolicy: false
          },
          false
        )
      );

      expect(moved.outcome).toBe("ok");
      if (moved.outcome !== "ok" || !first.ok) return;

      const after = await read(original.id);
      const replacement = await read(moved.reservation.id);

      expect(after).toMatchObject({
        ok: true,
        reservation: {
          status: "rescheduled",
          supersededById: moved.reservation.id
        }
      });
      expect(replacement).toMatchObject({
        ok: true,
        reservation: {
          lineageId: first.reservation.lineageId,
          supersededById: null
        }
      });
    });

    test("not found is a value; another tenant's reservation is the same answer; a malformed key is a validation value", async () => {
      const theirs = await made(TENANT_B, await newFixture(TENANT_B));
      const missing = { ok: false, reason: "RESERVATION_NOT_FOUND" } as const;
      const run = (input: Parameters<typeof port.get>[1]) =>
        tenantTx(TENANT_A, (tx) => port.get(tx, input));

      expect(
        await run({ tenantId: TENANT_A, reservationId: crypto.randomUUID() })
      ).toEqual(missing);
      expect(
        await run({ tenantId: TENANT_A, reservationId: theirs.id })
      ).toEqual(missing);
      expect(
        await run({ tenantId: TENANT_A, reservationNo: theirs.no })
      ).toEqual(missing);
      // Naming the other tenant while inside this tenant's transaction: RLS says no.
      expect(
        await run({ tenantId: TENANT_B, reservationId: theirs.id })
      ).toEqual(missing);
      expect(
        await tenantTx(TENANT_B, (tx) =>
          port.get(tx, { tenantId: TENANT_B, reservationId: theirs.id })
        )
      ).toMatchObject({ ok: true });
    });
  });

  describe("getOffering and listOfferings", () => {
    test("an offering reads with its granularity, confirmation mode and status; unknown, deleted and another tenant's are not found", async () => {
      const slot = await newFixture(TENANT_A, { confirmation: "immediate" });
      const stay = await newFixture(TENANT_A, { mode: "stay" });
      const theirs = await newFixture(TENANT_B);
      const read = (offeringId: string, tenantId = TENANT_A) =>
        tenantTx(tenantId, (tx) =>
          port.getOffering(tx, { tenantId, offeringId })
        );

      expect(await read(slot.offeringId)).toMatchObject({
        ok: true,
        offering: {
          offeringId: slot.offeringId,
          granularity: "time",
          confirmationMode: "immediate",
          status: "active",
          durationSeconds: 3600,
          minNights: null
        }
      });
      expect(await read(stay.offeringId)).toMatchObject({
        ok: true,
        offering: {
          granularity: "stay",
          confirmationMode: "hold_then_confirm",
          durationSeconds: null,
          minNights: 1,
          maxNights: 30
        }
      });

      const notFound = { ok: false, reason: "OFFERING_NOT_FOUND" } as const;

      expect(await read(crypto.randomUUID())).toEqual(notFound);
      expect(await read(theirs.offeringId)).toEqual(notFound);

      await getAdminSql()`
        UPDATE awcms_booking_service_offerings SET deleted_at = now()
        WHERE id = ${stay.offeringId}
      `;
      expect(await read(stay.offeringId)).toEqual(notFound);
    });

    test("keyset paging visits every live offering of the tenant exactly once and none of another's", async () => {
      await resetDatabase();
      await seedTenant(TENANT_A, "port-a");
      await seedTenant(TENANT_B, "port-b");

      const mine: string[] = [];

      for (let i = 0; i < 5; i += 1) {
        mine.push((await newFixture(TENANT_A)).offeringId);
      }

      const gone = (await newFixture(TENANT_A)).offeringId;
      const theirs = (await newFixture(TENANT_B)).offeringId;

      await getAdminSql()`
        UPDATE awcms_booking_service_offerings SET deleted_at = now() WHERE id = ${gone}
      `;
      await getAdminSql()`
        UPDATE awcms_booking_service_offerings SET status = 'inactive' WHERE id = ${mine[0]!}
      `;

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const page = await tenantTx(TENANT_A, (tx) =>
          port.listOfferings(tx, { tenantId: TENANT_A, limit: 2, cursor })
        );

        expect(page.ok).toBe(true);
        if (!page.ok) return;

        expect(page.offerings.length).toBeLessThanOrEqual(2);
        seen.push(...page.offerings.map((o) => o.offeringId));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect([...seen].sort()).toEqual([...mine].sort());
      expect(seen).not.toContain(gone);
      expect(seen).not.toContain(theirs);

      const inactive = await tenantTx(TENANT_A, (tx) =>
        port.listOfferings(tx, { tenantId: TENANT_A, status: "inactive" })
      );

      expect(inactive).toMatchObject({
        ok: true,
        nextCursor: null,
        offerings: [{ offeringId: mine[0], status: "inactive" }]
      });
      // The other tenant sees only its own.
      expect(
        await tenantTx(TENANT_B, (tx) =>
          port.listOfferings(tx, { tenantId: TENANT_B })
        )
      ).toMatchObject({ ok: true, offerings: [{ offeringId: theirs }] });
      // Naming another tenant than the transaction's: RLS returns nothing.
      expect(
        await tenantTx(TENANT_A, (tx) =>
          port.listOfferings(tx, { tenantId: TENANT_B })
        )
      ).toMatchObject({ ok: true, offerings: [] });
    });
  });

  describe("availability", () => {
    const window = (fromMs: number, hours: number) => ({
      from: new Date(fromMs).toISOString(),
      to: new Date(fromMs + hours * HOUR).toISOString()
    });

    test("slots need no actor, narrow after a hold, and carry no personal or internal data", async () => {
      const fixture = await newFixture(TENANT_A);
      const ask = () =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId: TENANT_A,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            ...window(START, 3)
          })
        );
      const open = await ask();

      expect(open.ok).toBe(true);
      if (!open.ok || open.mode !== "slot") return;

      expect(Object.keys(open).sort()).toEqual([
        "from",
        "mode",
        "ok",
        "slots",
        "timezone",
        "to",
        "truncated"
      ]);
      expect(open.slots[0]).toEqual({
        startsAt: new Date(START).toISOString(),
        endsAt: new Date(START + HOUR).toISOString(),
        freeUnits: 1
      });

      await made(
        TENANT_A,
        fixture,
        {},
        { confirm: false, customerRef: "cust-secret-1108" }
      );

      const taken = await ask();

      expect(taken.ok).toBe(true);
      if (!taken.ok || taken.mode !== "slot") return;

      expect(taken.slots.map((s) => s.startsAt)).not.toContain(
        new Date(START).toISOString()
      );
      expect(taken.slots.length).toBeLessThan(open.slots.length);
      expect(JSON.stringify(taken)).not.toMatch(
        /cust-secret|Room|order|reservation/i
      );
    });

    test("writes nothing", async () => {
      const fixture = await newFixture(TENANT_A);
      const before = await writeCounts(TENANT_A);

      await tenantTx(TENANT_A, (tx) =>
        port.availability(tx, {
          tenantId: TENANT_A,
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          ...window(START, 2)
        })
      );
      expect(await writeCounts(TENANT_A)).toEqual(before);
    });

    test("a stay answers with nights and free units; a booked range says SLOT_UNAVAILABLE and reveals no reason", async () => {
      const fixture = await newFixture(TENANT_A, { mode: "stay", capacity: 2 });
      const stay = { checkInDate: dateAfter(30), checkOutDate: dateAfter(33) };
      const ask = () =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId: TENANT_A,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            stay
          })
        );

      expect(await ask()).toEqual({
        ok: true,
        mode: "stay",
        timezone: "Asia/Pontianak",
        ...stay,
        nights: 3,
        freeUnits: 2,
        available: true
      });

      await made(TENANT_A, fixture, { startsAtMs: undefined, stay });
      expect(await ask()).toMatchObject({
        ok: true,
        available: true,
        freeUnits: 1
      });
      await made(TENANT_A, fixture, { startsAtMs: undefined, stay });
      expect(await ask()).toEqual({
        ok: true,
        mode: "stay",
        timezone: "UTC",
        ...stay,
        nights: null,
        freeUnits: 0,
        available: false,
        reason: "SLOT_UNAVAILABLE"
      });
    });

    test("an anonymous stay answer never carries the tenant's policy: min stay, max stay, lead time and horizon read as ordinary unavailability", async () => {
      const fixture = await newFixture(TENANT_A, { mode: "stay", capacity: 1 });
      const admin = getAdminSql();
      const ask = (stay: { checkInDate: string; checkOutDate: string }) =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId: TENANT_A,
            offeringId: fixture.offeringId,
            resourceId: fixture.resourceId,
            stay
          })
        );
      const setOffering = async (min: number, lead: number | null) => {
        await admin`
          UPDATE awcms_booking_service_offerings
          SET min_nights = ${min}, min_lead_seconds = ${lead}
          WHERE id = ${fixture.offeringId}
        `;
      };

      // The reference: an ordinary booked range.
      const booked = {
        checkInDate: dateAfter(60),
        checkOutDate: dateAfter(62)
      };

      await made(TENANT_A, fixture, { startsAtMs: undefined, stay: booked });
      const ordinary = await ask(booked);

      expect(ordinary).toMatchObject({
        ok: true,
        available: false,
        reason: "SLOT_UNAVAILABLE"
      });

      await setOffering(3, 30 * 86_400);

      const cases = {
        minStay: { checkInDate: dateAfter(100), checkOutDate: dateAfter(101) },
        maxStay: { checkInDate: dateAfter(100), checkOutDate: dateAfter(140) },
        leadTime: { checkInDate: dateAfter(3), checkOutDate: dateAfter(6) },
        horizon: { checkInDate: dateAfter(900), checkOutDate: dateAfter(903) }
      };

      for (const [name, stay] of Object.entries(cases)) {
        const answer = await ask(stay);

        expect(answer, name).toEqual({
          ok: true,
          mode: "stay",
          timezone: "UTC",
          ...stay,
          nights: null,
          freeUnits: 0,
          available: false,
          reason: "SLOT_UNAVAILABLE"
        });
        // Same keys and same values as the ordinary booked answer, apart from the echoed dates.
        expect(Object.keys(answer).sort()).toEqual(
          Object.keys(ordinary).sort()
        );
        expect(JSON.stringify(answer)).not.toMatch(
          /MIN_STAY|MAX_STAY|LEAD_TIME|HORIZON|OUTSIDE_SCHEDULE/
        );
      }
    });

    test("an over-capacity quantity, an unknown resource and a fully-booked request give one answer; a malformed tenant id is a validation value", async () => {
      const slot = await newFixture(TENANT_A, { capacity: 2 });
      const stayFx = await newFixture(TENANT_A, { mode: "stay", capacity: 2 });
      const slotAsk = (resourceId: string, quantity: number) =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId: TENANT_A,
            offeringId: slot.offeringId,
            resourceId,
            quantity,
            ...window(START, 1)
          })
        );
      const stayAsk = (resourceId: string, quantity: number, stay: object) =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId: TENANT_A,
            offeringId: stayFx.offeringId,
            resourceId,
            quantity,
            stay: stay as { checkInDate: string; checkOutDate: string }
          })
        );

      // Slot: fully booked (both units taken) vs. too many vs. unknown resource.
      await made(TENANT_A, slot, {});
      await made(TENANT_A, slot, {});
      const fullyBooked = await slotAsk(slot.resourceId, 1);
      const tooMany = await slotAsk(slot.resourceId, 3);
      const unknown = await slotAsk(crypto.randomUUID(), 1);

      expect(fullyBooked).toMatchObject({ ok: true, slots: [] });
      expect(tooMany).toEqual(fullyBooked);
      expect(unknown).toEqual(fullyBooked);

      // Stay: fully booked vs. too many vs. unknown resource.
      const stay = { checkInDate: dateAfter(40), checkOutDate: dateAfter(42) };

      await made(TENANT_A, stayFx, { startsAtMs: undefined, stay });
      await made(TENANT_A, stayFx, { startsAtMs: undefined, stay });
      const stayFull = await stayAsk(stayFx.resourceId, 1, stay);

      expect(stayFull).toMatchObject({ ok: true, available: false });
      expect(await stayAsk(stayFx.resourceId, 3, stay)).toEqual(stayFull);
      expect(await stayAsk(crypto.randomUUID(), 1, stay)).toEqual(stayFull);

      // A malformed tenant id never reaches Postgres (22P02).
      const bad = "not-a-uuid";
      const check = (fn: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
        tenantTx(TENANT_A, fn);

      expect(
        await check((tx) =>
          port.get(tx, { tenantId: bad, reservationNo: "ABCD-1234" })
        )
      ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
      expect(
        await check((tx) =>
          port.getOffering(tx, { tenantId: bad, offeringId: slot.offeringId })
        )
      ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
      expect(
        await check((tx) => port.listOfferings(tx, { tenantId: bad }))
      ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
      expect(
        await check((tx) =>
          port.availability(tx, {
            tenantId: bad,
            offeringId: slot.offeringId,
            resourceId: slot.resourceId,
            ...window(START, 2)
          })
        )
      ).toEqual({ ok: false, reason: "VALIDATION_ERROR" });
    });

    test("another tenant's offering or resource is not found; naming another tenant than the transaction's sees nothing; a mode mismatch is a value", async () => {
      const mine = await newFixture(TENANT_A);
      const theirs = await newFixture(TENANT_B);
      const ask = (
        offeringId: string,
        resourceId: string,
        tenantId = TENANT_A
      ) =>
        tenantTx(TENANT_A, (tx) =>
          port.availability(tx, {
            tenantId,
            offeringId,
            resourceId,
            ...window(START, 2)
          })
        );

      expect(await ask(theirs.offeringId, mine.resourceId)).toEqual({
        ok: false,
        reason: "OFFERING_NOT_FOUND"
      });
      // An unknown resource is the neutral "no availability" answer, not a
      // named refusal (see the capacity-probe test below).
      expect(await ask(mine.offeringId, theirs.resourceId)).toMatchObject({
        ok: true,
        mode: "slot",
        slots: []
      });
      expect(
        await ask(theirs.offeringId, theirs.resourceId, TENANT_B)
      ).toMatchObject({ ok: true, mode: "slot", slots: [] });

      const stay = await newFixture(TENANT_A, { mode: "stay" });

      expect(await ask(stay.offeringId, stay.resourceId)).toEqual({
        ok: false,
        reason: "BOOKING_MODE_MISMATCH"
      });
    });
  });
});
